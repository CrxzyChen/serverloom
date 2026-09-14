const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { Store, validateServer } = require('../electron/store.cjs')
const example = { name: 'Test', host: 'example.invalid', user: 'root', port: 22, group: '测试', notes: '' }
test('rejects malformed ports, option-like hosts and invalid user names', () => {
  for (const invalid of [{ port: 0 }, { port: 65536 }, { port: 3.5 }, { host: '-oProxyCommand=x' }, { host: 'host;cmd' }, { user: 'root && echo' }]) assert.throws(() => validateServer({ ...example, ...invalid }))
  assert.equal(validateServer({ ...example, host: '2001:db8::1' }).host, '2001:db8::1')
})
test('serializes concurrent updates without losing servers or audit entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servers-test-')); const store = new Store(join(directory, 'servers.json'))
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => store.saveServer({ ...example, name: `server-${i}` })))
  await Promise.all(results.map(server => store.record({ title: server.name, kind: 'server' })))
  await store.saveServer({ ...results[0], name: 'Updated' })
  const data = await store.read(); assert.equal(data.servers.length, 15); assert.equal(data.history.length, 15); assert.equal(data.servers[0].name, 'Updated')
})
test('atomic replacement retries transient Windows locks without deleting the old file',async()=>{
 const {replaceFile}=require('../electron/store.cjs');let attempts=0;const waits=[]
 await replaceFile('new.tmp','existing.json',async()=>{if(++attempts<3)throw Object.assign(new Error('locked'),{code:'EPERM'})},async ms=>waits.push(ms))
 assert.equal(attempts,3);assert.deepEqual(waits,[25,50])
 await assert.rejects(()=>replaceFile('new.tmp','existing.json',async()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'})},async()=>{}),/disk full/)
})
