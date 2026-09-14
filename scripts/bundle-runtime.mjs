import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const source = process.argv[2]
if (!source) throw new Error('Usage: npm run runtime:bundle -- <directory containing codex-rs binaries>')
if (process.platform !== 'win32') throw new Error('This initial runtime bundler targets Windows; add platform-specific artifacts for other targets.')
const target = resolve('resources/runtime')
await mkdir(target, { recursive: true })
const files = ['codex.exe', 'codex-code-mode-host.exe', 'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']
const manifest = { platform: process.platform, arch: process.arch, version: execFileSync(join(resolve(source), 'codex.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), files: {} }
for (const file of files) {
  const bytes = await readFile(join(resolve(source), file))
  manifest.files[file] = createHash('sha256').update(bytes).digest('hex')
  await copyFile(join(resolve(source), file), join(target, file))
}
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Bundled ${manifest.version} (${manifest.platform}/${manifest.arch})`)
