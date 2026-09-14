import { _electron as electron } from 'playwright'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url), { seal } = require('../electron/migration.cjs')
await mkdir('artifacts', { recursive: true }); const data = await mkdtemp(resolve('artifacts/flows-')); const file = join(data, 'fixture.servers')
await writeFile(file, await seal({ version: 1, servers: [{ config: { name: '迁移节点', host: 'import.example.invalid', user: 'tester', authType: 'sshAgent', group: '生产环境' } }] }, 'fixture-password-123'))
const exe = process.argv[2]; if (exe) throw new Error('Mutation smoke uses development isolation only'); const app = await electron.launch({ ...(exe ? { executablePath: resolve(exe) } : {}), args: exe ? [] : ['.'], env: { ...process.env, SERVERS_TEST_DATA: data, SERVERS_DEV: '0' } })
try {
 const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message))
 await page.getByRole('heading', { name: '选择服务器，开始工作。' }).waitFor()
 assert.equal(await page.getByRole('tab').count(), 0); assert.equal(await page.locator('.activity-rail').getByText('工具', { exact: true }).count(), 0)
 await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'drop-fixture'; document.body.appendChild(input) }); await page.locator('#drop-fixture').setInputFiles(file); await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(document.querySelector('#drop-fixture').files[0]); document.querySelector('.desktop-shell').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); document.querySelector('#drop-fixture').remove() }); await page.getByLabel('连接包口令').waitFor(); await page.getByLabel('关闭迁移对话框').click();
 await page.getByLabel('新建分组', { exact: true }).click(); await page.getByLabel('分组名称').fill('开发环境'); await page.getByRole('button', { name: '保存分组', exact: true }).click()
 await page.getByLabel('添加服务器', { exact: true }).click(); await page.getByLabel('服务器名称', { exact: true }).fill('开发节点'); await page.getByLabel('主机地址', { exact: true }).fill('dev.example.invalid'); await page.getByLabel('分组', { exact: true }).selectOption({ label: '开发环境' }); await page.getByRole('button', { name: '保存服务器', exact: true }).click()
 await page.getByRole('tab', { name: '概览 · 开发节点' }).waitFor(); await page.locator('.server-row').filter({ hasText: '开发节点' }).click(); assert.equal(await page.getByRole('tab').count(), 1)
 await page.getByRole('button', { name: '新建 Copilot 对话', exact: true }).click(); await page.getByRole('heading', { name: '开始管理 开发节点' }).waitFor()
 await page.getByRole('button', { name: '关闭 概览 · 开发节点', exact: true }).click(); await page.getByRole('heading', { name: '选择服务器，开始工作。' }).waitFor(); assert.equal(await page.getByRole('tab').count(), 0)
 await page.locator('.server-row').filter({ hasText: '开发节点' }).click({ button: 'right' }); await page.getByLabel('移动到分组', { exact: true }).selectOption(''); await page.waitForFunction(async () => !(await window.servers.load()).servers[0].groupId)
 await page.getByLabel('分组菜单 开发环境', { exact: true }).click(); await page.getByRole('menuitem', { name: '重命名分组' }).click(); await page.getByLabel('分组名称').fill('测试环境'); await page.getByRole('button', { name: '保存分组', exact: true }).click(); await page.getByLabel('分组菜单 测试环境', { exact: true }).waitFor()
 await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: file + '.export.servers' }) }, file)
 await page.locator('.asset-bottom').getByRole('button', { name: '导入连接包' }).click(); await page.getByLabel('连接包口令').fill('fixture-password-123'); await page.getByRole('button', { name: '解密并预览' }).click(); await page.getByRole('heading', { name: '预览连接包' }).waitFor(); await page.screenshot({ path: 'artifacts/migration-preview.png' }); await page.getByRole('button', { name: '确认导入', exact: true }).click(); await page.locator('.server-row').filter({ hasText: '迁移节点' }).waitFor()
 await page.locator('.server-row').filter({ hasText: '迁移节点' }).click(); await page.locator('.server-row').filter({ hasText: '开发节点' }).click(); assert.equal(await page.getByRole('tab').count(), 2)
 await page.getByRole('main').getByRole('button', { name: '迁移到我的设备', exact: true }).last().click(); await page.getByLabel('加密口令', { exact: true }).fill('fixture-password-123'); await page.getByLabel('确认口令', { exact: true }).fill('fixture-password-123'); await page.getByRole('button', { name: '导出加密连接包', exact: true }).click(); await page.getByRole('heading', { name: '迁移到我的设备', exact: true }).waitFor({ state: 'hidden' })
 await page.screenshot({ path: 'artifacts/server-groups-tabs.png' })
 await page.getByLabel('服务器菜单 迁移节点', { exact: true }).click(); await page.screenshot({ path: 'artifacts/server-context.png' }); await page.keyboard.press('Escape')
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720)); await page.getByLabel('运维工作台', { exact: true }).click(); await page.locator('.server-row').filter({ hasText: '迁移节点' }).click(); assert.equal(await page.getByRole('heading', { name: '迁移节点', exact: true }).isVisible(), true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: 'artifacts/flows-narrow.png' })
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
 assert.deepEqual(errors, []); console.log('PASS groups, closable deduplicated overview tabs, target binding, independent Copilot, encrypted import/export UI and narrow layout')
} catch (e) { const page = await app.firstWindow(); console.log(await page.locator('.form-error').allTextContents()); await page.screenshot({ path: 'artifacts/flows-failure.png' }); throw e } finally { await app.close() }
