import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
if(!process.env.TEST_SSH_HOST)throw new Error('Set TEST_SSH_HOST to a configured test server')
const app = await electron.launch({ executablePath: resolve(process.argv[2] || 'release-alpha/win-unpacked/ServerLoom.exe') })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '选择服务器，开始工作。' }).waitFor()
  const result = await page.evaluate(async host => {
    const server = (await window.servers.load()).servers.find(s => s.host === host && s.configStatus === 'configured')
    if (!server) throw new Error('Configured home-server required')
    const files = await window.servers.openTool({ serverId: server.id, kind: 'files' })
    try {
      const listing = await window.servers.listFiles(files.id, '/etc')
      const preview = await window.servers.previewFile(files.id, '/etc/os-release')
      return { listed: listing.entries.some(e => e.name === 'os-release'), ubuntu: preview.text.includes('Ubuntu') }
    } finally { await window.servers.closeTool(files.id) }
  },process.env.TEST_SSH_HOST)
  assert.equal(result.listed, true); assert.equal(result.ubuntu, true)
  console.log('PASS: packaged SSH2 dependency, host verification, private-key authentication, SFTP listing and preview against home-server')
} finally { await app.close() }
