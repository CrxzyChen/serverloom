const { resolve } = require('node:path')
const { Runtime } = require('../electron/runtime.cjs')
const { serverTools, instructions } = require('../electron/server-tools.cjs')
const runtime = new Runtime(resolve('resources/runtime'), resolve('.runtime-check'))
async function check() {
  try {
    await runtime.start()
    const result = await runtime.request('account/read', { refreshToken: false })
    const thread = await runtime.request('thread/start', { cwd: resolve('.runtime-check/workspace'), sandbox: 'read-only', approvalPolicy: 'untrusted', dynamicTools: serverTools, developerInstructions: instructions })
    console.log(JSON.stringify({ handshake: runtime.state, account: result.account ? 'authenticated' : 'not authenticated', dynamicToolsRegistered: !!thread.thread.id }))
  } finally { runtime.stop() }
}
check().catch(error => { console.error(error.message); process.exitCode = 1 })
