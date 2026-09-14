const { Client } = require('ssh2')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { readFile } = require('node:fs/promises')
const { join, posix } = require('node:path')
const { homedir } = require('node:os')
const { randomUUID } = require('node:crypto')
const { validateServer } = require('./store.cjs')
const { validateKeyPath } = require('./ssh.cjs')
const exec = promisify(execFile)
function trustedKeys(output) {
  const keys = new Set(), revoked = new Set()
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (!line.trim() || line.startsWith('#')) continue
    if (parts[0] === '@revoked') revoked.add(parts[3])
    else if (!parts[0].startsWith('@') && parts.length >= 3) keys.add(parts[2])
  }
  return key => keys.has(key.toString('base64')) && !revoked.has(key.toString('base64'))
}
function remotePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('请输入服务器绝对路径')
  return posix.normalize(value)
}
function dimensions(cols, rows) {
  if (![cols, rows].every(n => Number.isInteger(n) && n >= 2 && n <= 500)) throw new Error('终端尺寸无效')
}
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (error, value) => error ? reject(error) : resolve(value)))
class Workbench {
  constructor(store, emit) { this.store = store; this.emit = emit; this.sessions = new Map() }
  async open(serverId, kind, cols = 80, rows = 24) {
    if (!['ssh', 'files'].includes(kind)) throw new Error('工具类型无效')
    dimensions(cols, rows)
    if (this.sessions.size >= 12) throw new Error('最多同时打开 12 个 SSH / 文件连接')
    const stored = (await this.store.read()).servers.find(s => s.id === serverId)
    if (!stored) throw new Error('服务器不存在')
    const server = validateServer(stored)
    if (server.configStatus !== 'configured') throw new Error('请先补全服务器连接配置')
    const host = server.host.replace(/^\[|\]$/g, '')
    const target = server.port === 22 ? host : `[${host}]:${server.port}`
    const keygen = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32/OpenSSH/ssh-keygen.exe') : '/usr/bin/ssh-keygen'
    let known
    try { known = (await exec(keygen, ['-F', target, '-f', server.knownHostsPath || join(homedir(), '.ssh/known_hosts')], { windowsHide: true, timeout: 5000 })).stdout }
    catch { throw new Error('未找到已信任主机指纹，请先在系统 SSH 核实一次') }
    const auth = server.authType === 'privateKey' ? { privateKey: await readFile(await validateKeyPath(server.privateKeyPath)) } : { agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined) }
    const client = new Client(), id = randomUUID(), session = { id, client, server, kind }
    this.sessions.set(id, session)
    const notify = (type, value) => this.emit({ method: 'workbench/event', params: { id, type, ...value } })
    try {
      await new Promise((resolve, reject) => {
        client.once('ready', resolve)
        client.on('error', error => { reject(error); notify('error', { message: error.message }); this.close(id) })
        client.on('close', () => { this.sessions.delete(id); reject(new Error('SSH 连接已关闭')); notify('closed', {}) })
        client.connect({ host, port: server.port, username: server.user, ...auth, hostVerifier: trustedKeys(known), readyTimeout: 10000, keepaliveInterval: 15000, keepaliveCountMax: 3 })
      })
      if (kind === 'ssh') {
        session.stream = await call(client, 'shell', { term: 'xterm-256color', cols, rows })
        session.stream.setEncoding('utf8')
        session.stream.on('data', data => notify('data', { data }))
        session.stream.on('error', error => { notify('error', { message: error.message }); this.close(id) })
        session.stream.on('close', () => this.close(id))
        // Data can arrive before IPC open resolves; renderer subscribes before opening.
      } else session.sftp = await call(client, 'sftp')
      await this.store.record({ kind: 'connection', title: kind === 'ssh' ? '打开 SSH 终端' : '打开文件管理器', detail: `${server.name} · ${server.user}@${host}:${server.port}` })
      return { id, server: { id: server.id, name: server.name, host, user: server.user }, home: kind === 'files' ? await call(session.sftp, 'realpath', '.') : undefined }
    } catch (error) { this.close(id); throw error }
  }
  get(id, kind) { const s = this.sessions.get(id); if (!s || (kind && s.kind !== kind)) throw new Error('连接已关闭，请重新连接'); return s }
  input(id, data) { if (typeof data !== 'string' || data.length > 65536) throw new Error('终端输入过长'); this.get(id, 'ssh').stream.write(data) }
  resize(id, cols, rows) { dimensions(cols, rows); this.get(id, 'ssh').stream.setWindow(rows, cols, 0, 0) }
  close(id) { const s = this.sessions.get(id); if (s) { this.sessions.delete(id); s.stream?.close(); s.client.end(); s.client.destroy() } }
  closeAll() { for (const id of this.sessions.keys()) this.close(id) }
  async list(id, path) {
    const sftp = this.get(id, 'files').sftp, actual = await call(sftp, 'realpath', remotePath(path))
    const entries = await call(sftp, 'readdir', actual)
    return { path: actual, truncated: entries.length > 2000, entries: entries.slice(0, 2000).map(e => ({ name: e.filename, directory: e.attrs.isDirectory(), link: e.attrs.isSymbolicLink(), size: e.attrs.size, modified: e.attrs.mtime * 1000, mode: (e.attrs.mode & 0o777).toString(8) })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) }
  }
  async preview(id, path) {
    const sftp = this.get(id, 'files').sftp
    return new Promise((resolve, reject) => {
      const stream = sftp.createReadStream(remotePath(path), { start: 0, end: 262144 })
      const chunks = []; stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk))
      stream.on('end', () => { const data = Buffer.concat(chunks); if (data.includes(0)) reject(new Error('二进制文件请下载后查看')); else resolve({ text: data.subarray(0, 262144).toString('utf8'), truncated: data.length > 262144 }) })
    })
  }
  async transfer(id, remote, local, upload) {
    const session = this.get(id, 'files'), target = remotePath(remote)
    // Upload uses exclusive creation: no silent overwrite of a remote file.
    if (upload) {
      const { createReadStream } = require('node:fs'), { pipeline } = require('node:stream/promises')
      await pipeline(createReadStream(local), session.sftp.createWriteStream(target, { flags: 'wx' }))
    } else await call(session.sftp, 'fastGet', target, local)
    await this.store.record({ kind: 'command', title: upload ? '上传文件' : '下载文件', detail: `${session.server.name} · ${target}` })
  }
}
module.exports = { Workbench, trustedKeys, remotePath, dimensions }
