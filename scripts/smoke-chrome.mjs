import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('artifacts/chrome-'))
const executable = process.argv[2]
const app = await electron.launch(executable ? { executablePath: resolve(executable) } : { args: ['.'], env: { ...process.env, SERVERS_TEST_DATA: data, SERVERS_DEV: '0' } })
let closed = false
try {
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.getByRole('button', { name: '最大化窗口', exact: true }).waitFor()
  assert.equal(await page.locator('.brand-logo').evaluate(img => img.complete && img.naturalWidth > 0), true)
  assert.equal(await page.locator('.app-header').evaluate(el => getComputedStyle(el).getPropertyValue('app-region')), 'drag')
  assert.equal(await page.locator('.window-controls').evaluate(el => getComputedStyle(el).getPropertyValue('app-region')), 'no-drag')
  const bounds = await app.evaluate(({ BrowserWindow }) => ({ outer: BrowserWindow.getAllWindows()[0].getBounds(), inner: BrowserWindow.getAllWindows()[0].getContentBounds() }))
  assert.ok(bounds.outer.height - bounds.inner.height < 16, 'native title bar must be absent')
  await page.getByRole('button', { name: '最大化窗口', exact: true }).click()
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true)
  await page.reload()
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor()
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  await page.getByRole('button', { name: '最大化窗口', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), false)
  await page.getByRole('button', { name: '最小化窗口', exact: true }).click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus() })
  // State also follows OS/programmatic maximize, not only the custom button.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor()
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  const rejected = await page.evaluate(async () => { try { await window.servers.windowControl('arbitrary'); return false } catch { return true } })
  assert.equal(rejected, true)
  await page.getByRole('button', { name: '关闭窗口', exact: true }).hover()
  await page.screenshot({ path: 'artifacts/frameless-window.png' })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(960, 720); w.webContents.setZoomFactor(1.5) })
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.window-controls button')].every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })), true)
  const zoom = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL())
  await writeFile('artifacts/frameless-zoom.png', Buffer.from(zoom.split(',')[1], 'base64'))
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await page.waitForTimeout(200)
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false)
  const exit = app.waitForEvent('close')
  await page.evaluate(()=>window.servers.quit()).catch(()=>{})
  await exit; closed = true
  console.log('PASS: frameless geometry, logo, draggable regions, minimize, maximize/restore, OS state sync, reload, IPC allowlist, zoom and custom close')
} finally { if (!closed) await app.close() }
