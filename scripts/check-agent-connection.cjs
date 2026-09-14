const { join, resolve } = require('node:path')
const { mkdtemp, mkdir } = require('node:fs/promises')
const assert = require('node:assert/strict')
const { Runtime } = require('../electron/runtime.cjs')
const { Store } = require('../electron/store.cjs')
const { ServerTools, serverTools, instructions } = require('../electron/server-tools.cjs')
async function main() {
  const [home, host, user, key] = process.argv.slice(2)
  if (!key) throw new Error('Usage: node scripts/check-agent-connection.cjs <logged-in-codex-home> <host> <user> <absolute-key>')
  await mkdir(resolve('artifacts'), { recursive: true })
  const directory = await mkdtemp(resolve('artifacts/agent-connection-'))
  const store = new Store(join(directory, 'data.json'))
  await store.saveServer({ name: 'home-server', host, user, authType: 'privateKey' })
  const tools = new ServerTools(store, () => { throw new Error('Known path must not require file selection') }, () => {})
  const runtime = new Runtime(resolve('resources/runtime'), resolve(home))
  const calls = []; let timer
  runtime.toolHandler = (params, signal) => { calls.push(params.tool); return tools.execute(params, signal) }
  try {
    await runtime.start()
    if (!(await runtime.request('account/read', { refreshToken: false })).account) throw new Error('Application login required')
    const { thread } = await runtime.request('thread/start', { cwd: directory, sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true, dynamicTools: serverTools, developerInstructions: instructions })
    const completed = new Promise((resolveTurn, reject) => {
      timer = setTimeout(() => reject(new Error('Agent check timed out')), 120000)
      runtime.on('event', event => {
        if (event.method === 'turn/completed' && event.params.threadId === thread.id) resolveTurn(event.params.turn)
        if (event.method.endsWith('/requestApproval')) runtime.approve(event.id, 'decline')
      })
    })
    await runtime.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: `请完成 home-server 的连接配置。地址 ${host}，用户名 ${user}，现有私钥路径 ${key}，终端已使用这把钥匙成功登录过。你来保存并测试，不要让我重复选择文件或手动执行命令。`, text_elements: [] }] })
    const turn = await completed
    if (turn.error) throw new Error(turn.error.message)
    const data = await store.read()
    assert.ok(calls.includes('servers_bind_private_key')); assert.ok(calls.includes('servers_test_connection'))
    assert.equal(calls.includes('servers_select_private_key'), false)
    assert.equal(data.servers.length, 1); assert.equal(data.servers[0].lastConnection?.status, 'passed')
    console.log(JSON.stringify({ passed: true, calls, connection: data.servers[0].lastConnection, storage: 'isolated inventory' }))
  } finally { clearTimeout(timer); runtime.stop() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
