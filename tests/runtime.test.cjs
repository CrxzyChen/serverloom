const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Runtime } = require('../electron/runtime.cjs')
test('approvals only resolve a live request and never accept session-wide grants', () => {
  const runtime = new Runtime('unused', 'unused'); const sent = []
  runtime.rpc = { send: value => sent.push(value) }
  runtime.approvals.set(7, { params: { availableDecisions: ['accept', 'decline'] } })
  assert.throws(() => runtime.approve(7, 'acceptForSession'), /Invalid/)
  runtime.approve(7, 'decline')
  assert.deepEqual(sent, [{ id: 7, result: { decision: 'decline' } }])
  assert.throws(() => runtime.approve(7, 'accept'), /失效/)
})
test('restricts decisions to the runtime-provided options', () => {
  const runtime = new Runtime('unused', 'unused')
  runtime.approvals.set('a', { params: { availableDecisions: ['decline'] } })
  assert.throws(() => runtime.approve('a', 'accept'), /does not allow/)
})
