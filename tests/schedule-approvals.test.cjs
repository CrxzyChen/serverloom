const test=require('node:test'),assert=require('node:assert/strict')
const {ScheduleApprovals}=require('../electron/schedule-approvals.cjs')
const {executeScheduleTool}=require('../electron/schedule-tools.cjs')
test('scheduled tools enforce server scope, readonly mode and one-shot approval',async()=>{
 const events=[],guard=new ScheduleApprovals(e=>events.push(e)),controller=new AbortController()
 const run={conversationId:'chat',task:{serverIds:['home'],operations:'readonly'}}
 await assert.rejects(()=>guard.check(run,{tool:'servers_exec',arguments:{id:'home'}},controller.signal),/只读/)
 await assert.rejects(()=>guard.check(run,{tool:'servers_inspect_hardware',arguments:{id:'other'}},controller.signal),/授权范围/)
 await assert.rejects(()=>guard.check(run,{tool:'schedules_save',arguments:{}},controller.signal),/自行修改/)
 run.task.operations='approval'
 const pending=guard.check(run,{threadId:'thread',tool:'servers_exec',arguments:{id:'home',command:'uptime'}},controller.signal)
 assert.equal(guard.pending.size,1);guard.answer(events[0].id,'accept');await pending
 assert.equal(guard.pending.size,0);assert.throws(()=>guard.answer(events[0].id,'accept'),/失效/)
 const rejected=guard.check(run,{threadId:'thread',tool:'servers_exec',arguments:{id:'home'}},controller.signal)
 guard.answer(events.at(-1).id,'decline');await assert.rejects(()=>rejected,/拒绝/)
})
test('canceling queued approval removes it and rejects command',async()=>{
 const guard=new ScheduleApprovals(()=>{}),c=new AbortController()
 const p=guard.check({task:{serverIds:['home'],operations:'approval'}},{tool:'servers_exec',arguments:{id:'home'}},c.signal)
 c.abort(new Error('cancel'));await assert.rejects(()=>p,/cancel/);assert.equal(guard.pending.size,0)
})
test('schedule tool supplies defaults and rejects extra fields',async()=>{
 let saved;const scheduler={save:async v=>{saved=v;return v}}
 await executeScheduleTool(scheduler,{tool:'schedules_save',arguments:{config:JSON.stringify({name:'test',prompt:'hello'})}})
 assert.equal(saved.operations,'readonly');assert.equal(saved.enabled,true)
 await assert.rejects(()=>executeScheduleTool(scheduler,{tool:'schedules_list',arguments:{unexpected:true}}),/字段/)
})
