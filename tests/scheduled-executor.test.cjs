const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {createExecutor}=require('../electron/scheduled-executor.cjs')
class Runtime extends EventEmitter{constructor(){super();this.state='ready'}cancelTools(){}stop(){this.state='stopped';this.emit('event',{method:'runtime/status',params:{state:'stopped'}})}async request(method){if(method==='turn/interrupt'){setImmediate(()=>this.event('turn/completed',{turn:{id:'turn',status:'interrupted'}}));return{}}}event(method,params={}){this.emit('event',{method,params:{threadId:'thread',...params}})}}
const run={value:{text:'hello',conversationId:'chat'}},store={read:async()=>({})}
const tick=()=>new Promise(r=>setImmediate(r))
test('executor buffers events arriving before turn/start response and persists result',async()=>{
 const r=new Runtime(),states=[]
 const exec=createExecutor(r,async()=>{r.event('item/completed',{item:{id:'item',type:'agentMessage',text:'OK'}});r.event('turn/completed',{turn:{id:'turn',status:'completed'}});return{threadId:'thread',turnId:'turn'}},store)
 assert.deepEqual(await exec(run,new AbortController().signal,async(s,p)=>states.push([s,p])),{text:'OK'});assert.equal(states.at(-1)[1].result,'OK');assert.equal(r.listenerCount('event'),0)
})
test('executor waits through multiple approvals and releases only on turn completion',async()=>{
 const r=new Runtime(),states=[],exec=createExecutor(r,async()=>({threadId:'thread',turnId:'turn'}),store)
 let done=false;const p=exec(run,new AbortController().signal,async(s)=>states.push(s)).then(()=>{done=true})
 await tick();r.emit('event',{id:'a',method:'item/commandExecution/requestApproval',params:{threadId:'thread'}});r.emit('event',{id:'b',method:'item/tool/requestUserInput',params:{threadId:'thread'}})
 r.event('serverRequest/resolved',{requestId:'a'});await tick();assert.equal(states.at(-1),'waiting');assert.equal(done,false)
 r.event('serverRequest/resolved',{requestId:'b'});r.event('turn/completed',{turn:{id:'turn',status:'completed'}});await p;assert.equal(states.at(-1),'running')
})
test('executor cancellation waits for interruption and runtime loss fails without replay',async()=>{
 const r=new Runtime(),c=new AbortController(),exec=createExecutor(r,async()=>({threadId:'thread',turnId:'turn'}),store)
 const p=exec(run,c.signal,async()=>{});await tick();c.abort(new Error('cancel'));await assert.rejects(()=>p,/中断/)
 const second=exec(run,new AbortController().signal,async()=>{});await tick();r.stop();await assert.rejects(()=>second,/连接中断/)
})
