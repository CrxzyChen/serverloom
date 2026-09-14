import { _electron as electron } from 'playwright'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/scheduler-ui-'))
const app=await electron.launch({args:['.'],env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0'}})
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('heading',{name:'选择服务器，开始工作。'}).waitFor()
 await page.waitForFunction(async()=>!!(await window.servers.schedulerSnapshot()),undefined,{timeout:45000})
 await page.getByRole('button',{name:'定时任务',exact:true}).click()
 await page.getByRole('button',{name:'新建任务',exact:true}).click()
 await page.getByLabel('任务名称',{exact:true}).fill('每日服务器巡检')
 await page.getByLabel('执行指令',{exact:true}).fill('汇总 CPU、内存和磁盘使用情况。')
 await page.getByLabel('时区',{exact:true}).fill('UTC')
 await page.getByRole('button',{name:'保存任务',exact:true}).click()
 await page.getByRole('heading',{name:'每日服务器巡检',exact:true}).waitFor()
 const snapshot=await page.evaluate(()=>window.servers.schedulerSnapshot());assert.equal(snapshot.tasks.length,1)
 await page.locator('.scheduler-pane:visible').evaluate(el=>{el.scrollTop=0})
 await page.screenshot({path:'artifacts/scheduler-ui.png'})
 await page.getByRole('button',{name:'关闭 每日服务器巡检',exact:true}).click()
 assert.equal(await page.getByRole('heading',{name:'每日服务器巡检',exact:true}).count(),0)
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(960,720);w.webContents.setZoomFactor(1.25)})
 await page.screenshot({path:'artifacts/scheduler-compact.png'})
 await page.evaluate(()=>window.servers.windowControl('close'))
 await page.waitForTimeout(300)
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false)
 const second=spawn(resolve('node_modules/electron/dist/electron.exe'),['.'],{env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0'},windowsHide:true,stdio:'ignore'})
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Second instance did not exit')),10000);second.on('exit',code=>{clearTimeout(timer);assert.equal(code,0);resolve()});second.on('error',reject)})
 for(let i=0;i<30;i++){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()))break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true)
 await page.reload();assert.equal((await page.evaluate(()=>window.servers.schedulerSnapshot())).tasks.length,1)
 assert.deepEqual(errors,[])
 console.log('PASS scheduler UI save, closable tab, tray hide, reload persistence')
}finally{await app.close()}
