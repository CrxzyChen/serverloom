import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
const lock=JSON.parse(await readFile('package-lock.json','utf8')),out=['ServerLoom third-party notices','Generated from the production package-lock.json dependencies.','Codex: Apache-2.0, see CODEX-LICENSE.txt and CODEX-NOTICE.txt.','Electron and Chromium notices also accompany the portable distribution.']
for(const [path,info] of Object.entries(lock.packages)){if(!path||info.dev)continue;const pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));out.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${JSON.stringify(pkg.license||info.license||'See upstream notice')}\n`);const files=(await readdir(path)).filter(name=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(name));for(const name of files){try{out.push(`--- ${name} ---\n`+await readFile(join(path,name),'utf8'))}catch(e){if(e.code!=='EISDIR')throw e}}}
await mkdir('resources/third-party',{recursive:true});await writeFile('resources/third-party/DEPENDENCY-NOTICES.txt',out.join('\n'))
console.log('Generated production dependency notices')
