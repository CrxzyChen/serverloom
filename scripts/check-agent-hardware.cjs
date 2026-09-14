const { join, resolve } = require('node:path')
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises')
const assert = require('node:assert/strict')
const { Runtime } = require('../electron/runtime.cjs')
const { Store } = require('../electron/store.cjs')
const { ServerTools, serverTools, instructions } = require('../electron/server-tools.cjs')
async function main() {
  const [home, host, user, key] = process.argv.slice(2)
  if (!key) throw new Error('Usage: node scripts/check-agent-hardware.cjs <logged-in-codex-home> <host> <user> <absolute-key>')
  await mkdir(resolve('artifacts'), { recursive: true })
  const directory = await mkdtemp(resolve('artifacts/agent-hardware-'))
  const store = new Store(join(directory, 'data.json'))
  await store.saveServer({ name: 'home-server', host, user, authType: 'privateKey', privateKeyPath: key })
  const tools = new ServerTools(store, () => { throw new Error('Known path must not require file selection') }, () => {})
  const runtime = new Runtime(resolve('resources/runtime'), resolve(home))
  const calls = []; const replies = []; let timer
  runtime.toolHandler = (params, signal) => { calls.push(params.tool); return tools.execute(params, signal) }
  try {
    await runtime.start()
    if (!(await runtime.request('account/read', { refreshToken: false })).account) throw new Error('Application login required')
    const { thread } = await runtime.request('thread/start', { cwd: directory, sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true, dynamicTools: serverTools, developerInstructions: instructions })
    const completed = new Promise((resolveTurn, reject) => {
      timer = setTimeout(() => reject(new Error('Agent check timed out')), 120000)
      runtime.on('event', event => {
        if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') replies.push(event.params.item.text);
        if (event.method === 'turn/completed' && event.params.threadId === thread.id) resolveTurn(event.params.turn)
        if (event.method.endsWith('/requestApproval')) runtime.approve(event.id, 'decline')
      })
    })
    await runtime.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: '查看 home-server 的服务器硬件状态', text_elements: [] }] })
    const turn = await completed
    if (turn.error) throw new Error(turn.error.message)
    const data = await store.read()
    assert.ok(calls.includes('servers_inspect_hardware'))
    assert.equal(data.servers.length, 1)
    assert.ok(['complete', 'partial'].includes(data.servers[0].lastHardware?.status))
    assert.ok(data.servers[0].lastHardware.summary.logicalCpus > 0)
    await writeFile(join(directory, 'reply.json'), JSON.stringify({ calls, replies }, null, 2))
    console.log(JSON.stringify({ passed: true, calls, status: data.servers[0].lastHardware.status, replies, storage: 'isolated inventory' }))
  } finally { clearTimeout(timer); runtime.stop() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
