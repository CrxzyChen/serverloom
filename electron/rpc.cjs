const { EventEmitter } = require('node:events')
class Rpc extends EventEmitter {
  constructor(write, timeout = 30000) {
    super(); this.write = write; this.timeout = timeout; this.nextId = 1; this.pending = new Map(); this.buffer = ''; this.closed = false
  }
  send(message) { if (this.closed) throw new Error('Runtime connection closed'); this.write(JSON.stringify(message) + '\n') }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: request timed out`)) }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  feed(chunk) {
    this.buffer += chunk
    if (this.buffer.length > 16 * 1024 * 1024) { this.close(new Error('Runtime message exceeded limit')); return }
    let end
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1)
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { this.emit('protocolError', 'Invalid JSON from runtime'); continue }
      if (message.method) this.emit(message.id === undefined ? 'notification' : 'request', message)
      else {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer); this.pending.delete(message.id)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      }
    }
  }
  close(error = new Error('Runtime disconnected')) {
    this.closed = true
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
  }
}
module.exports = { Rpc }
