import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import yaml from 'js-yaml'
const pkg=JSON.parse(await readFile('package.json','utf8')), root=pkg.build.directories.output
const files=await readdir(root), installer=`ServerLoom-Setup-${pkg.version}-x64.exe`, zip=`ServerLoom-${pkg.version}-x64.zip`
for(const name of [installer,installer+'.blockmap',zip]) if(!files.includes(name))throw Error(`Missing release artifact: ${name}`)
const channel=pkg.version.includes('-')?pkg.version.split('-')[1].split('.')[0]:'latest'
const metadata=files.filter(f=>f.endsWith('.yml')&&!f.startsWith('builder-'))
if(!metadata.includes(channel+'.yml'))throw Error('Missing channel manifest')
const sourceFiles=new Set([installer,installer+'.blockmap',zip,...metadata])
for(const file of metadata){const info=yaml.load(await readFile(join(root,file),'utf8'));if(info.version!==pkg.version)throw Error('Manifest version mismatch');for(const entry of info.files||[]){if(entry.url!==installer)throw Error('Unexpected update payload');const bytes=await readFile(join(root,entry.url));if(createHash('sha512').update(bytes).digest('base64')!==entry.sha512||bytes.length!==entry.size)throw Error('Manifest integrity mismatch')}}
const checks=[]
for(const file of sourceFiles){const bytes=await readFile(join(root,file));checks.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`)}
await writeFile(join(root,'SHA256SUMS.txt'),checks.join('\n')+'\n')
console.log(`Verified ${sourceFiles.size} release assets and generated SHA256SUMS.txt`)
