const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { resolve, join } = require('node:path')
const { Store } = require('../electron/store.cjs')
const { ServerTools } = require('../electron/server-tools.cjs')
async function main() {
  const [host, user, key] = process.argv.slice(2)
  if (!key) throw new Error('Usage: node scripts/check-hardware.cjs <host> <user> <absolute-key>')
  await mkdir(resolve('artifacts'), { recursive: true })
  const directory = await mkdtemp(resolve('artifacts/hardware-check-'))
  const store = new Store(join(directory, 'data.json'))
  const server = await store.saveServer({ name: 'home-server', host, user, authType: 'privateKey', privateKeyPath: key })
  const tools = new ServerTools(store, null, () => {})
  const result = await tools.execute({ tool: 'servers_inspect_hardware', arguments: { id: server.id } })
  await writeFile(join(directory, 'hardware.json'), JSON.stringify(result.hardware, null, 2))
  console.log(JSON.stringify({ status: result.hardware.status, checkedAt: result.hardware.checkedAt, summary: result.hardware.summary, missingSections: result.hardware.missingSections, filesystems: result.hardware.sections?.filesystems, activity: result.hardware.sections?.activity, message: result.hardware.message, report: join(directory, 'hardware.json') }))
  if (result.hardware.status === 'failed') process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
