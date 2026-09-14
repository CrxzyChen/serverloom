const { sessionId } = require('./attachments.cjs')
const PLAN_TOOLS = new Set(['schedules_list','servers_list','servers_test_connection','servers_inspect_hardware'])
function validateSettings(value, models) {
 const model=models.find(m=>m.model===value.model); if(!model)throw new Error('所选模型不在当前模型列表，请刷新后选择')
 const effort=value.effort||model.defaultReasoningEffort
 if(!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===effort))throw new Error('该模型不支持所选推理强度')
 if(!['default','plan'].includes(value.mode))throw new Error('模式无效')
 return {model:model.model,effort,mode:value.mode}
}
function turnOptions(settings) {return { model:settings.model,effort:settings.effort,collaborationMode:{mode:settings.mode,settings:{model:settings.model,reasoning_effort:settings.effort,developer_instructions:null}}}}
class Copilot {
 constructor(runtime,store,attachments) {this.runtime=runtime;this.store=store;this.attachments=attachments;this.models=[];this.modes=[];this.threadModes=new Map();this.states=new Map();this.catalogJob=null}
 async catalog(refresh=false) {
  if(this.catalogJob)return this.catalogJob
  if(this.models.length&&!refresh)return {models:this.models,modes:this.modes}
  this.catalogJob=(async()=>{const models=[],seen=new Set();let cursor;do {const result=await this.runtime.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...result.data.filter(m=>!m.hidden));cursor=result.nextCursor;if(cursor&&seen.has(cursor))throw new Error('模型分页重复');seen.add(cursor)}while(cursor);const modes=await this.runtime.request('collaborationMode/list',{});this.models=models;this.modes=modes.data;return {models,modes:this.modes}})().finally(()=>{this.catalogJob=null});return this.catalogJob
 }
 async settings(id,value) {sessionId(id);await this.catalog();const settings=validateSettings(value,this.models);if(!this.modes.some(m=>m.mode===settings.mode))throw new Error('运行时暂不支持此模式');await this.store.update(data=>{data.copilotSessions||={};data.copilotSessions[id]={...data.copilotSessions[id],settings}});return settings}
 async resolveSettings(id,value) {await this.catalog();const previous=(await this.store.read()).copilotSessions?.[id]?.settings;const m=this.models.find(m=>m.isDefault)||this.models[0];if(!m)throw new Error('没有可用模型');return this.settings(id,value||previous||{model:m.model,effort:m.defaultReasoningEffort,mode:'default'})}
 checkTool(threadId,name) {if(this.threadModes.get(threadId)==='plan'&&!PLAN_TOOLS.has(name))throw new Error('Plan 模式仅允许查询台账及固定只读检查；请切换 Agent 后执行此操作')}
 async event(event,conversationId) {
  const p=event.params||{};if(!conversationId)return
  let patch
  if(event.method==='turn/plan/updated')patch={plan:p.plan,planTurnId:p.turnId,explanation:p.explanation}
  if(event.method==='thread/goal/updated')patch={goal:p.goal,goalError:null}
  if(event.method==='thread/goal/cleared')patch={goal:null,goalError:null}
  if(event.method==='item/completed'&&p.item?.type==='plan')patch={proposal:p.item.text,proposalTurnId:p.turnId,proposalComplete:true}
  if(!patch)return
  const next={...this.states.get(conversationId),...patch};this.states.set(conversationId,next)
  await this.store.update(data=>{data.copilotSessions||={};data.copilotSessions[conversationId]={...data.copilotSessions[conversationId],...patch}})
 }
 async snapshot(id) {
  sessionId(id);const data=await this.store.read();const cached={...data.copilotSessions?.[id],...this.states.get(id)},threadId=data.chatThreads?.[id]?.threadId
  if(threadId&&this.runtime.state==='ready') {
   try {cached.goal=(await this.runtime.request('thread/goal/get',{threadId})).goal;cached.goalError=null}catch(e){cached.goalError=e.message}
   try {const result=await this.runtime.request('thread/read',{threadId,includeTurns:true});const turn=[...(result.thread.turns||[])].reverse().find(t=>t.items?.some(i=>i.type==='plan'));if(turn){cached.proposal=turn.items.filter(i=>i.type==='plan').at(-1).text;cached.proposalTurnId=turn.id}}catch(e){cached.restoreError=e.message}
  }
  const queuedAttachments=new Set((data.runs||[]).filter(r=>r.conversationId===id&&['queued','running','waiting'].includes(r.status)).flatMap(r=>r.value?.attachments||[]))
  return {...cached,attachments:(await this.attachments.list(id)).filter(a=>!queuedAttachments.has(a.id)),questions:[...this.runtime.questions.values()].filter(q=>q.params.threadId===threadId),running:!!threadId && this.runtime.currentTurn?.threadId===threadId,activeConversationId:Object.entries(data.chatThreads||{}).find(([,v])=>v.threadId===this.runtime.currentTurn?.threadId)?.[0]||''}
 }
}
module.exports={Copilot,validateSettings,turnOptions,PLAN_TOOLS}
