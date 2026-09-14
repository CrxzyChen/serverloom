const { Runtime } = require('../electron/runtime.cjs')
const { serverTools, instructions } = require('../electron/server-tools.cjs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
async function turn(runtime, threadId, text) {
  let timer, listener
  const replies = []
  const completed = new Promise((resolveTurn, reject) => {
    timer = setTimeout(() => reject(new Error('Turn timed out')), 120000)
    listener = event => {
      if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') replies.push(event.params.item.text)
      if (event.method === 'turn/completed' && event.params.threadId === threadId) event.params.turn.error ? reject(new Error(event.params.turn.error.message)) : resolveTurn()
      if (event.method.endsWith('/requestApproval')) runtime.approve(event.id, 'decline')
    }
    runtime.on('event', listener)
  })
  try { await runtime.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] }); await completed; return replies.join('\n') }
  finally { clearTimeout(timer); runtime.off('event', listener) }
}
async function main() {
  const home = resolve(process.argv[2]), runtime = new Runtime(resolve('resources/runtime'), home)
  let next
  try {
    await runtime.start()
    const params = { cwd: resolve('artifacts'), sandbox: 'read-only', approvalPolicy: 'untrusted', developerInstructions: instructions }
    const { thread } = await runtime.request('thread/start', { ...params, dynamicTools: serverTools })
    await turn(runtime, thread.id, '记住本会话测试代号：海风灯塔734。只回复已记录，不要调用工具。')
    const child = runtime.child, exited = new Promise(resolve => child.once('exit', resolve)); runtime.stop(); await exited
    next = new Runtime(resolve('resources/runtime'), home); await next.start()
    const resumed = await next.request('thread/resume', { ...params, threadId: thread.id })
    assert.equal(resumed.thread.id, thread.id)
    const reply = await turn(next, thread.id, '刚才的测试代号是什么？只回复代号，不要调用工具。')
    assert.match(reply, /海风灯塔734/)
    console.log('PASS: persisted native thread resumes across runtime restart and retains earlier conversation context')
  } finally { runtime.stop(); next?.stop() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
