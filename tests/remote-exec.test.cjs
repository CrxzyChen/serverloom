const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildCommandArgs, executeCommand } = require('../electron/ssh.cjs')
const { ServerTools } = require('../electron/server-tools.cjs')
const config = { id: 'test', name: 'test', host: 'example.invalid', user: 'admin', authType: 'sshAgent' }
test('remote script is one quoted argument, with no local shell interpretation', () => {
  const command = "printf '%s\\n' \"$HOME\" | head -n 1\nss -lntup"
  const args = buildCommandArgs(config, command)
  assert.equal(args.at(-1), "sh -c '" + command.replace(/'/g, "'\\''") + "'")
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.throws(() => buildCommandArgs(config, 'a\0b'))
  assert.throws(() => buildCommandArgs({ ...config, host: '-oProxyCommand=bad' }, command))
})
test('command results distinguish nonzero exit, output cap, timeout and cancellation', async () => {
  for (const [error, status, exitCode] of [[null, 'completed', 0], [{ code: 3, message: 'exit' }, 'failed', 3], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, 'output_limit', null], [{ killed: true }, 'timeout', null], [{ name: 'AbortError' }, 'canceled', null]]) {
    const result = await executeCommand(config, 'ss -lntup', 1000, undefined, (binary, args, options, callback) => {
      assert.equal(options.shell, undefined)
      assert.equal(options.timeout, 1000)
      callback(error, 'partial stdout', 'stderr')
    })
    assert.equal(result.status, status); assert.equal(result.exitCode, exitCode)
    assert.equal(result.stdout, 'partial stdout'); assert.equal(result.stderr, 'stderr')
  }
  await assert.rejects(executeCommand(config, 'id', 120001))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(executeCommand(config, 'id', 1000, controller.signal))
})
test('tool uses stored target, audits start and finish, rejects unknown targets', async () => {
  const history = []
  const store = { read: async () => ({ servers: [config] }), record: async item => history.push(item) }
  const tools = new ServerTools(store, null, null, undefined, undefined, async (server, command) => {
    assert.equal(server.host, config.host); assert.equal(command, 'ss -lntup')
    return { status: 'completed', exitCode: 0, stdout: 'LISTEN', stderr: '' }
  })
  const result = await tools.execute({ tool: 'servers_exec', arguments: { id: 'test', command: 'ss -lntup', purpose: '查看监听端口' } })
  assert.equal(result.stdout, 'LISTEN'); assert.equal(history.length, 2)
  await assert.rejects(tools.execute({ tool: 'servers_exec', arguments: { id: 'missing', command: 'id', purpose: 'check' } }), /不存在/)
})
