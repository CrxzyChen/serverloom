const { readFile, writeFile, rename, mkdir } = require('node:fs/promises')
const { dirname, isAbsolute } = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
function validateServer(value) {
  if (!value || typeof value !== 'object') throw new Error('服务器信息无效')
  const text = (key, max) => { const s = String(value[key] ?? '').trim(); if (s.length > max) throw new Error(`${key} 过长`); return s }
  const server = { id: value.id || randomUUID(), name: text('name', 80), host: text('host', 253), user: text('user', 64), port: Number(value.port ?? 22), group: text('group', 40), notes: text('notes', 2000), authType: value.authType || 'unspecified', privateKeyPath: text('privateKeyPath', 4096) }
  server.groupId = text('groupId', 64)
  server.knownHostsPath = text('knownHostsPath', 4096)
  if (server.knownHostsPath && (!isAbsolute(server.knownHostsPath) || /[\r\n\0]/.test(server.knownHostsPath))) throw new Error('主机指纹路径必须是本机绝对路径')
  if (typeof server.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(server.id)) throw new Error('服务器 ID 无效')
  if (!server.name || !/^[a-zA-Z0-9:.\[\]-]+$/.test(server.host) || server.host.startsWith('-')) throw new Error('请输入名称和有效的主机地址')
  if (server.user && !/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(server.user)) throw new Error('SSH 用户名无效')
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) throw new Error('端口必须在 1–65535 之间')
  if (!['unspecified', 'privateKey', 'sshAgent'].includes(server.authType)) throw new Error('不支持的认证方式')
  if (server.privateKeyPath && (!isAbsolute(server.privateKeyPath) || /[\r\n\0]/.test(server.privateKeyPath))) throw new Error('私钥路径必须是本机绝对路径')
  if (server.authType !== 'privateKey') server.privateKeyPath = ''
  server.missingFields = []
  if (!server.user) server.missingFields.push('SSH 用户名')
  if (server.authType === 'unspecified') server.missingFields.push('认证方式')
  if (server.authType === 'privateKey' && !server.privateKeyPath) server.missingFields.push('私钥文件')
  server.configStatus = server.missingFields.length ? 'draft' : 'configured'
  return server
}
async function replaceFile(source,target,replace=rename,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  for(let attempt=0;;attempt++){try{return await replace(source,target)}catch(error){if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await pause(25*(2**attempt))}}
}
class Store {
  constructor(file) { this.file = file; this.queue = Promise.resolve() }
  async read() { try { return normalizeGroups(JSON.parse(await readFile(this.file, 'utf8'))) } catch (error) { if (error.code === 'ENOENT') return { servers: [], history: [], groups: [] }; throw error } }
  update(fn) {
    const job = this.queue.then(async () => {
      const data = await this.read(); const result = await fn(data)
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 })
      await replaceFile(this.file + '.tmp', this.file)
      return result
    })
    this.queue = job.catch(() => {}); return job
  }
  saveServer(value) { const server = validateServer(value); return this.update(data => { assignGroup(data, server, value); const i = data.servers.findIndex(s => s.id === server.id); if (i < 0) data.servers.push(server); else { if (sameConnection(data.servers[i], server)) { server.lastConnection = data.servers[i].lastConnection; server.lastHardware = data.servers[i].lastHardware }; data.servers[i] = server }; return server }) }
  upsertServer(patch, signal) {
    return this.update(data => {
      signal?.throwIfAborted()
      let existing
      if (patch.id) { existing = data.servers.find(s => s.id === patch.id); if (!existing) throw new Error('服务器不存在，请先查询台账') }
      else {
        const matches = data.servers.filter(s => s.name === patch.name)
        if (matches.length > 1 || (matches.length === 1 && matches[0].host !== patch.host)) throw new Error('同名服务器已存在，请查询后提供明确 ID 更新')
        existing = matches[0]
      }
      const server = validateServer({ ...existing, ...patch })
      assignGroup(data, server, patch)
      if (existing && sameConnection(existing, server)) { server.lastConnection = existing.lastConnection; server.lastHardware = existing.lastHardware }
      const i = data.servers.findIndex(s => s.id === server.id)
      if (i < 0) data.servers.push(server); else data.servers[i] = server
      data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), kind: 'server', title: existing ? 'Agent 更新服务器' : 'Agent 创建服务器', detail: `${server.name} · ${server.host}` })
      data.history = data.history.slice(0, 500)
      return server
    })
  }
  recordConnection(snapshot, result, signal) {
    return this.update(data => {
      signal?.throwIfAborted()
      const server = data.servers.find(s => s.id === snapshot.id)
      if (!server || !sameConnection(server, snapshot)) throw new Error('测试期间连接配置发生变化，请使用新配置重新测试')
      server.lastConnection = result
      data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), kind: 'connection', title: 'SSH 连接测试', detail: `${server.name} · ${result.message}` })
      data.history = data.history.slice(0, 500)
      return server
    })
  }
  recordHardware(snapshot, result, signal) {
    return this.update(data => {
      signal?.throwIfAborted()
      const server = data.servers.find(s => s.id === snapshot.id)
      if (!server || !sameConnection(server, snapshot)) throw new Error('采集期间连接配置发生变化，请重新采集')
      server.lastHardware = { status: result.status, checkedAt: result.checkedAt, summary: result.summary, missingSections: result.missingSections, message: result.message }
      data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), kind: 'hardware', title: '硬件状态采集', detail: `${server.name} · ${result.message}` })
      data.history = data.history.slice(0, 500)
      return server
    })
  }
  record(entry) { return this.update(data => { data.history.unshift({ ...entry, id: randomUUID(), at: new Date().toISOString() }); data.history = data.history.slice(0, 500) }) }
  saveGroup({ id, name }) {
    name = String(name || '').trim()
    if (!name || name.length > 40 || name === '未分组') throw new Error('请输入 1–40 字的分组名称，不能使用“未分组”')
    return this.update(data => {
      if (data.groups.some(g => g.id !== id && g.name === name)) throw new Error('同名分组已存在')
      let group = id ? data.groups.find(g => g.id === id) : null
      if (id && !group) throw new Error('分组不存在')
      if (!group) { group = { id: randomUUID(), name }; data.groups.push(group) } else group.name = name
      for (const server of data.servers) if (server.groupId === group.id) server.group = name
      return group
    })
  }
  removeGroup(id) { return this.update(data => { if (!data.groups.some(g => g.id === id)) throw new Error('分组不存在'); data.groups = data.groups.filter(g => g.id !== id); for (const s of data.servers) if (s.groupId === id) { s.groupId = ''; s.group = '' } }) }
  reorderGroup(id, direction) { return this.update(data => { if (![1, -1].includes(direction)) throw new Error('排序方向无效'); const index = data.groups.findIndex(g => g.id === id), next = index + direction; if (index < 0) throw new Error('分组不存在'); if (next >= 0 && next < data.groups.length) [data.groups[index], data.groups[next]] = [data.groups[next], data.groups[index]] }) }
}
function normalizeGroups(data) {
  data.groups ||= []
  for (const server of data.servers) {
    if (server.groupId && data.groups.some(g => g.id === server.groupId)) { server.group = data.groups.find(g => g.id === server.groupId).name; continue }
    const name = String(server.group || '').trim()
    if (!name || name === '未分组') { server.groupId = ''; server.group = ''; continue }
    let group = data.groups.find(g => g.name === name)
    if (!group) { group = { id: 'group-' + createHash('sha256').update(name).digest('hex').slice(0, 24), name }; data.groups.push(group) }
    server.groupId = group.id
  }
  return data
}
function assignGroup(data, server, patch) {
  if (Object.hasOwn(patch, 'groupId')) {
    const group = data.groups.find(g => g.id === patch.groupId)
    if (patch.groupId && !group) throw new Error('分组不存在')
    server.groupId = group?.id || ''; server.group = group?.name || ''
  } else if (Object.hasOwn(patch, 'group')) {
    const name = server.group
    let group = data.groups.find(g => g.name === name)
    if (name && name !== '未分组' && !group) { group = { id: randomUUID(), name }; data.groups.push(group) }
    server.groupId = group?.id || ''; server.group = group?.name || ''
  }
}
function sameConnection(a, b) { return ['host', 'port', 'user', 'authType', 'privateKeyPath', 'knownHostsPath'].every(key => (a[key] ?? '') === (b[key] ?? '')) }
module.exports = { replaceFile, Store, validateServer, sameConnection, assignGroup }
