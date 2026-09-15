const { prepareManagedKey } = require('./key-permissions.cjs')
const { execFile } = require('node:child_process')
const { stat } = require('node:fs/promises')
const { isAbsolute, join } = require('node:path')
const { validateServer } = require('./store.cjs')
async function validateKeyPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\r\n\0]/.test(path)) throw new Error('请提供私钥的本机绝对路径，不是私钥内容')
  if (/\.pub$/i.test(path)) throw new Error('这是公钥文件，请使用不带 .pub 的私钥文件')
  if (!(await stat(path)).isFile()) throw new Error('私钥路径必须指向本机文件')
  await prepareManagedKey(path)
  return path
}
const probeCommand = "printf 'SERVERS_CONNECTION_OK\\n'; id -un; uname -s"
const hardwareChecks = Object.freeze({
  system: 'uname -sr && id -un',
  cpu: 'lscpu',
  memory: 'free -b',
  disks: 'lsblk -b -J -o NAME,SIZE,TYPE,MOUNTPOINTS,MODEL',
  filesystems: 'df -P -B1 -x tmpfs -x devtmpfs',
  load: 'uptime && cat /proc/loadavg',
  activity: 'vmstat 1 2'
})
const hardwareCommand = 'export LC_ALL=C; ' + Object.entries(hardwareChecks).map(([name, command]) =>
  `printf '\\n__SERVERS_BEGIN_${name}__\\n'; ( ${command} ) 2>&1; servers_check_rc=$?; printf '\\n__SERVERS_END_${name}__:%s\\n' "$servers_check_rc"`
).join('; ')
const profiles = Object.freeze({ connection: probeCommand, hardware: hardwareCommand })
function buildSshArgs(value, profile = 'connection') {
  if (!Object.hasOwn(profiles, profile)) throw new Error('不支持的 SSH 采集类型')
  const server = validateServer(value)
  if (server.configStatus !== 'configured') throw new Error(`配置待补全：${server.missingFields.join('、')}`)
  const args = ['-F', 'none', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'PreferredAuthentications=publickey', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no']
  if (server.authType === 'privateKey') args.push('-o', 'IdentitiesOnly=yes', '-i', server.privateKeyPath)
  if (server.knownHostsPath) args.push('-o', `UserKnownHostsFile="${server.knownHostsPath.replace(/\\/g, '/').replace(/"/g, '\\"')}"`)
  args.push('-p', String(server.port), '-l', server.user, '--', server.host.replace(/^\[|\]$/g, ''), profiles[profile])
  return args
}
function classifyFailure(error, stderr = '') {
  if (error.name === 'AbortError') return { status: 'canceled', message: '连接测试已停止' }
  if (error.code === 'ENOENT') return { status: 'failed', reason: 'ssh_missing', message: '本机未安装 OpenSSH 客户端' }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) return { status: 'failed', reason: 'host_key_changed', message: '服务器主机指纹发生变化，请核实后更新 known_hosts；未绕过验证' }
  if (/Host key verification failed|No .*host key is known/i.test(stderr)) return { status: 'failed', reason: 'host_key_untrusted', message: '尚未信任此服务器主机指纹，请先核实并通过 SSH 确认一次' }
  if (/UNPROTECTED PRIVATE KEY FILE|bad permissions|permissions .* (?:too open|too permissive)|Bad owner or permissions/i.test(stderr)) return { status: 'failed', reason: 'key_permissions', message: '本机私钥权限过宽，OpenSSH 拒绝加载；尚不能判断服务器是否接受密钥，无需重建。应用导入的私钥会自动收紧权限；外部私钥需先修复本机权限。' }
  if (/Load key .*Permission denied|Identity file .*not accessible/i.test(stderr)) return { status: 'failed', reason: 'key_unreadable', message: '本机私钥文件无法读取，请检查路径和访问权限；尚未验证服务器认证' }
  if (/invalid format|error in libcrypto/i.test(stderr)) return { status: 'failed', reason: 'key_format', message: '本机私钥格式无法识别，请核对是否选中了正确的私钥文件' }
  if (/Load key .*incorrect passphrase|encrypted private key|passphrase/i.test(stderr)) return { status: 'failed', reason: 'key_passphrase', message: '私钥需要口令，请先解锁到 SSH Agent 并选择 SSH Agent 认证' }
  if (/Permission denied/i.test(stderr)) return { status: 'failed', reason: 'authentication', message: '服务器未接受此次 SSH 认证；请核对用户名与已授权的公钥，这不能证明私钥损坏' }
  if (/Load key/i.test(stderr)) return { status: 'failed', reason: 'key_load', message: '本机未能加载私钥，请检查密钥格式、口令和访问权限；不要直接重建密钥' }
  if (error.killed || /timed out/i.test(stderr)) return { status: 'failed', reason: 'timeout', message: '连接超时，请检查地址、端口和网络' }
  if (/Connection refused/i.test(stderr)) return { status: 'failed', reason: 'refused', message: '服务器拒绝连接，请检查 SSH 服务和端口' }
  return { status: 'failed', reason: 'ssh_error', message: 'SSH 测试失败，请检查连接配置', detail: stderr.trim().slice(0, 2000) }
}
async function runProfile(server, profile, signal) {
  signal?.throwIfAborted()
  const args = buildSshArgs(server, profile)
  if (server.authType === 'privateKey') await validateKeyPath(server.privateKeyPath)
  signal?.throwIfAborted()
  const binary = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : '/usr/bin/ssh'
  const started = Date.now()
  return new Promise(resolve => {
    execFile(binary, args, { windowsHide: true, timeout: profile === 'hardware' ? 25000 : 15000, maxBuffer: 131072, encoding: 'utf8', signal }, (error, stdout, stderr) => {
      const checkedAt = new Date().toISOString(), durationMs = Date.now() - started
      resolve({ error, stdout, stderr, checkedAt, durationMs })
    })
  })
}
async function testConnection(server, signal) {
  const { error, stdout, stderr, checkedAt, durationMs } = await runProfile(server, 'connection', signal)
  if (error) return { ...classifyFailure(error, stderr), checkedAt, durationMs }
  const lines = stdout.replace(/\r/g, '').split('\n'), marker = lines.indexOf('SERVERS_CONNECTION_OK')
  if (marker < 0) return { status: 'failed', reason: 'unexpected_response', message: 'SSH 已返回，但服务器没有完成预期的连接检查', checkedAt, durationMs }
  return { status: 'passed', message: 'SSH 私钥认证和只读检查通过（测试连接已关闭）', remoteUser: (lines[marker + 1] || '').slice(0, 80), system: (lines[marker + 2] || '').slice(0, 80), checkedAt, durationMs }
}
function parseHardware(stdout) {
  const text = stdout.replace(/\r/g, ''), sections = {}, missingSections = []
  for (const name of Object.keys(hardwareChecks)) {
    const match = text.match(new RegExp(`__SERVERS_BEGIN_${name}__\\n([\\s\\S]*?)\\n__SERVERS_END_${name}__:(\\d+)`))
    sections[name] = match ? { output: match[1].trim(), exitCode: Number(match[2]), available: Number(match[2]) === 0 } : { output: '', exitCode: null, available: false }
    if (!sections[name].available) missingSections.push(name)
  }
  const summary = {}
  if (sections.cpu.available) {
    const cpu = sections.cpu.output
    summary.cpuModel = cpu.match(/^Model name:\s*(.+)$/m)?.[1] || null
    summary.logicalCpus = Number(cpu.match(/^CPU\(s\):\s*(\d+)/m)?.[1]) || null
    summary.architecture = cpu.match(/^Architecture:\s*(.+)$/m)?.[1] || null
  }
  if (sections.memory.available) {
    const mem = sections.memory.output.match(/^Mem:\s+(.+)$/m)?.[1].trim().split(/\s+/).map(Number)
    if (mem?.length >= 6 && mem.every(Number.isFinite)) summary.memory = { totalBytes: mem[0], usedBytes: mem[1], freeBytes: mem[2], availableBytes: mem[5] }
  }
  if (sections.load.available) {
    const load = sections.load.output.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+\d+\/\d+/m)
    if (load) summary.loadAverage = load.slice(1, 4).map(Number)
  }
  if (sections.disks.available) { try { summary.blockDevices = JSON.parse(sections.disks.output).blockdevices } catch { /* Keep raw output if this platform does not emit valid JSON. */ } }
  const status = missingSections.length === Object.keys(hardwareChecks).length ? 'failed' : missingSections.length ? 'partial' : 'complete'
  return { status, summary, sections, missingSections, message: status === 'complete' ? '已采集 CPU、内存、磁盘和系统负载' : status === 'partial' ? `硬件采集部分完成，未获取：${missingSections.join('、')}` : '硬件采集失败，未获得可用结果' }
}
async function inspectHardware(server, signal) {
  const { error, stdout, stderr, checkedAt, durationMs } = await runProfile(server, 'hardware', signal)
  signal?.throwIfAborted()
  if (error) return { ...classifyFailure(error, stderr), checkedAt, durationMs }
  return { ...parseHardware(stdout), checkedAt, durationMs, scope: 'Linux 只读时间点采样；负载均值不是 CPU 使用率，vmstat 包含约一秒采样；不包含 SMART、温度或 GPU 健康检查' }
}
function buildCommandArgs(server, command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 30000 || command.includes('\0')) throw new Error('命令必须为 1–30000 字且不含 NUL')
  const args = buildSshArgs(server)
  // Only the remote shell interprets the command; no local shell is spawned.
  args[args.length - 1] = "sh -c '" + command.replace(/'/g, "'\\''") + "'"
  return args
}
async function executeCommand(server, command, timeoutMs = 30000, signal, runner = execFile) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('超时必须为 1000–120000 毫秒')
  signal?.throwIfAborted()
  const args = buildCommandArgs(server, command)
  if (server.authType === 'privateKey') await validateKeyPath(server.privateKeyPath)
  signal?.throwIfAborted()
  const binary = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : '/usr/bin/ssh'
  const started = Date.now()
  return new Promise(resolve => {
    runner(binary, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 262144, encoding: 'utf8', signal }, (error, stdout, stderr) => {
      const truncated = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      const status = signal?.aborted || error?.name === 'AbortError' ? 'canceled' : truncated ? 'output_limit' : error?.killed ? 'timeout' : error ? 'failed' : 'completed'
      resolve({ ...(error?.code === 255 ? classifyFailure(error, stderr) : {}), status, exitCode: !error ? 0 : Number.isInteger(error.code) ? error.code : null, stdout: stdout || '', stderr: stderr || '', truncated, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, message: error ? (status === 'failed' && error.code === 255 ? classifyFailure(error, stderr).message : error.message) : '远程命令执行完成', persistentSession: false, cancellationScope: '超时或停止会关闭本地 SSH 进程；已产生的远程变更不会撤销，远程后台任务可能继续运行' })
    })
  })
}
module.exports = { validateKeyPath, buildSshArgs, classifyFailure, testConnection, probeCommand, inspectHardware, parseHardware, hardwareChecks, buildCommandArgs, executeCommand }
