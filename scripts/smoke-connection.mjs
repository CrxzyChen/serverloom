import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const [host, user, key] = process.argv.slice(2)
if (!key) throw new Error('Pass host, username and key path explicitly; this test connects to that host.')
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('artifacts/connection-ui-'))
const app = await electron.launch({ args: ['.'], env: { ...process.env, SERVERS_TEST_DATA: data, SERVERS_DEV: '0' } })
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '添加服务器', exact: true }).first().click()
  await page.getByLabel('服务器名称', { exact: true }).fill('home-server')
  await page.getByLabel('主机地址', { exact: true }).fill(host)
  await page.getByLabel('SSH 用户', { exact: true }).fill(user)
  await page.getByLabel('认证方式', { exact: true }).selectOption('privateKey')
  await page.getByLabel('私钥文件路径', { exact: true }).fill(key)
  await page.getByRole('button', { name: '保存服务器', exact: true }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'SSH 私钥认证和只读检查通过' }).waitFor({ timeout: 25000 })
  const server = await page.evaluate(async () => (await window.servers.load()).servers[0])
  assert.equal(server.lastConnection.status, 'passed')
  await page.screenshot({ path: 'artifacts/connection-passed.png' })
  await page.reload()
  await page.getByRole('button', { name: new RegExp('home-server ' + host.replaceAll('.', '\\.')) }).click()
  await page.getByText(/上次 SSH 测试通过/).waitFor()
  console.log('PASS: existing key pasted without picker, real SSH test, persisted result, renderer reload')
} finally { await app.close() }
