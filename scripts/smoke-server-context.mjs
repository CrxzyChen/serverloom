import {_electron as electron} from 'playwright'
import {mkdtemp} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/server-context-'))
const app=await electron.launch({args:['.'],env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0'}})
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('button',{name:'查看硬件状态',exact:true}).click()
 await page.locator('.error-banner').getByText('请先在左侧选择要检查的服务器',{exact:true}).waitFor()
 const ids=await page.evaluate(async()=>{const ids=[];for(const name of ['Fixture A','Fixture B'])ids.push((await window.servers.saveServer({name,host:name==='Fixture A'?'192.0.2.10':'192.0.2.11',user:'test',port:22,authType:'sshAgent'})).id);return ids})
 await page.reload()
 for(const [index,name] of ['Fixture A','Fixture B'].entries()){
  await page.locator('.server-row').filter({hasText:name}).click()
  await page.getByRole('button',{name:'查看硬件状态',exact:true}).click()
  await page.locator('.chat-context').getByText(name,{exact:true}).waitFor()
  assert.match(await page.getByRole('textbox',{name:'发送给 Codex 的任务',exact:true}).inputValue(),/CPU/)
  // Save is debounced; reload after settling verifies that the target remains bound.
  await page.waitForTimeout(350)
  const saved=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('servers-workbench'));return d.sessions.find(s=>s.id===d.conversationId).serverId})
  assert.equal(saved,ids[index])
 }
 assert.deepEqual(errors,[])
 console.log('PASS resource shortcuts bind selected server, switch targets safely, and reject missing context')
}finally{await app.close()}
