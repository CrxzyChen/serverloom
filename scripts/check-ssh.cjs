const { resolve, join } = require('node:path')
const { mkdir, mkdtemp } = require('node:fs/promises')
const { Store } = require('../electron/store.cjs')
const { ServerTools } = require('../electron/server-tools.cjs')
async function main() {
  const [host, user, key] = process.argv.slice(2)
  if (!host || !user || !key) throw new Error('Usage: node scripts/check-ssh.cjs <host> <user> <absolute-private-key-path>')
  await mkdir(resolve('artifacts'), { recursive: true })
  const directory = await mkdtemp(resolve('artifacts/ssh-check-'))
  const store = new Store(join(directory, 'data.json'))
  const tools = new ServerTools(store, () => { throw new Error('File picker must not be needed') }, () => {})
  const { server } = await tools.execute({ tool: 'servers_upsert', arguments: { name: 'home-server', host, user, authType: 'privateKey' } })
  await tools.execute({ tool: 'servers_bind_private_key', arguments: { id: server.id, path: key } })
  const result = await tools.execute({ tool: 'servers_test_connection', arguments: { id: server.id } })
  console.log(JSON.stringify({ host, ...result.connectionTest, inventory: 'isolated test inventory; application server list unchanged' }))
  if (!result.connected) process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
