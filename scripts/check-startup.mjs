import {_electron as electron} from 'playwright'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const app=await electron.launch({executablePath:resolve('release-alpha/win-unpacked/ServerLoom.exe')})
let original
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:'运行时设置',exact:true}).waitFor()
 original=await page.evaluate(()=>window.servers.desktopSettings())
 const result=await page.evaluate(()=>window.servers.desktopSettings({loginStartup:true,startHidden:true}))
 assert.equal(result.loginStartup,true);assert.equal(result.startHidden,true)
 const native=await app.evaluate(({app})=>app.getLoginItemSettings({args:['--hidden']}))
 assert.equal(native.openAtLogin,true)
 console.log('PASS packaged Windows login startup registration with --hidden')
}finally{
 if(original){const page=await app.firstWindow();await page.evaluate(v=>window.servers.desktopSettings(v),{loginStartup:!!original.loginStartup,startHidden:!!original.startHidden})}
 await app.close()
}

const hidden=await electron.launch({executablePath:resolve('release-alpha/win-unpacked/ServerLoom.exe'),args:['--hidden']})
try{await hidden.firstWindow();assert.equal(await hidden.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);console.log('PASS packaged --hidden launch starts without showing the window')}finally{await hidden.close()}
