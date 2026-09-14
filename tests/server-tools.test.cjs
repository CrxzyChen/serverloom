const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { Store } = require('../electron/store.cjs')
const { ServerTools } = require('../electron/server-tools.cjs')
const { Runtime } = require('../electron/runtime.cjs')
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'servers-agent-'))
  const store = new Store(join(dir, 'data.json')), events = []
  const tools = new ServerTools(store, async () => null, server => events.push(server))
  const call = (tool, args, signal) => tools.execute({ tool, arguments: args }, signal)
  return { dir, store, tools, call, events }
}
test('agent creates home-server with only an address, then completes the same record', async () => {
  const { call, store, events } = await fixture()
  const created = await call('servers_upsert', { name: 'home-server', host: '192.0.2.10' })
  assert.equal(created.saved, true); assert.equal(created.server.user, ''); assert.equal(created.server.port, 22)
  assert.equal(created.server.configStatus, 'draft'); assert.equal(created.connected, false)
  const updated = await call('servers_upsert', { id: created.server.id, authType: 'privateKey' })
  assert.equal(updated.server.host, '192.0.2.10'); assert.deepEqual(updated.server.missingFields, ['SSH 用户名', '私钥文件'])
  await call('servers_upsert', { id: created.server.id, user: 'admin' })
  assert.equal((await store.read()).servers.length, 1); assert.equal(events.length, 3)
})
test('retries are idempotent and conflicting names require an explicit target', async () => {
  const { call, store } = await fixture()
  await Promise.all([1, 2].map(() => call('servers_upsert', { name: 'home-server', host: '192.0.2.10' })))
  assert.equal((await store.read()).servers.length, 1)
  await assert.rejects(call('servers_upsert', { name: 'home-server', host: '10.0.0.2' }), /同名/)
  await assert.rejects(call('servers_upsert', { id: 'unknown', user: 'admin' }), /不存在/)
})
test('key selection stores only the selected path; cancellation preserves previous configuration', async () => {
  const { call, tools, dir, store } = await fixture()
  const key = join(dir, 'test-key'); await writeFile(key, 'SYNTHETIC TEST FILE — NOT A REAL PRIVATE KEY')
  const { server } = await call('servers_upsert', { name: 'test', host: 'example.invalid', user: 'admin', authType: 'privateKey' })
  tools.selectKey = async () => key
  const result = await call('servers_select_private_key', { id: server.id })
  assert.equal(result.server.privateKeyPath, key); assert.equal(result.server.configStatus, 'configured')
  assert.equal(JSON.stringify(result).includes('SYNTHETIC'), false)
  tools.selectKey = async () => null
  assert.equal((await call('servers_select_private_key', { id: server.id })).canceled, true)
  assert.equal((await store.read()).servers[0].privateKeyPath, key)
})
test('rejects unknown fields, secret content, invalid inputs and canceled operations', async () => {
  const { call, store } = await fixture()
  for (const args of [{ name: 'x', host: 'example.invalid', password: 'secret' }, { name: 'x', host: 'example.invalid', notes: '-----BEGIN OPENSSH PRIVATE KEY-----' }, { name: 'x', host: 'example.invalid', user: 'bad user' }]) await assert.rejects(call('servers_upsert', args))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(call('servers_upsert', { name: 'x', host: 'example.invalid' }, controller.signal))
  assert.equal((await store.read()).servers.length, 0)
})
test('JSON-RPC tool dispatch returns structured persistence results and failures', async () => {
  const { tools, store } = await fixture(), runtime = new Runtime('unused', 'unused'), sent = []
  runtime.toolHandler = (params, signal) => tools.execute(params, signal)
  const rpc = { closed: false, send: message => sent.push(message) }
  await runtime.dispatchTool({ id: 42, params: { tool: 'servers_upsert', arguments: { name: 'home-server', host: '192.0.2.10' } } }, rpc)
  assert.equal(sent[0].id, 42); assert.equal(sent[0].result.success, true)
  const output = JSON.parse(sent[0].result.contentItems[0].text)
  assert.equal(output.server.id, (await store.read()).servers[0].id)
  await runtime.dispatchTool({ id: 43, params: { tool: 'shell', arguments: {} } }, rpc)
  assert.equal(sent[1].result.success, false); assert.equal(runtime.toolCalls.size, 0)
})
