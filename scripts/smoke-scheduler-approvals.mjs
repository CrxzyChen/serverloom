import {_electron as electron} from 'playwright'
import {mkdtemp,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/scheduler-approval-'))
const app=await electron.launch({args:['.'],env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0'}})
async function until(page,fn){for(let i=0;i<450;i++){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Expected scheduler state not reached: '+JSON.stringify(await page.evaluate(()=>window.servers.schedulerSnapshot())))}
let closed=false
try{
 const page=await app.firstWindow();await until(page,async()=>(await window.servers.load()).runtime.state==='ready')
 // Simulate only the external model and remote command. All app queue, IPC,
 // approval, persistence, notification routing and renderer code remain real.
 await app.evaluate(({Notification})=>{
  const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')
  const {Runtime}=require(process.cwd()+'/electron/runtime.cjs'),{ServerTools}=require(process.cwd()+'/electron/server-tools.cjs'),{randomUUID}=require('node:crypto')
  global.testCalls=0;global.testNotifications=[];Notification.prototype.show=function(){global.testNotifications.push(this)}
  ServerTools.prototype.execute=async()=>{global.testCalls++;return{stdout:'MOCK_COMMAND_OK'}}
  const original=Runtime.prototype.request
  Runtime.prototype.request=async function(method,p){
   if(method==='model/list')return{data:[{model:'mock-model',displayName:'Mock',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null}
   if(method==='collaborationMode/list')return{data:[{mode:'default'},{mode:'plan'}]}
   if(method==='account/read')return{account:{type:'chatgpt',email:'test@example.invalid'}}
   if(method==='thread/start')return{thread:{id:randomUUID()}}
   if(method==='thread/resume')return{thread:{id:p.threadId}}
   if(method==='thread/read')return{thread:{turns:[]}}
   if(method==='thread/goal/get')return{goal:null}
   if(method==='turn/start'){
    const turnId=randomUUID(),threadId=p.threadId;this.currentTurn={threadId,turnId};this.emit('event',{method:'turn/started',params:{threadId,turn:{id:turnId}}})
    setTimeout(async()=>{const controller=new AbortController(),key=randomUUID();this.toolCalls.set(key,controller)
     try{if(!p.input[0].text.startsWith('MANUAL_TEST'))await this.toolHandler({threadId,tool:'servers_exec',arguments:{id:global.testServer,command:'uptime',purpose:'mock approval test'}},controller.signal)
      if(controller.signal.aborted)return
      this.emit('event',{method:'item/completed',params:{threadId,item:{id:randomUUID(),type:'agentMessage',text:'MOCK_RESULT'}}})
      this.emit('event',{method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}})
     }catch(e){this.emit('event',{method:'turn/completed',params:{threadId,turn:{id:turnId,status:'failed',error:{message:e.message}}}})}finally{this.toolCalls.delete(key);this.currentTurn=null}
    },20)
    return{turn:{id:turnId}}
   }
   if(method==='turn/interrupt'){this.cancelTools();this.emit('event',{method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});this.currentTurn=null;return{}}
   return original.call(this,method,p)
  }
 })
 const server=await page.evaluate(()=>window.servers.saveServer({name:'Mock server',host:'example.invalid',user:'test',port:22,authType:'sshAgent'}))
 await app.evaluate((_,id)=>{global.testServer=id},server.id)
 const task=await page.evaluate(serverId=>window.servers.saveSchedule({name:'审批测试',prompt:'APPROVAL_TEST',timezone:'UTC',rule:{type:'daily',time:'09:00'},serverIds:[serverId],conversationMode:'new',operations:'approval',missedPolicy:'once',notification:'attention',timeoutMinutes:5,enabled:false}),server.id)
 await page.evaluate(id=>window.servers.runSchedule(id),task.id)
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs[0]?.status==='waiting')
 assert.equal(await app.evaluate(()=>global.testCalls),0)
 await page.evaluate(()=>window.servers.windowControl('close'))
 const manual=await page.evaluate(()=>window.servers.send({conversationId:'manual-test',text:'MANUAL_TEST'}))
 assert.equal((await page.evaluate(()=>window.servers.schedulerSnapshot())).runs[1].status,'queued')
 await until(page,async()=>{const s=await window.servers.schedulerSnapshot();return s.runs[0]?.status==='waiting'})
 await app.evaluate(()=>global.testNotifications.at(-1).emit('click'))
 await page.getByText('需要批准此操作',{exact:true}).waitFor()
 await page.reload()
 await page.getByText('需要批准此操作',{exact:true}).waitFor()
 await page.screenshot({path:'artifacts/scheduler-approval.png'})
 await page.getByRole('button',{name:'批准本次',exact:true}).click()
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.every(r=>r.status==='completed'))
 assert.equal(await app.evaluate(()=>global.testCalls),1)
 await page.evaluate(id=>window.servers.runSchedule(id),task.id)
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.at(-1)?.status==='waiting')
 await app.evaluate(()=>global.testNotifications.at(-1).emit('click'))
 await page.getByRole('button',{name:'拒绝',exact:true}).click()
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.at(-1)?.status==='failed')
 assert.equal(await app.evaluate(()=>global.testCalls),1)
 await page.evaluate(id=>window.servers.runSchedule(id),task.id)
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.at(-1)?.status==='waiting')
 await page.evaluate(async()=>{const s=await window.servers.schedulerSnapshot();await window.servers.cancelRun(s.runs.at(-1).id)})
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.at(-1)?.status==='interrupted')
 assert.equal(await app.evaluate(()=>global.testCalls),1)
 await page.evaluate(id=>window.servers.runSchedule(id),task.id)
 await until(page,async()=>(await window.servers.schedulerSnapshot()).runs.at(-1)?.status==='waiting')
 await app.evaluate(({dialog})=>{global.quitChoice=0;dialog.showMessageBox=async(_,options)=>{global.quitMessage=options.message;return{response:global.quitChoice}}})
 await page.evaluate(()=>window.servers.quit());assert.match(await app.evaluate(()=>global.quitMessage),/1 个任务/);assert.equal((await page.evaluate(()=>window.servers.schedulerSnapshot())).runs.at(-1).status,'waiting')
 await app.evaluate(()=>{global.quitChoice=1});const exit=app.waitForEvent('close');await page.evaluate(()=>window.servers.quit()).catch(()=>{});await exit;closed=true
 const persisted=JSON.parse(await readFile(resolve(data,'servers.json'),'utf8'));assert.equal(persisted.runs.at(-1).status,'interrupted')
 console.log('PASS quit confirmation cancels or stops active work and persists interruption')
 console.log('PASS simulated external turn: hidden approval, notification navigation, reload recovery, accept/decline/cancel, serial manual queue')
}finally{if(!closed)await app.close()}
