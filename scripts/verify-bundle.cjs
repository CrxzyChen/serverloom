const { readFile } = require('node:fs/promises')
const { resolve, join } = require('node:path')
const { createHash } = require('node:crypto')
module.exports = async function verify() {
  const root = resolve('resources/runtime')
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (manifest.version !== 'codex-cli 0.154.0' || manifest.source !== 'https://github.com/openai/codex/releases/download/rust-v0.154.0/codex-package-x86_64-pc-windows-msvc.tar.gz') throw new Error('Public releases require the pinned public runtime; run npm run runtime:fetch')
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime platform/architecture mismatch')
  for (const name of ['codex.exe', 'codex-code-mode-host.exe', 'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']) {
    const bytes = await readFile(join(root, name))
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[name]) throw new Error(`Runtime checksum mismatch: ${name}`)
  }
}
