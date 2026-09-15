import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import assert from 'node:assert/strict'
const data = await mkdtemp(resolve('artifacts/package-smoke-'))
const app = await electron.launch({ args: ['--user-data-dir=' + data], executablePath: resolve(process.argv[2] || 'release-alpha/win-unpacked/ServerLoom.exe') })
try {
  const page = await app.firstWindow()
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1360,900);w.webContents.setZoomFactor(1)})
  await page.getByRole('heading', { name: '选择服务器，开始工作。' }).waitFor()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.getByRole('button', { name: '运行时设置', exact: true }).click()
  await page.getByRole('button', { name: '停止运行时', exact: true }).waitFor({ timeout: 45000 })
  const accountExists = await page.evaluate(async () => !!(await window.servers.account()).account)
  if (accountExists) {
    await page.getByRole('button', { name: '重新登录', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '运行时设置', exact: true }).click()
    await page.getByRole('button', { name: '重新登录', exact: true }).waitFor()
  }
  await page.getByRole('button', { name: '停止运行时', exact: true }).click()
  console.log(`PASS: packaged auto-start, isolated preload; saved login ${accountExists ? 'restored on load and reload' : 'not present'}`)
} finally { await app.close() }
