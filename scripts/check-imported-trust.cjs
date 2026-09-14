const { mkdtemp, readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir, homedir } = require('node:os')
const { executeCommand } = require('../electron/ssh.cjs')
const { Workbench } = require('../electron/workbench.cjs')
const assert = require('node:assert/strict')
async function main() {
 const [host,user,key]=process.argv.slice(2);if(!key)throw new Error('Usage: node scripts/check-imported-trust.cjs <host> <user> <key>')
 const dir = await mkdtemp(join(tmpdir(), 'servers trust path ')); const knownHostsPath = join(dir, 'host records'); await writeFile(knownHostsPath, await readFile(join(homedir(), '.ssh/known_hosts')))
 const server = { id: 'fixture', name: 'fixture', host, port: 22, user, authType: 'privateKey', privateKeyPath:key, knownHostsPath }
 const result = await executeCommand(server, 'uptime'); assert.equal(result.status, 'completed')
 const wb = new Workbench({ read: async () => ({ servers: [server] }), record: async () => {} }, () => {})
 try { const session = await wb.open(server.id, 'files'); const listing = await wb.list(session.id, '/etc'); assert.ok(listing.entries.some(e => e.name === 'os-release')) } finally { wb.closeAll() }
 console.log('PASS: custom host trust file with spaces works for OpenSSH and SSH2/SFTP; read-only checks')
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
