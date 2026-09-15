import { _electron as electron } from 'playwright'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/update-transport-'))
const fixture=join(data,'main.cjs')
await writeFile(join(data,'package.json'),JSON.stringify({name:'serverloom-update-test',version:'0.10.0-alpha.2',main:'main.cjs'}))
await writeFile(fixture,`
const {app,BrowserWindow}=require('electron')
app.setPath('userData',__dirname)
app.whenReady().then(()=>{new BrowserWindow({show:false}).loadURL('about:blank')})
`)
const app=await electron.launch({args:[data]})
try {
 const result=await app.evaluate(async ({app,autoUpdater},root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json')
  const {NsisUpdater}=require('electron-updater'),{createServer}=require('node:http'),{createHash}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path')
  const payload=Buffer.from('Synthetic update transport test: never execute this file.'), hash=createHash('sha512').update(payload).digest('base64')
  let corrupt=false
  const server=createServer((request,response)=>{
   if(request.url.startsWith('/alpha.yml')){response.end('version: 0.10.0-alpha.3\nfiles:\n  - url: fixture.exe\n    sha512: '+hash+'\n    size: '+payload.length+'\npath: fixture.exe\nsha512: '+hash+'\nreleaseDate: 2026-09-15T00:00:00.000Z\n')}
   else if(request.url.startsWith('/fixture.exe'))response.end(corrupt?Buffer.from('corrupt'):payload)
   else{response.statusCode=404;response.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
   const config=path.join(app.getPath('userData'),'update-test.yml')
   await fs.writeFile(config,'provider: generic\nurl: http://127.0.0.1:'+server.address().port+'\nupdaterCacheDirName: isolated-update-test\n')
   function create(){const u=new NsisUpdater();u.forceDevUpdateConfig=true;u.updateConfigPath=config;u.logger=null;u.channel='alpha';u.allowDowngrade=false;u.autoDownload=false;u.autoInstallOnAppQuit=false;u.disableDifferentialDownload=true;u.app.baseCachePath=app.getPath('userData');return u}
   const bad=create();corrupt=true;await bad.checkForUpdates();let rejected=false
   try{await bad.downloadUpdate()}catch{rejected=true}
   corrupt=false;const good=create();await good.checkForUpdates();const files=await good.downloadUpdate()
   const exact=(await fs.readFile(files[0])).equals(payload)
   // Exercise real quitAndInstall event ordering while replacing OS execution and app quit only.
   let installCalls=0,quitCalls=0,beforeQuit=false
   good.doInstall=()=>{installCalls++;return true};good.app.quit=()=>{quitCalls++}
   autoUpdater.once('before-quit-for-update',()=>{beforeQuit=true})
   good.quitAndInstall(false,true);await new Promise(resolve=>setImmediate(resolve))
   return {rejected,exact,installCalls,quitCalls,beforeQuit}
  }finally{await new Promise(resolve=>server.close(resolve))}
 },process.cwd())
 assert.deepEqual(result,{rejected:true,exact:true,installCalls:1,quitCalls:1,beforeQuit:true})
 console.log('PASS real electron-updater HTTP manifest, corrupt checksum rejection, download and native quit-for-update event')
}finally{await app.close()}
