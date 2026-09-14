const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { mkdir } = require('node:fs/promises')
const { join } = require('node:path')
const { Rpc } = require('./rpc.cjs')
class Runtime extends EventEmitter {
  constructor(directory, home) { super(); this.directory = directory; this.home = home; this.state = 'stopped'; this.approvals = new Map(); this.items = new Map(); this.toolCalls = new Map(); this.questions = new Map(); this.currentTurn = null }
  cancelTools() { for (const controller of this.toolCalls.values()) controller.abort(); this.toolCalls.clear() }
  async dispatchTool(message, rpc) {
    const controller = new AbortController(); this.toolCalls.set(message.id, controller)
    let result
    try {
      if (!this.toolHandler) throw new Error('客户端工具不可用')
      const output = await this.toolHandler(message.params, controller.signal)
      result = { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(output) }] }
    } catch (error) { result = { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ error: error.message }) }] } }
    finally { this.toolCalls.delete(message.id) }
    if (!rpc.closed && !controller.signal.aborted) rpc.send({ id: message.id, result })
  }
  status(state, detail = '') { this.state = state; this.detail = detail; this.emit('event', { method: 'runtime/status', params: { state, detail } }) }
  async start() {
    if (this.state === 'ready') return { state: this.state }
    if (this.starting) return this.starting
    this.starting = this.boot().finally(() => { this.starting = null })
    return this.starting
  }
  async boot() {
    this.status('starting')
    await mkdir(this.home, { recursive: true })
    await mkdir(join(this.home, 'workspace'), { recursive: true })
    const child = spawn(join(this.directory, process.platform === 'win32' ? 'codex.exe' : 'codex'), ['app-server', '--listen', 'stdio://'], {
      cwd: join(this.home, 'workspace'), env: { ...process.env, CODEX_HOME: this.home }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    const rpc = new Rpc(line => child.stdin.write(line)); this.rpc = rpc
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => rpc.feed(chunk))
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => this.emit('diagnostic', chunk))
    child.stdin.on('error', error => rpc.close(error))
    child.on('error', error => { rpc.close(error); this.status('error', error.message) })
    child.on('exit', code => {
      rpc.close(); this.approvals.clear(); this.questions.clear(); this.currentTurn = null; this.cancelTools()
      if (this.child === child) { this.child = null; this.status(code && this.state !== 'stopped' ? 'error' : 'stopped', code ? `Runtime exited (${code})` : '') }
    })
    rpc.on('notification', message => {
      if (message.method === 'turn/started') this.currentTurn = { threadId: message.params.threadId, turnId: message.params.turn.id }
      if (message.method === 'turn/completed') { this.currentTurn = null; for (const [id, q] of this.questions) if (q.params.turnId === message.params.turn.id) this.questions.delete(id) }
      if (message.method === 'serverRequest/resolved') this.questions.delete(message.params.requestId)
      if (['item/started', 'item/completed'].includes(message.method) && message.params.item) {
        this.items.set(message.params.item.id, message.params.item)
        if (this.items.size > 500) this.items.delete(this.items.keys().next().value)
      }
      if (message.method === 'serverRequest/resolved') { this.approvals.delete(message.params.requestId); this.toolCalls.get(message.params.requestId)?.abort() }
      this.emit('event', message)
    })
    rpc.on('protocolError', detail => this.emit('diagnostic', detail))
    rpc.on('request', message => {
      if (message.method === 'item/tool/requestUserInput') { this.questions.set(message.id, message); this.emit('event', message); return }
      if (message.method === 'item/tool/call') { void this.dispatchTool(message, rpc); return }
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
        this.approvals.set(message.id, message)
        this.emit('event', { ...message, params: { ...message.params, item: this.items.get(message.params.itemId) } })
      } else {
        rpc.send({ id: message.id, error: { code: -32601, message: 'This client does not support this interaction yet' } })
        this.emit('event', { method: 'runtime/unsupported', params: { method: message.method } })
      }
    })
    try {
      await rpc.request('initialize', { clientInfo: { name: 'servers_desktop', title: 'ServerLoom', version: require('../package.json').version }, capabilities: { experimentalApi: true } })
      rpc.send({ method: 'initialized', params: {} }); this.status('ready')
      return { state: this.state }
    } catch (error) { child.kill(); this.status('error', error.message); throw error }
  }
  request(method, params) { if (this.state !== 'ready') throw new Error('请先启动 Codex runtime'); return this.rpc.request(method, params) }
  answer(id, answers) {
    const request = this.questions.get(id); if (!request) throw new Error('问题已失效，请刷新会话')
    if (!answers || typeof answers !== 'object') throw new Error('回答格式无效')
    const result = {}
    for (const q of request.params.questions) { const a = answers[q.id]?.answers; if (!Array.isArray(a) || a.length !== 1 || typeof a[0] !== 'string' || !a[0].trim() || a[0].length > 10000) throw new Error('请回答每个问题'); result[q.id] = { answers: [a[0]] } }
    this.rpc.send({id,result:{answers:result}}); this.questions.delete(id); this.emit('event',{method:'serverRequest/resolved',params:{threadId:request.params.threadId,requestId:id}})
  }
  approve(id, decision) {
    if (!this.approvals.has(id)) throw new Error('审批已失效')
    if (!['accept', 'decline'].includes(decision)) throw new Error('Invalid decision')
    const request = this.approvals.get(id)
    if (request.params.availableDecisions && !request.params.availableDecisions.includes(decision)) throw new Error('Runtime does not allow this decision')
    this.rpc.send({ id, result: { decision } }); this.approvals.delete(id); this.emit('event',{method:'serverRequest/resolved',params:{threadId:request.params.threadId,requestId:id}})
  }
  stop() { this.status('stopped'); this.approvals.clear(); this.questions.clear(); this.currentTurn = null; this.items.clear(); this.cancelTools(); this.rpc?.close(); this.child?.kill() }
}
module.exports = { Runtime }
