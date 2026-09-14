import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('artifacts/markdown-ui-'))
const app = await electron.launch({ args: ['.'], env: { ...process.env, SERVERS_TEST_DATA: data, SERVERS_DEV: '0' } })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '把运维交给工作台。' }).waitFor()
  // Capture IPC side effects without changing the user's clipboard or opening a browser.
  await app.evaluate(({ clipboard, shell }) => {
    clipboard.writeText = text => { globalThis.markdownCopied = text }
    shell.openExternal = async url => { globalThis.markdownOpened = url }
  })
  const command = 'ssh -i "$env:USERPROFILE\\.ssh\\id_ed25519_example" admin@192.0.2.10\n'
  const source = '## 连接配置已完成\n\n**home-server** 的私钥已绑定，用户为 `admin`。\n\n1. 保存连接信息\n2. 绑定已有私钥\n3. 测试 SSH 认证\n\n| 项目 | 结果 |\n| --- | --- |\n| 主机 | 192.0.2.10 |\n| SSH 检查 | 通过 |\n\n> 连接测试通过，测试会话已关闭。\n\n```powershell\n' + command
  await app.evaluate(({ BrowserWindow }, text) => BrowserWindow.getAllWindows()[0].webContents.send('runtime:event', { method: 'item/agentMessage/delta', params: { itemId: 'markdown-test', delta: text } }), source)
  await page.getByRole('heading', { name: '连接配置已完成' }).waitFor()
  assert.equal(await page.locator('.markdown-body strong').textContent(), 'home-server')
  assert.equal(await page.locator('.markdown-body table tbody tr').count(), 2)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime:event', { method: 'item/agentMessage/delta', params: { itemId: 'markdown-test', delta: '```\n\n查看 [Ubuntu 文档](https://help.ubuntu.com/)。\n\n<script>window.markdownUnsafe = true</script>' } }))
  await page.getByRole('button', { name: '复制代码', exact: true }).click()
  assert.equal(await app.evaluate(() => globalThis.markdownCopied), command)
  await page.getByRole('link', { name: 'Ubuntu 文档', exact: true }).click()
  assert.equal(await app.evaluate(() => globalThis.markdownOpened), 'https://help.ubuntu.com/')
  assert.equal(await page.evaluate(() => window.markdownUnsafe), undefined)
  assert.equal(await page.evaluate(async () => { try { await window.servers.openLink('javascript:alert(1)'); return false } catch { return true } }), true)
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: 'artifacts/markdown-chat.png' })
  await page.locator('.md-code-block').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'artifacts/markdown-code.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  console.log('PASS: streamed Markdown, headings/list/table/code, exact clipboard IPC, browser-link IPC, unsafe HTML/URL rejection, narrow layout')
} finally { await app.close() }
