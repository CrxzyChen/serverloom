const { join, resolve } = require('node:path')
const { mkdtemp, mkdir } = require('node:fs/promises')
const assert = require('node:assert/strict')
const { Runtime } = require('../electron/runtime.cjs')
const { Store } = require('../electron/store.cjs')
const { ServerTools, serverTools, instructions } = require('../electron/server-tools.cjs')
async function main() {
  if (!process.argv[2]) throw new Error('Pass the application Codex home explicitly; this check uses its signed-in account for one model turn.')
  await mkdir(resolve('artifacts'), { recursive: true })
  const directory = await mkdtemp(resolve('artifacts/agent-check-'))
  const store = new Store(join(directory, 'servers.json'))
  const tools = new ServerTools(store, async () => null, () => {})
  const runtime = new Runtime(resolve('resources/runtime'), resolve(process.argv[2]))
  const calls = []; let timer
  runtime.toolHandler = (params, signal) => { calls.push(params.tool); return tools.execute(params, signal) }
  try {
    await runtime.start()
    const account = await runtime.request('account/read', { refreshToken: false })
    if (!account.account) throw new Error('The application is not signed in')
    const { thread } = await runtime.request('thread/start', { cwd: directory, sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true, dynamicTools: serverTools, developerInstructions: instructions })
    const complete = new Promise((resolveTurn, reject) => {
      timer = setTimeout(() => reject(new Error('Agent check timed out')), 120000)
      runtime.on('event', event => {
        if (event.method === 'turn/completed' && event.params.threadId === thread.id) resolveTurn(event.params.turn)
        if (event.method.endsWith('/requestApproval')) runtime.approve(event.id, 'decline')
      })
    })
    await runtime.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: '创建 home-server，地址 192.0.2.10，私钥认证。先保存草稿，用户名和私钥文件稍后补充；这次不要弹出文件选择器。', text_elements: [] }] })
    const turn = await complete
    if (turn.error) throw new Error(turn.error.message)
    const data = await store.read()
    assert.equal(data.servers.length, 1)
    assert.equal(data.servers[0].name, 'home-server'); assert.equal(data.servers[0].host, '192.0.2.10')
    assert.equal(data.servers[0].authType, 'privateKey'); assert.equal(data.servers[0].user, '')
    assert.equal(data.servers[0].configStatus, 'draft')
    console.log(JSON.stringify({ passed: true, modelToolCalls: calls, saved: { name: data.servers[0].name, host: data.servers[0].host, status: data.servers[0].configStatus }, storage: 'isolated test inventory; application server list unchanged' }))
  } finally { clearTimeout(timer); runtime.stop() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
