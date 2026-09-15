const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { lstat, chmod, realpath } = require('node:fs/promises')
const { join, resolve, relative, isAbsolute } = require('node:path')
const exec = promisify(execFile)
let managedDirectory
const pending = new Map()
function setManagedKeyDirectory(directory) { managedDirectory = resolve(directory) }
async function protectFile(file) {
  const info = await lstat(file)
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('不能调整链接或特殊文件的私钥权限')
  if (process.platform !== 'win32') { await chmod(file, info.isDirectory() ? 0o700 : 0o600); return }
  // Build a fresh DACL in one write. /grant:r alone preserves unrelated explicit ACEs.
  const script = `$ErrorActionPreference='Stop'
$file=$env:SERVERLOOM_PROTECT_PATH
$item=Get-Item -LiteralPath $file -Force
if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing reparse point'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
if($item.PSIsContainer){
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
}else{
  $acl=New-Object Security.AccessControl.FileSecurity
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule($rule)
$item.SetAccessControl($acl)`
  await exec(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, env: { ...process.env, SERVERLOOM_PROTECT_PATH: file } })
}
async function prepareManagedKey(file) {
  if (!managedDirectory) return
  const inside = relative(managedDirectory, resolve(file))
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return
  const same = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  if (!same(await realpath(managedDirectory), managedDirectory) || !same(await realpath(file), resolve(file))) throw new Error('托管私钥路径不能经过链接')
  let job = pending.get(file)
  if (!job) { job = protectFile(file).finally(() => pending.delete(file)); pending.set(file, job) }
  try { await job } catch { throw new Error('无法收紧应用托管私钥的本机权限；尚未尝试服务器认证，请检查文件所有权和访问权限') }
}
module.exports = { protectFile, prepareManagedKey, setManagedKeyDirectory }
