const test = require('node:test')
const assert = require('node:assert/strict')
const { Scheduler, nextRun, validateTask } = require('../electron/scheduler.cjs')
class MemoryStore {
  constructor(data = {}) { this.data = { servers: [], schedules: [], runs: [], ...data }; this.queue = Promise.resolve() }
  async read() { await this.queue; return structuredClone(this.data) }
  update(fn) { const job = this.queue.then(() => { const copy = structuredClone(this.data); const result = fn(copy); this.data = copy; return result }); this.queue = job.catch(() => {}); return job }
}
const at = Date.parse('2026-09-14T10:00:00Z')
const task = (extra = {}) => ({ name:'巡检', prompt:'查看硬件', timezone:'Asia/Shanghai', rule:{type:'interval', at:new Date(at).toISOString(), minutes:5}, serverIds:[], conversationMode:'new', operations:'readonly', missedPolicy:'once', notification:'attention', timeoutMinutes:5, enabled:true, ...extra })
const until = async fn => { for(let i=0;i<100;i++) { if(await fn())return; await new Promise(r=>setTimeout(r,5)) }; throw new Error('condition timed out') }
test('calendar schedules use explicit timezone and handle DST gaps/folds', () => {
  assert.equal(nextRun({type:'daily',time:'09:00'},'Asia/Shanghai',at),'2026-09-15T01:00:00.000Z')
  assert.equal(nextRun({type:'weekly',time:'09:00',days:[1]},'Asia/Shanghai',at),'2026-09-21T01:00:00.000Z')
  assert.equal(nextRun({type:'daily',time:'02:30'},'America/New_York',Date.parse('2026-03-08T05:00Z')),'2026-03-09T06:30:00.000Z')
  assert.equal(nextRun({type:'daily',time:'01:30'},'America/New_York',Date.parse('2026-11-01T05:31Z')),'2026-11-02T06:30:00.000Z')
})
test('validation rejects missing targets and invalid timing', () => {
  assert.throws(()=>validateTask(task({serverIds:['missing']}),{servers:[]},at),/服务器/)
  assert.throws(()=>validateTask(task({rule:{type:'interval',minutes:0,at:new Date(at).toISOString()}}),{servers:[]},at),/间隔/)
})
test('missed intervals catch up only once and persist a future deadline', async () => {
  const store=new MemoryStore(), scheduler=new Scheduler(store,async()=>({text:'ok'}),undefined,undefined,()=>at)
  await scheduler.init(); const t=await scheduler.save(task()); scheduler.clock=()=>at+3600000
  await Promise.all([scheduler.tick(),scheduler.tick()]); await until(async()=>(await scheduler.snapshot()).runs[0]?.status==='completed')
  const s=await scheduler.snapshot(); assert.equal(s.runs.length,1); assert.equal(s.tasks[0].nextRunAt,'2026-09-14T11:05:00.000Z'); assert.equal(s.runs[0].scheduleId,t.id)
  await scheduler.shutdown()
})
test('manual and scheduled requests share one serial executor; cancellation advances queue', async () => {
  const store=new MemoryStore(); let concurrent=0,max=0
  const scheduler=new Scheduler(store,async(run,signal)=>{concurrent++;max=Math.max(max,concurrent);try{await new Promise((resolve,reject)=>{if(run.source==='manual')resolve();else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});return{text:'done'}}finally{concurrent--}},undefined,undefined,()=>at)
  await scheduler.init();const t=await scheduler.save(task());const first=await scheduler.runNow(t.id)
  await until(()=>scheduler.current?.id===first.id)
  await assert.rejects(()=>scheduler.runNow(t.id),/队列/)
  const second=await scheduler.manual({conversationId:'test',text:'hello'});await scheduler.cancel(first.id)
  await until(async()=>(await scheduler.snapshot()).runs.find(r=>r.id===second.runId)?.status==='completed')
  assert.equal(max,1);assert.equal((await scheduler.snapshot()).runs[0].status,'interrupted');await scheduler.shutdown()
})
test('restart marks uncertain runs interrupted without replay; skip policy records skipped', async () => {
  const t=validateTask(task({missedPolicy:'skip'}),{servers:[]},at)
  const store=new MemoryStore({schedules:[t],runs:[{id:'old',status:'running'}]});let calls=0
  const scheduler=new Scheduler(store,async()=>{calls++},undefined,undefined,()=>at+3600000)
  await scheduler.init();const s=await scheduler.snapshot();assert.equal(s.runs[0].status,'interrupted');assert.equal(s.runs[1].status,'skipped');assert.equal(calls,0);await scheduler.shutdown()
})
test('timeout interrupts a run and records the timeout reason',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const store=new MemoryStore(),scheduler=new Scheduler(store,async(run,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),undefined,undefined,()=>at)
  await scheduler.init();const saved=await scheduler.save(task({timeoutMinutes:1}));await scheduler.runNow(saved.id)
  for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))
  t.mock.timers.tick(60000)
  for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))
  const run=(await scheduler.snapshot()).runs[0];assert.equal(run.status,'interrupted');assert.match(run.error,/超时/);await scheduler.shutdown()
})
