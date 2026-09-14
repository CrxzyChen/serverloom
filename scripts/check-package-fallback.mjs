import {_electron as electron} from 'playwright'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const app=await electron.launch({executablePath:resolve('release-alpha/win-unpacked/ServerLoom.exe')})
try{
 await app.firstWindow()
 const output=await app.evaluate(async({app})=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')
  const {Server,Client}=require('ssh2'),{generateKeyPairSync}=require('node:crypto')
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
  return new Promise((resolve,reject)=>{
   const server=new Server({hostKeys:[privateKey]},client=>{client.on('authentication',ctx=>ctx.accept()).on('ready',()=>client.on('session',accept=>accept().on('exec',accept=>{const stream=accept();stream.write('FALLBACK_OK');stream.exit(0);stream.end()})))})
   const client=new Client();let output='';const timer=setTimeout(()=>{client.end();server.close();reject(new Error('Loopback SSH timeout'))},15000)
   const finish=error=>{clearTimeout(timer);client.end();server.close();error?reject(error):resolve(output)}
   server.on('error',finish);server.listen(0,'127.0.0.1',()=>client.on('error',finish).on('ready',()=>client.exec('test',(error,stream)=>{if(error)return finish(error);stream.on('data',chunk=>output+=chunk.toString()).on('close',()=>finish())})).connect({host:'127.0.0.1',port:server.address().port,username:'fixture',hostVerifier:()=>true}))
  })
 })
 assert.equal(output,'FALLBACK_OK');console.log('PASS packaged SSH2 Node crypto fallback over isolated loopback')
}finally{await app.close()}
