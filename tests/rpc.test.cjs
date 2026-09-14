const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Rpc } = require('../electron/rpc.cjs')
test('routes fragmented and out-of-order JSONL responses and notifications', async () => {
  const sent = [], events = []
  const rpc = new Rpc(line => sent.push(JSON.parse(line)))
  rpc.on('notification', event => events.push(event))
  const a = rpc.request('a'), b = rpc.request('b')
  rpc.feed('{"id":2,"result":"second"}\n{"method":"delta","params":{"text":"你好"}}\n{"id":')
  rpc.feed('1,"result":"first"}\n')
  assert.deepEqual(await Promise.all([a,b]), ['first','second'])
  assert.equal(events[0].params.text, '你好'); assert.equal(sent.length, 2); rpc.close()
})
test('runtime errors, malformed messages and disconnects do not leave requests pending', async () => {
  const rpc = new Rpc(() => {}); let errors = 0
  rpc.on('protocolError', () => errors++)
  const a = rpc.request('error')
  rpc.feed('invalid\n{"id":1,"error":{"message":"denied"}}\n')
  await assert.rejects(a, /denied/); assert.equal(errors, 1)
  const b = rpc.request('pending'); rpc.close(); await assert.rejects(b, /disconnected/)
  assert.equal(rpc.pending.size, 0)
})
test('server requests use a separate route from client responses', async () => {
  const rpc = new Rpc(() => {}); let approval
  rpc.on('request', message => { approval = message })
  const request = rpc.request('a')
  rpc.feed('{"id":1,"method":"item/commandExecution/requestApproval","params":{}}\n{"id":1,"result":true}\n')
  assert.equal(approval.id, 1); assert.equal(await request, true); rpc.close()
})
test('request timeouts release pending state', async () => {
  const rpc = new Rpc(() => {}, 5)
  await assert.rejects(rpc.request('slow'), /timed out/); assert.equal(rpc.pending.size, 0); rpc.close()
})
