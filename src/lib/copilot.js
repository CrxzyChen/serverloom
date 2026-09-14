import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
export function useCopilot(api, sessions, conversationId, runtimeState, reportError) {
 const models=ref([]), modes=ref([]), catalogError=ref(''), loading=ref(false), saving=ref(false), attaching=ref(false), states=ref({}), limits=ref(null), limitsError=ref(''), limitsAt=ref(null), limitsLoading=ref(false), preview=ref(null)
 const session=computed(()=>sessions.value.find(s=>s.id===conversationId.value)), state=computed(()=>states.value[conversationId.value]||{}), attachments=computed(()=>state.value.attachments||[])
 const settings=computed(()=>session.value?.settings||{model:'',effort:'',mode:'default'})
 const model=computed(()=>models.value.find(m=>m.model===settings.value.model))
 let catalogPromise, limitsPromise, limitTimer
 function setState(id,patch){states.value[id]={...states.value[id],...patch}}
 async function catalog(refresh=false) {
  if(!api||runtimeState.value!=='ready')return
  if(catalogPromise)return catalogPromise
  loading.value=true;catalogError.value=''
  catalogPromise=(async()=>{try{const data=await api.catalog(refresh);models.value=data.models;modes.value=data.modes;const chosen=data.models.find(m=>m.isDefault)||data.models[0];if(session.value&&!session.value.settings&&chosen){session.value.settings={model:chosen.model,effort:chosen.defaultReasoningEffort,mode:'default'}}}catch(e){catalogError.value=e.message}finally{loading.value=false;catalogPromise=null}})();return catalogPromise
 }
 async function refreshLimits(){if(!api||runtimeState.value!=='ready')return;if(limitsPromise)return limitsPromise;limitsLoading.value=true;limitsPromise=(async()=>{try{limits.value=await api.limits();limitsAt.value=Date.now();limitsError.value=''}catch(e){limitsError.value=e.message}finally{limitsLoading.value=false;limitsPromise=null}})();return limitsPromise}
 async function restore(id=conversationId.value){if(!api||!id)return;try{const snapshot=await api.copilotSnapshot(id);setState(id,snapshot);const s=sessions.value.find(s=>s.id===id);if(s&&snapshot.settings&&!saving.value)s.settings=snapshot.settings}catch(e){setState(id,{restoreError:e.message})}}
 async function changeSettings(patch){const id=conversationId.value,s=session.value;if(!s||saving.value)return;const next={...settings.value,...patch};const m=models.value.find(m=>m.model===next.model);if(m&&!m.supportedReasoningEfforts.some(e=>e.reasoningEffort===next.effort))next.effort=m.defaultReasoningEffort;saving.value=true;try{s.settings=await api.saveCopilotSettings({conversationId:id,settings:next})}catch(e){reportError(e.message)}finally{saving.value=false}}
 async function add(files){if(attaching.value)return;const id=conversationId.value;attaching.value=true;try{const result=await api.addAttachments(id,files);setState(id,{attachments:[...(states.value[id]?.attachments||[]),...result]})}catch(e){reportError(e.message)}finally{attaching.value=false}}
 async function drop(event){event.preventDefault();const files=[...(event.dataTransfer?.files||[])];if(files.length)await add(files)}
 async function paste(event){const image=[...(event.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(!image)return;event.preventDefault();if(attaching.value)return;const id=conversationId.value;attaching.value=true;try{const file=image.getAsFile();if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MiB');const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));const result=await api.pasteAttachment(id,btoa(text));setState(id,{attachments:[...(states.value[id]?.attachments||[]),...result]})}catch(e){reportError(e.message)}finally{attaching.value=false}}
 async function remove(id){const key=conversationId.value;try{await api.removeAttachment({conversationId:key,id});setState(key,{attachments:attachments.value.filter(a=>a.id!==id)})}catch(e){reportError(e.message)}}
 async function view(a,owner=conversationId.value){try{preview.value={name:a.name,...await api.previewAttachment({conversationId:owner,id:a.id})}}catch(e){reportError(e.message)}}
 async function answer(request,answers){try{await api.answerQuestion({id:request.id,answers});for(const [id,state] of Object.entries(states.value))setState(id,{questions:(state.questions||[]).filter(q=>q.id!==request.id)})}catch(e){reportError(e.message)}}
 function event(event,id){const p=event.params||{},method=event.method
  if(method==='account/rateLimits/updated'){clearTimeout(limitTimer);limitTimer=setTimeout(refreshLimits,250)}
  if(method==='account/updated'||method==='account/login/completed'){limits.value=null;limitsAt.value=null;models.value=[];catalog(true);refreshLimits()}
  if(!id)return
  if(method==='thread/goal/updated')setState(id,{goal:p.goal,goalError:null})
  if(method==='thread/goal/cleared')setState(id,{goal:null})
  if(method==='turn/plan/updated')setState(id,{plan:p.plan,planTurnId:p.turnId,explanation:p.explanation})
  if(method==='item/plan/delta')setState(id,{proposal:(states.value[id]?.proposalTurnId===p.turnId?states.value[id]?.proposal||'':'')+p.delta,proposalTurnId:p.turnId,proposalComplete:false})
  if(method==='item/completed'&&p.item?.type==='plan')setState(id,{proposal:p.item.text,proposalTurnId:p.turnId,proposalComplete:true})
  if(method==='item/tool/requestUserInput')setState(id,{questions:[...(states.value[id]?.questions||[]),event]})
  if(method==='serverRequest/resolved')for(const [key,s] of Object.entries(states.value))setState(key,{questions:(s.questions||[]).filter(q=>q.id!==p.requestId)})
  if(method==='turn/started')setState(id,{running:true})
  if(method==='turn/completed'){setState(id,{running:false,questions:[]});refreshLimits()}
  if(method==='model/rerouted')reportError(`运行时将本次模型从 ${p.fromModel} 调整为 ${p.toModel}：${p.reason}`)
 }
 watch(conversationId,async id=>{await restore(id);if(models.value.length&&!session.value?.settings){const m=models.value.find(m=>m.isDefault)||models.value[0];session.value.settings={model:m.model,effort:m.defaultReasoningEffort,mode:'default'}}})
 watch(runtimeState,async value=>{if(value==='ready'){await Promise.allSettled([catalog(true),refreshLimits(),restore()])}else{for(const [id,s]of Object.entries(states.value))setState(id,{running:false,questions:[]});catalogError.value='运行时尚未就绪'}})
 onMounted(()=>{restore();if(runtimeState.value==='ready'){catalog();refreshLimits()}});onUnmounted(()=>clearTimeout(limitTimer))
 return {models,modes,catalogError,loading,saving,attaching,settings,model,state,attachments,limits,limitsError,limitsAt,limitsLoading,preview,catalog,refreshLimits,restore,changeSettings,add,drop,paste,remove,view,answer,event,setState}
}
