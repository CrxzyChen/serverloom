const { randomBytes, randomUUID, scrypt, createCipheriv, createDecipheriv, createHash } = require('node:crypto')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { readFile, writeFile, mkdir, stat, unlink } = require('node:fs/promises')
const { join, basename } = require('node:path')
const { homedir } = require('node:os')
const { validateServer, assignGroup } = require('./store.cjs')
const derive = promisify(scrypt), exec = promisify(execFile)
const LIMIT = 12 * 1024 * 1024
// Protocol identity is immutable, even when the product is renamed.
const AAD = Buffer.from('Servers migration v1 / scrypt-32768-8-1 / AES-256-GCM')
// alpha.1/alpha.2 accidentally used the new brand without changing format version.
const READ_AADS = [AAD, Buffer.from('ServerLoom migration v1 / scrypt-32768-8-1 / AES-256-GCM')]
function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 256) throw new Error('连接包口令应为 10–256 个字符') }
async function keyFor(value, salt) { password(value); return derive(value, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) }
function decode(value, length) { if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('连接包格式无效'); const b = Buffer.from(value, 'base64'); if ((length && b.length !== length) || b.toString('base64') !== value) throw new Error('连接包格式无效'); return b }
async function seal(payload, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12), key = await keyFor(passphrase, salt)
  try { const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(AAD); const plain = Buffer.from(JSON.stringify(payload)); if (plain.length > LIMIT / 2) throw new Error('连接包过大，请分批导出'); const data = Buffer.concat([cipher.update(plain), cipher.final()]); plain.fill(0); return Buffer.from(JSON.stringify({ format: 'servers-encrypted', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })) } finally { key.fill(0) }
}
async function unseal(bytes, passphrase) {
  if (bytes.length > LIMIT) throw new Error('连接包超过 12 MiB 上限')
  let envelope; try { envelope = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('无法识别连接包') }
  if (envelope.format !== 'servers-encrypted' || envelope.version !== 1) throw new Error('不支持的连接包版本')
  const salt = decode(envelope.salt, 16), iv = decode(envelope.iv, 12), tag = decode(envelope.tag, 16), data = decode(envelope.data)
  const key = await keyFor(passphrase, salt)
  try {
    for (const aad of READ_AADS) {
      const cipher = createDecipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(aad); cipher.setAuthTag(tag)
      let partial, tail, plain
      try {
        partial = cipher.update(data)
        try { tail = cipher.final() } catch { continue }
        plain = Buffer.concat([partial, tail])
        try { return JSON.parse(plain.toString('utf8')) }
        catch { throw new Error('连接包已通过口令校验，但内容格式无效') }
      } finally { partial?.fill(0); tail?.fill(0); plain?.fill(0) }
    }
    throw new Error('解密失败：口令不匹配或连接包未通过完整性校验；请核对导出文件和口令（含空格）')
  } finally { key.fill(0) }
}
function target(s) { const host = s.host.replace(/^\[|\]$/g, ''); return s.port === 22 ? host : `[${host}]:${s.port}` }
function endpoint(s) { return `${s.host.replace(/^\[|\]$/g, '').toLowerCase()}|${s.port}|${s.user}` }
function fingerprint(k) { return 'SHA256:' + createHash('sha256').update(Buffer.from(k.data, 'base64')).digest('base64').replace(/=+$/, '') }
function parseHostKeys(output) {
  const result = []
  for (const line of output.split(/\r?\n/)) { const p = line.trim().split(/\s+/); if (!line.trim() || p[0].startsWith('#')) continue; const revoked = p[0] === '@revoked'; if (p[0].startsWith('@') && !revoked) continue; const i = revoked ? 2 : 1; if (/^(ssh-|ecdsa-)/.test(p[i] || '') && p[i + 1]) result.push({ type: p[i], data: p[i + 1], revoked }) }
  return result
}
async function hostKeys(server) {
  const binary = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32/OpenSSH/ssh-keygen.exe') : '/usr/bin/ssh-keygen'
  const file = server.knownHostsPath || join(homedir(), '.ssh/known_hosts')
  try { await stat(file) } catch (e) { if (e.code === 'ENOENT') return []; throw new Error('无法读取主机指纹记录') }
  try { const { stdout } = await exec(binary, ['-F', target(server), '-f', file], { windowsHide: true, timeout: 5000, maxBuffer: 262144 }); return parseHostKeys(stdout) } catch (e) { if (e.code === 1) return []; throw new Error('无法读取主机指纹记录，请检查本机 OpenSSH') }
}
function portable(server) { return { name: server.name, host: server.host, port: server.port, user: server.user, group: server.group || '', authType: server.authType } }
function validatePayload(payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.servers) || payload.servers.length < 1 || payload.servers.length > 100) throw new Error('连接包应包含 1–100 台服务器')
  const seen = new Set()
  return payload.servers.map(entry => {
    const config = validateServer({ ...portable(entry.config || {}), notes: entry.config?.notes || '' })
    if (seen.has(endpoint(config))) throw new Error('连接包内存在重复连接'); seen.add(endpoint(config))
    let privateKey = ''
    if (entry.privateKey) { if (entry.privateKey.length > 90000) throw new Error('私钥文件过大'); privateKey = decode(entry.privateKey).toString('utf8'); if (!/^-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(privateKey.trim()) || privateKey.length > 65536 || config.authType !== 'privateKey') throw new Error('连接包内私钥格式无效') }
    const hosts = entry.hostKeys || []
    if (!Array.isArray(hosts) || hosts.length > 20) throw new Error('主机指纹格式无效')
    for (const key of hosts) { if (typeof key.type !== 'string' || !/^(ssh-[\w@.-]+|ecdsa-[\w@.-]+)$/.test(key.type) || key.data?.length > 16384 || decode(key.data).length < 16 || key.revoked) throw new Error('主机指纹格式无效或已撤销') }
    return { config, hasNotes: Object.hasOwn(entry.config || {}, 'notes'), privateKey, hostKeys: hosts.map(k => ({ type: k.type, data: k.data })) }
  })
}
async function protectFile(file) {
  if (process.platform !== 'win32') return
  const system = process.env.SystemRoot || 'C:\\Windows'
  const { stdout } = await exec(join(system, 'System32/whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 })
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0]; if (!sid) throw new Error('无法设置私钥访问权限')
  await exec(join(system, 'System32/icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`], { windowsHide: true, timeout: 5000 })
}
class Migration {
  constructor(store, directory, readHosts = hostKeys) { this.store = store; this.directory = directory; this.readHosts = readHosts; this.pending = new Map() }
  clear() { for (const token of this.pending.keys()) this.discard(token) }
  discard(token) { clearTimeout(this.pending.get(token)?.timer); this.pending.delete(token) }
  prune() { for (const [token, value] of this.pending) if (Date.now() - value.at > 5 * 60 * 1000) this.discard(token) }
  get(token) { this.prune(); const item = this.pending.get(token); if (!item) throw new Error('导入预览已过期，请重新选择连接包'); return item }
  async export(ids, passphrase, includeKeys, includeNotes = false) {
    password(passphrase)
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || typeof includeKeys !== 'boolean' || typeof includeNotes !== 'boolean') throw new Error('请选择 1–100 台服务器')
    const data = await this.store.read(), entries = []
    for (const id of ids) {
      const server = data.servers.find(s => s.id === id); if (!server) throw new Error('服务器已变化，请重新选择')
      let privateKey
      if (includeKeys && server.authType === 'privateKey' && server.privateKeyPath) { const info = await stat(server.privateKeyPath); if (!info.isFile() || info.size > 65536) throw new Error(`${server.name} 的私钥文件无效或过大`); privateKey = (await readFile(server.privateKeyPath)).toString('base64') }
      const known = await this.readHosts(server)
      if (known.some(k => k.revoked)) throw new Error(`${server.name} 存在已撤销主机密钥，请先核实`)
      entries.push({ config: { ...portable(server), ...(includeNotes ? { notes: server.notes } : {}) }, privateKey, hostKeys: known })
    }
    const payload = { version: 1, servers: entries }; validatePayload(payload)
    return seal(payload, passphrase)
  }
  async stage(file) { this.prune(); if (this.pending.size >= 3) throw new Error('请先关闭已有导入预览'); const info = await stat(file); if (!info.isFile() || info.size > LIMIT) throw new Error('连接包文件过大或无效'); const bytes = await readFile(file); const token = randomUUID(); this.pending.set(token, { at: Date.now(), bytes, timer: setTimeout(() => this.discard(token), 5 * 60 * 1000).unref() }); return { token, name: basename(file) } }
  async preview(token, passphrase) {
    const pending = this.get(token), entries = validatePayload(await unseal(pending.bytes, passphrase)), data = await this.store.read(), rows = []
    for (const [index, entry] of entries.entries()) {
      const matches = data.servers.filter(s => endpoint(s) === endpoint(entry.config))
      const locals = await this.readHosts(entry.config)
      if (matches[0]?.knownHostsPath) locals.push(...await this.readHosts(matches[0]))
      const revoked = entry.hostKeys.some(k => locals.some(l => l.revoked && l.data === k.data))
      const conflict = entry.hostKeys.some(k => locals.some(l => l.type === k.type && l.data !== k.data))
      rows.push({ index, config: portable(entry.config), keyIncluded: !!entry.privateKey, fingerprints: entry.hostKeys.map(fingerprint), localFingerprints: locals.map(fingerprint), hostConflict: conflict, revoked, existingId: matches.length === 1 ? matches[0].id : null, duplicate: matches.length > 0, ambiguous: matches.length > 1 })
    }
    pending.localHosts = rows.map(r => r.localFingerprints); pending.entries = entries; pending.rows = rows; pending.baseline = JSON.stringify(data.servers); pending.at = Date.now(); clearTimeout(pending.timer); pending.timer = setTimeout(() => this.discard(token), 5 * 60 * 1000).unref()
    return { rows }
  }
  async commit(token, choices, trustHosts) {
    const pending = this.get(token)
    if (!pending.entries || !Array.isArray(choices) || choices.length !== pending.entries.length || typeof trustHosts !== 'boolean') throw new Error('请先解密并预览连接包')
    const created = []
    try {
      const result = await this.store.update(async data => {
        if (JSON.stringify(data.servers) !== pending.baseline) throw new Error('预览后服务器配置发生变化，请重新预览')
        let imported = 0
        for (const [index, entry] of pending.entries.entries()) {
          const action = choices[index], row = pending.rows[index]
          if (action === 'skip') continue
          if (!['add', 'replace'].includes(action) || row.revoked || (action === 'replace' && !row.existingId) || (row.duplicate && action !== 'replace')) throw new Error('重复或已撤销连接必须跳过，或明确选择更新已有连接')
          if (entry.hostKeys.length && !trustHosts) throw new Error('请核对并确认信任连接包中的主机指纹')
          // Re-check public host trust immediately before committing, not only at preview time.
          const now = await this.readHosts(entry.config)
          const existingTrust = data.servers.find(s => s.id === row.existingId)
          if (existingTrust?.knownHostsPath) now.push(...await this.readHosts(existingTrust))
          if (JSON.stringify(now.map(fingerprint)) !== JSON.stringify(pending.localHosts[index])) throw new Error('预览后本机主机指纹发生变化，请重新预览')
          if (entry.hostKeys.some(k => now.some(l => l.revoked && l.data === k.data))) throw new Error('主机密钥已撤销，不能导入')
          const server = { ...portable(entry.config), notes: entry.config.notes, id: action === 'replace' ? row.existingId : randomUUID() }
          const previous = data.servers.find(s => s.id === server.id)
          if (previous && !entry.hasNotes) server.notes = previous.notes
          if (previous && !entry.privateKey && previous.authType === server.authType) server.privateKeyPath = previous.privateKeyPath
          if (previous && !entry.hostKeys.length) server.knownHostsPath = previous.knownHostsPath
          await mkdir(this.directory, { recursive: true, mode: 0o700 }); await protectFile(this.directory)
          if (entry.privateKey) { server.privateKeyPath = join(this.directory, `${randomUUID()}.key`); await writeFile(server.privateKeyPath, entry.privateKey, { flag: 'wx', mode: 0o600 }); created.push(server.privateKeyPath); await protectFile(server.privateKeyPath) }
          if (entry.hostKeys.length) { server.knownHostsPath = join(this.directory, `${randomUUID()}.known_hosts`); await writeFile(server.knownHostsPath, entry.hostKeys.map(k => `${target(entry.config)} ${k.type} ${k.data}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 }); created.push(server.knownHostsPath) }
          const validated = validateServer(server); assignGroup(data, validated, { group: server.group })
          const existing = data.servers.findIndex(s => s.id === validated.id)
          if (existing >= 0) data.servers[existing] = validated; else data.servers.push(validated)
          imported++
        }
        if (!imported) throw new Error('没有选择需要导入的服务器')
        data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), kind: 'server', title: '导入设备连接包', detail: `${imported} 台服务器` }); data.history = data.history.slice(0, 500)
        return { imported }
      })
      this.discard(token); return result
    } catch (error) { for (const file of created) await unlink(file).catch(() => {}); throw error }
  }
}
module.exports = { Migration, seal, unseal, validatePayload, parseHostKeys, fingerprint, endpoint }
