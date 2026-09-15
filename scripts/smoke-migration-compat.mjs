import { _electron as electron } from 'playwright'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { scryptSync, randomBytes, createCipheriv } from 'node:crypto'
import assert from 'node:assert/strict'
const data=await mkdtemp(resolve('artifacts/migration-compat-')),file=join(data,'legacy.servers'),password='synthetic-migration-pass'
const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024})
const cipher=createCipheriv('aes-256-gcm',key,iv)
cipher.setAAD(Buffer.from('Servers migration v1 / scrypt-32768-8-1 / AES-256-GCM'))
const bytes=Buffer.concat([cipher.update(JSON.stringify({version:1,servers:[{config:{name:'Legacy fixture',host:'example.invalid',user:'tester',port:22,authType:'sshAgent'}}]})),cipher.final()]);key.fill(0)
await writeFile(file,JSON.stringify({format:'servers-encrypted',version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')}))
const app=await electron.launch({args:['.'],env:{...process.env,SERVERS_TEST_DATA:data,SERVERS_DEV:'0'}})
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.locator('.asset-bottom').getByRole('button',{name:'导入连接包',exact:true}).waitFor()
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},file)
 await page.locator('.asset-bottom').getByRole('button',{name:'导入连接包',exact:true}).click()
 await page.getByLabel('连接包口令',{exact:true}).fill('incorrect-password')
 await page.getByRole('button',{name:'解密并预览',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'完整性校验'}).waitFor()
 assert.doesNotMatch(await page.locator('.migration-dialog .form-error').innerText(),/Error invoking remote method/)
 await page.getByLabel('连接包口令',{exact:true}).fill(password)
 await page.getByRole('button',{name:'解密并预览',exact:true}).click()
 await page.getByRole('heading',{name:'预览连接包',exact:true}).waitFor()
 await page.getByRole('button',{name:'确认导入',exact:true}).click()
 await page.waitForFunction(async()=>(await window.servers.load()).servers.some(s=>s.name==='Legacy fixture'))
 assert.deepEqual(errors,[])
 console.log('PASS legacy package import through real UI/IPC, wrong-password retry, clean error message and saved configuration')
}finally{await app.close()}
