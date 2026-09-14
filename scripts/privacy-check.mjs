import {execFileSync} from 'node:child_process'
import {readFile,lstat} from 'node:fs/promises'
const files=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean))]
const failures=[]
const forbidden=/^(node_modules|dist|release[^/]*|artifacts|\.codex|\.agents)\/|(^|\/)(auth\.json|servers\.json|known_hosts|id_(rsa|ed25519))$|\.(pem|key|p12|pfx|servers)$/i
const patterns=[['private key',/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40,}/],['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],['API token',/\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b/],['personal home',new RegExp('(?:C:[\\\\/]+Users[\\\\/]+|/home/)(?!Example|example|test|runner|user|admin)[A-Za-z0-9_.-]+','i')]]
for(const file of files){if(forbidden.test(file)){failures.push(`${file}: forbidden release/source path`);continue}const stat=await lstat(file);if(stat.isSymbolicLink()){failures.push(`${file}: symlink needs review`);continue}if(!/\.(?:md|json|js|mjs|cjs|vue|css|html|svg|ya?ml|txt)$/.test(file)&&!['LICENSE','.gitignore'].includes(file))continue;const text=await readFile(file,'utf8');for(const [name,regex] of patterns)if(regex.test(text))failures.push(`${file}: ${name}`)}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log(`Privacy check passed for ${files.length} publishable files. Review context before every release.`)
