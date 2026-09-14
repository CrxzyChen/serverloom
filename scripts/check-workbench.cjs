const { Workbench } = require('../electron/workbench.cjs')
const { executeCommand } = require('../electron/ssh.cjs')
const assert = require('node:assert/strict')
const [host, user, privateKeyPath] = process.argv.slice(2)
const server = { id: 'home-server', name: 'home-server', host, user, privateKeyPath, port: 22, authType: 'privateKey' }
const events = [], audit = []
const manager = new Workbench({ read: async () => ({ servers: [server] }), record: async entry => audit.push(entry) }, event => events.push(event.params))
async function main() {
  try {
    const ssh = await manager.open(server.id, 'ssh', 100, 30)
    manager.resize(ssh.id, 110, 35)
    manager.input(ssh.id, "unset HISTFILE; printf 'WORKBENCH_%s\\n' READY; stty size\n")
    const started = Date.now()
    while (!events.filter(e => e.id === ssh.id).map(e => e.data || '').join('').includes('35 110')) {
      if (Date.now() - started > 10000) throw new Error('Terminal output timed out')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const files = await manager.open(server.id, 'files')
    const listing = await manager.list(files.id, '/etc')
    assert.ok(listing.entries.some(e => e.name === 'os-release'))
    const preview = await manager.preview(files.id, '/etc/os-release')
    assert.match(preview.text, /Ubuntu/)
    const bandwidth = await executeCommand(server, 'cat /proc/uptime; cat /proc/net/dev')
    assert.equal(bandwidth.status, 'completed')
    console.log(JSON.stringify({ passed: true, terminal: 'interactive PTY, resized 110x35', files: '/etc listing and /etc/os-release preview', bandwidth: 'real counters received', audit: audit.length }))
  } finally { manager.closeAll(); assert.equal(manager.sessions.size, 0) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
