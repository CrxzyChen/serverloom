import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join,basename} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Bundled desktop runtime currently targets Windows x64')
const tag='rust-v0.154.0',asset='codex-package-x86_64-pc-windows-msvc.tar.gz'
const expected='94cc5b3632769504c809f6c0364b693c0dfddc5c30c8361095d2263a07ac45a4'
const url=`https://github.com/openai/codex/releases/download/${tag}/${asset}`
const cache=resolve('artifacts/public-runtime'),archive=join(cache,asset),target=resolve('resources/runtime')
await mkdir(cache,{recursive:true});await mkdir(target,{recursive:true})
let bytes
try{bytes=await readFile(archive)}catch(e){if(e.code!=='ENOENT')throw e;console.log(`Downloading public Codex ${tag}`);const response=await fetch(url);if(!response.ok)throw new Error(`Download failed: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Downloaded runtime archive checksum mismatch');await writeFile(archive,bytes)}
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Cached runtime archive is incomplete or has the wrong checksum')
bytes=null
const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8',maxBuffer:4*1024*1024}).trim().split(/\r?\n/)
const files=['codex.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe'],manifest={platform:'win32',arch:'x64',version:'codex-cli 0.154.0',source:url,archiveSha256:expected,files:{}}
for(const name of files){const matches=entries.filter(entry=>basename(entry)===name);if(matches.length!==1)throw new Error(`Expected one ${name} in public archive`);const content=execFileSync('tar',['-xOzf',archive,matches[0]],{maxBuffer:512*1024*1024,windowsHide:true});await writeFile(join(target,name),content);manifest.files[name]=createHash('sha256').update(content).digest('hex')}
const version=execFileSync(join(target,'codex.exe'),['--version'],{encoding:'utf8',windowsHide:true}).trim();if(version!==manifest.version)throw new Error(`Unexpected runtime version: ${version}`)
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(`Verified and installed public ${version}`)
