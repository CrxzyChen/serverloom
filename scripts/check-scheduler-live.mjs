import { _electron as electron } from 'playwright'
import { mkdtemp,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/scheduler-live-'))
async function until(page,fn,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,1000))}throw new Error('Timed out waiting for native scheduler')}
const app=await electron.launch({args:['.'],env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0',SERVERS_TEST_RUNTIME_HOME:(process.env.SERVERLOOM_TEST_RUNTIME_HOME || join(process.env.APPDATA,'serverloom','codex'))}})
try{
 const page=await app.firstWindow();await until(page,async()=>(await window.servers.load()).runtime.state==='ready',45000)
 const task=await page.evaluate(()=>window.servers.saveSchedule({name:'后台一次性测试',settings:{model:'gpt-5.3-codex-spark',effort:'low',mode:'default'},prompt:'这是客户端调度集成测试。请只回复 SCHEDULER_OK，不调用工具，不做其他操作。',timezone:'UTC',rule:{type:'once',at:new Date(Date.now()+2000).toISOString()},serverIds:[],conversationMode:'new',operations:'readonly',missedPolicy:'once',notification:'none',timeoutMinutes:3,enabled:true}))
 await page.evaluate(()=>window.servers.windowControl('close'))
 await until(page,async()=>{const s=await window.servers.schedulerSnapshot();return s.runs.some(r=>['completed','failed','interrupted'].includes(r.status))})
 let snapshot=await page.evaluate(()=>window.servers.schedulerSnapshot()),first=snapshot.runs.find(r=>r.scheduleId===task.id)
 assert.equal(first.status,'completed',first.error);assert.match(first.result,/SCHEDULER_OK/)
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false)
 assert.equal(snapshot.tasks[0].enabled,false)
 console.log('PASS native scheduled turn completes with window hidden; once schedule disables')
 await page.evaluate(async()=>{await window.servers.stop();await window.servers.start()})
 const followup=await page.evaluate(async({task,first})=>window.servers.saveSchedule({...task,id:undefined,name:'继续已有会话测试',prompt:'只回复 FOLLOWUP_OK，不调用工具。',conversationMode:'existing',conversationId:first.conversationId,enabled:false}),{task,first})
 await page.evaluate(id=>window.servers.runSchedule(id),followup.id)
 await until(page,async()=>{const s=await window.servers.schedulerSnapshot();return s.runs.length===2&&s.runs.every(r=>['completed','failed','interrupted'].includes(r.status))})
 snapshot=await page.evaluate(()=>window.servers.schedulerSnapshot());assert.equal(snapshot.runs[1].status,'completed',snapshot.runs[1].error);assert.equal(snapshot.runs[1].threadId,first.threadId);assert.match(snapshot.runs[1].result,/FOLLOWUP_OK/)
 await writeFile('artifacts/scheduler-live-result.json',JSON.stringify({runs:snapshot.runs.map(({id,status,result,threadId,startedAt,endedAt})=>({id,status,result,threadId,startedAt,endedAt}))},null,2))
 console.log('PASS fixed conversation resumes same native thread after runtime restart')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show())
 await page.getByRole('button',{name:'定时任务',exact:true}).click()
 await page.getByRole('button',{name:'后台一次性测试 已暂停'}).click()
 await page.getByText('SCHEDULER_OK',{exact:true}).waitFor()
 const config={name:'NATIVE_TOOL_CREATED',prompt:'只回复 TOOL_TEST',timezone:'UTC',rule:{type:'daily',time:'09:00'},enabled:false,serverIds:[],conversationMode:'new',operations:'readonly',missedPolicy:'once',notification:'none',timeoutMinutes:1}
 await page.evaluate(config=>window.servers.send({conversationId:'native-schedule-tool',text:'请使用 schedules_save 工具保存以下任务 JSON，保持 enabled=false，不执行该任务。保存后只回复 CREATED_OK。配置：'+JSON.stringify(config),settings:{model:'gpt-5.3-codex-spark',effort:'low',mode:'default'}}),config)
 await until(page,async()=>{const s=await window.servers.schedulerSnapshot();return s.runs.length===3&&s.runs.every(r=>['completed','failed','interrupted'].includes(r.status))})
 snapshot=await page.evaluate(()=>window.servers.schedulerSnapshot());assert.equal(snapshot.runs[2].status,'completed',snapshot.runs[2].error);assert.ok(snapshot.tasks.some(t=>t.name==='NATIVE_TOOL_CREATED'&&!t.enabled));console.log('PASS native Copilot creates a disabled schedule through schedules_save')
}finally{await app.close()}
