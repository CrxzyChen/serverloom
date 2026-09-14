const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Tray, Menu, Notification, powerMonitor } = require('electron')
const { join } = require('node:path')
const { Runtime } = require('./runtime.cjs')
const { Store } = require('./store.cjs')
const { ServerTools, serverTools, instructions } = require('./server-tools.cjs')
const { validateKeyPath } = require('./ssh.cjs')
const { executeCommand } = require('./ssh.cjs')
const { Workbench } = require('./workbench.cjs')
const { Attachments } = require('./attachments.cjs')
const { Copilot, turnOptions } = require('./copilot.cjs')
const { scheduleTools, executeScheduleTool } = require('./schedule-tools.cjs')
const { ScheduleApprovals } = require('./schedule-approvals.cjs')
const { Scheduler } = require('./scheduler.cjs')
const { createExecutor } = require('./scheduled-executor.cjs')
let scheduler, tray, quitting = false, quitReady = false
const { Migration } = require('./migration.cjs')
let window, runtime, store, workbench, migration, attachments, copilot, migrationBusy = false, active = null, sending = false
const threads = new Map()
const connectionChecks = new Set()
const dev = !app.isPackaged && process.env.SERVERS_DEV === '1'
function windowState() { return { maximized: !!window?.isMaximized(), focused: !!window?.isFocused(), fullscreen: !!window?.isFullScreen() } }
if (process.env.SERVERS_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.SERVERS_TEST_DATA)
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender')
    return fn(...args)
  })
}
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => { window?.show(); window?.restore(); window?.focus() })
if (primaryInstance) app.whenReady().then(async () => {
  const directory = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(__dirname, '../resources/runtime')
  runtime = new Runtime(directory, !app.isPackaged && process.env.SERVERS_TEST_DATA && process.env.SERVERS_TEST_RUNTIME_HOME ? process.env.SERVERS_TEST_RUNTIME_HOME : join(app.getPath('userData'), 'codex'))
  store = new Store(join(app.getPath('userData'), 'servers.json'))
  attachments = new Attachments(store, join(app.getPath('userData'), 'attachments'))
  copilot = new Copilot(runtime, store, attachments)
  migration = new Migration(store, join(app.getPath('userData'), 'imported-credentials'))
  async function migrationJob(fn) { if (migrationBusy) throw new Error('请等待当前迁移操作完成'); migrationBusy = true; try { return await fn() } finally { migrationBusy = false } }
  workbench = new Workbench(store, event => window?.webContents.send('runtime:event', event))
  const selectKey = async signal => {
    signal?.throwIfAborted()
    if (!window) throw new Error('客户端窗口已关闭')
    const result = await dialog.showOpenDialog(window, { title: '选择 SSH 私钥文件（仅保存路径）', properties: ['openFile'], buttonLabel: '使用此私钥' })
    signal?.throwIfAborted()
    return result.canceled ? null : result.filePaths[0]
  }
  const tools = new ServerTools(store, selectKey, (server, notice) => window?.webContents.send('runtime:event', { method: 'servers/changed', params: { server, notice } }))
  tools.openPanel = params => window?.webContents.send('runtime:event', { method: 'workbench/openPanel', params })
  const scheduleApprovals = new ScheduleApprovals(event => { runtime.emit('event',event) })
  runtime.toolHandler = async (params, signal) => {
    if (![...threads.values()].includes(params.threadId)) throw new Error('未知会话，拒绝客户端工具调用')
    copilot.checkTool(params.threadId, params.tool)
    const run = scheduler?.current
    if (!run || run.threadId !== params.threadId) throw new Error('工具调用不属于当前执行任务')
    await scheduleApprovals.check(run,params,signal)
    if(params.tool.startsWith('schedules_')) return executeScheduleTool(scheduler,params)
    const result = await tools.execute(params, signal)
    return result
  }
  const record = entry => store.record(entry).catch(error => window?.webContents.send('runtime:event', { method: 'runtime/storageError', params: { message: error.message } }))
  runtime.on('event', event => {
    if (event.method === 'runtime/status' && event.params.state !== 'ready') { active = null; threads.clear() }
    if (event.method === 'turn/started') active = { threadId: event.params.threadId, turnId: event.params.turn.id }
    if (event.method === 'turn/completed') { active = null; record({ kind: 'turn', title: '任务结束', detail: event.params.turn.status }) }
    if (event.method === 'item/completed' && event.params.item?.type === 'commandExecution') record({ kind: 'command', title: event.params.item.command, detail: event.params.item.status })
    const conversationId = [...threads.entries()].find(([, id]) => id === event.params?.threadId)?.[0]
    copilot.event(event, conversationId).catch(error => window?.webContents.send('runtime:event', { method: 'runtime/storageError', params: { message: error.message } }))
    window?.webContents.send('runtime:event', { ...event, conversationId })
  })
  handle('data:load', async () => ({ ...await store.read(), runtime: { state: runtime.state, detail: runtime.detail || '' }, window: windowState() }))
  handle('window:control', action => {
    if (!['minimize', 'toggleMaximize', 'close'].includes(action)) throw new Error('不支持的窗口操作')
    if (action === 'minimize') window.minimize()
    if (action === 'toggleMaximize') {
      if (window.isFullScreen()) window.setFullScreen(false)
      else if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    }
    if (action === 'close') setImmediate(() => window?.close())
    return windowState()
  })
  handle('text:copy', text => { if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('复制内容无效或过长'); clipboard.writeText(text) })
  handle('link:open', async value => {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('链接无效')
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅支持打开 HTTP/HTTPS 网页')
    await shell.openExternal(url.toString())
  })
  handle('server:save', async value => { if (value?.authType === 'privateKey' && value.privateKeyPath) await validateKeyPath(value.privateKeyPath); const result = await store.saveServer(value); threads.delete(result.id); await record({ kind: 'server', title: '保存服务器', detail: result.name }); return result })
  handle('server:selectKey', () => selectKey())
  handle('group:save', value => store.saveGroup(value))
  handle('group:remove', id => store.removeGroup(id))
  handle('group:reorder', value => store.reorderGroup(value.id, value.direction))
  handle('server:moveGroup', value => store.upsertServer({ id: value.id, groupId: value.groupId }))
  handle('migration:select', async path => {
    if (path !== undefined && (typeof path !== 'string' || !path.toLowerCase().endsWith('.servers'))) throw new Error('请选择 .servers 连接包')
    if (!path) { const result = await dialog.showOpenDialog(window, { title: '导入设备连接包', filters: [{ name: 'ServerLoom 加密连接包', extensions: ['servers'] }], properties: ['openFile'] }); if (result.canceled) return null; path = result.filePaths[0] }
    return migrationJob(() => migration.stage(path))
  })
  handle('migration:preview', value => migrationJob(() => migration.preview(value.token, value.passphrase)))
  handle('migration:commit', value => migrationJob(() => migration.commit(value.token, value.choices, value.trustHosts)))
  handle('migration:discard', token => migration.discard(token))
  handle('migration:export', value => migrationJob(async () => {
    const bytes = await migration.export(value.ids, value.passphrase, value.includeKeys, value.includeNotes)
    const result = await dialog.showSaveDialog(window, { title: '迁移到我的设备', defaultPath: 'my-servers.servers', filters: [{ name: 'ServerLoom 加密连接包', extensions: ['servers'] }] })
    if (result.canceled) return { canceled: true }
    await require('node:fs/promises').writeFile(result.filePath, bytes, { mode: 0o600 })
    await store.record({ kind: 'server', title: '导出加密连接包', detail: `${value.ids.length} 台服务器` })
    return { saved: true, path: result.filePath }
  }))
  handle('workbench:open', value => workbench.open(value.serverId, value.kind, value.cols, value.rows))
  handle('workbench:close', id => workbench.close(id))
  handle('workbench:input', value => workbench.input(value.id, value.data))
  handle('workbench:resize', value => workbench.resize(value.id, value.cols, value.rows))
  handle('workbench:list', value => workbench.list(value.id, value.path))
  handle('workbench:preview', value => workbench.preview(value.id, value.path))
  handle('workbench:transfer', async value => {
    workbench.get(value.id, 'files')
    if (value.upload) {
      const choice = await dialog.showOpenDialog(window, { title: '上传到当前服务器目录', properties: ['openFile'] })
      if (choice.canceled) return { canceled: true }
      const local = choice.filePaths[0], remote = require('node:path').posix.join(value.path, require('node:path').basename(local))
      await workbench.transfer(value.id, remote, local, true)
    } else {
      const choice = await dialog.showSaveDialog(window, { title: '下载服务器文件', defaultPath: require('node:path').posix.basename(value.path) })
      if (choice.canceled) return { canceled: true }
      await workbench.transfer(value.id, value.path, choice.filePath, false)
    }
    return { completed: true }
  })
  handle('workbench:bandwidth', async serverId => {
    const server = (await store.read()).servers.find(s => s.id === serverId)
    if (!server) throw new Error('服务器不存在')
    const controller = new AbortController(); connectionChecks.add(controller)
    try { return await executeCommand(server, 'cat /proc/uptime; cat /proc/net/dev', 10000, controller.signal) }
    finally { connectionChecks.delete(controller) }
  })
  handle('server:test', async id => {
    const controller = new AbortController(); connectionChecks.add(controller)
    try { return await tools.execute({ tool: 'servers_test_connection', arguments: { id } }, controller.signal) }
    finally { connectionChecks.delete(controller) }
  })
  handle('runtime:start', () => runtime.start())
  handle('runtime:stop', () => { runtime.stop(); active = null; threads.clear() })
  handle('runtime:account', () => runtime.request('account/read', { refreshToken: false }))
  handle('runtime:login', async () => {
    const result = await runtime.request('account/login/start', { type: 'chatgpt' })
    const url = new URL(result.authUrl)
    if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Unexpected login URL')
    await shell.openExternal(url.toString())
    return { pending: true }
  })
  handle('copilot:catalog', refresh => copilot.catalog(!!refresh))
  handle('copilot:limits', () => runtime.request('account/rateLimits/read', {}))
  handle('copilot:settings', value => copilot.settings(value.conversationId, value.settings))
  handle('copilot:snapshot', async id => ({...await copilot.snapshot(id),approvals:[...runtime.approvals.values(),...[...scheduleApprovals.pending.values()].map(p=>p.event)]}))
  handle('copilot:answer', value => runtime.answer(value.id, value.answers))
  handle('attachments:add', async value => {
    let files = value.files
    if (!files) { const choice = await dialog.showOpenDialog(window, { title: '添加对话附件', properties: ['openFile', 'multiSelections'] }); if (choice.canceled) return []; files = choice.filePaths.map(path => ({ path })) }
    return attachments.add(value.conversationId, files)
  })
  handle('attachments:preview', value => attachments.preview(value.conversationId, value.id))
  handle('attachments:remove', async value => {const data=await store.read();if(data.runs?.some(r=>r.conversationId===value.conversationId&&['queued','running','waiting'].includes(r.status)&&r.value?.attachments?.includes(value.id)))throw new Error('附件已用于排队任务，请先停止任务');return attachments.remove(value.conversationId,value.id)})
  async function submit(value, run, signal) {
    signal?.throwIfAborted()
    if (sending || active) throw new Error('请等待当前任务结束，或先停止任务')
    if (!value || typeof value.text !== 'string' || (!value.text.trim() && !value.attachments?.length) || value.text.length > 30000) throw new Error('请输入 1–30000 字的任务')
    sending = true
    try {
      const server = (await store.read()).servers.find(s => s.id === value.serverId)
      if (value.serverId && !server) throw new Error('服务器不存在')
      const key = value.conversationId || server?.id || 'general'
      if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(key)) throw new Error('会话 ID 无效')
      const settings = await copilot.resolveSettings(key, value.settings)
      const attachmentIds = value.attachments || []
      const extraInputs = await attachments.inputs(key, attachmentIds, copilot.models.find(m => m.model === settings.model))
      const saved = (await store.read()).chatThreads?.[key]
      if (saved && saved.serverId !== (server?.id || '')) throw new Error('已有会话的服务器不能改变，请新建会话')
      let threadId = threads.get(key)
      if (!threadId) {
        const result = await runtime.request(saved ? 'thread/resume' : 'thread/start', {
          ...(saved ? { threadId: saved.threadId } : { dynamicTools: [...serverTools,...scheduleTools] }),
          cwd: join(runtime.home, 'workspace'), approvalPolicy: 'untrusted', sandbox: 'read-only',
          developerInstructions: instructions + '\n用户要求定时运行时使用 schedules 工具持久保存，不要仅口头承诺。后台任务严格遵守任务授权范围，任意命令需审批。' + (server ? '\n当前服务器台账：' + JSON.stringify(server) : '')
        })
        threadId = result.thread.id; threads.set(key, threadId)
        await store.update(data => { data.chatThreads ||= {}; data.chatThreads[key] = { threadId, serverId: server?.id || '' } })
      }
      signal?.throwIfAborted()
      if (scheduler.current?.id === run.id) scheduler.current.threadId = threadId
      copilot.threadModes.set(threadId, settings.mode)
      await record({ kind: 'task', title: value.text.slice(0, 120), detail: server?.name || '全局工作区' })
      const result = await runtime.request('turn/start', { threadId, ...turnOptions(settings), input: [...(value.text.trim() ? [{ type: 'text', text: value.text, text_elements: [] }] : []), ...extraInputs] })
      await attachments.markSent(key, attachmentIds).catch(error => window?.webContents.send('runtime:event', {method:'runtime/storageError',params:{message:error.message}}))
      return { threadId, turnId: result.turn.id, settings }
    } finally { sending = false }
  }
  scheduler = new Scheduler(store, createExecutor(runtime, submit, store), () => { window?.webContents.send('runtime:event', {method:'scheduler/changed',params:{}}); void updateTray() }, (run,title,body) => { if (Notification.isSupported()) { const notification = new Notification({title:`ServerLoom · ${title}`,body}); notification.on('click',()=>{window?.show();window?.focus();window?.webContents.send('runtime:event',{method:'scheduler/openRun',params:{run}})}); notification.show() } })
  handle('runtime:send', value => scheduler.manual(value))
  handle('scheduler:snapshot', () => scheduler.snapshot())
  handle('scheduler:save', value => scheduler.save(value))
  handle('scheduler:remove', id => scheduler.remove(id))
  handle('scheduler:enable', value => scheduler.enable(value.id,value.enabled))
  handle('scheduler:pause', value => scheduler.pause(value))
  handle('scheduler:run', id => scheduler.runNow(id))
  handle('scheduler:cancel', id => scheduler.cancel(id))
  handle('desktop:settings', async value => {
    if(value) { if(typeof value.loginStartup !== 'boolean' || typeof value.startHidden !== 'boolean') throw new Error('启动设置无效'); if(!app.isPackaged && value.loginStartup) throw new Error('请在打包客户端中开启登录启动'); app.setLoginItemSettings({openAtLogin:value.loginStartup,args:value.startHidden?['--hidden']:[]}); await store.update(d=>{d.desktop=value}) }
    const preferences = (await store.read()).desktop || {loginStartup:false,startHidden:false}
    return {...preferences,loginStartup:app.getLoginItemSettings({args:preferences.startHidden?['--hidden']:[]}).openAtLogin}
  })
  handle('desktop:quit', () => requestQuit())
  async function requestQuit() {
    const snapshot=await scheduler.snapshot(), count=snapshot.runs.filter(r=>['running','waiting','queued'].includes(r.status)).length
    if(count) { const choice=await dialog.showMessageBox(window,{type:'question',buttons:['取消','退出并停止任务'],defaultId:0,cancelId:0,message:`退出将中断或取消 ${count} 个任务，并关闭所有 SSH 会话。`,detail:'定时任务会停止运行，重新启动后不会自动重放中断任务。'}); if(choice.response!==1)return }
    app.quit()
  }
  async function updateTray() {
    if(!tray || quitting)return
    const snap=await scheduler.snapshot(), current=snap.runs.find(r=>r.id===snap.current)
    tray.setToolTip(current?`ServerLoom · ${current.name}`:'ServerLoom · 后台运行')
    tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 ServerLoom',click:()=>{window?.show();window?.focus()}},{label:current?`当前任务：${current.name}`:'当前没有运行任务',enabled:false},{label:snap.paused?'恢复 Scheduler':'暂停 Scheduler',click:()=>scheduler.pause(!snap.paused)},{type:'separator'},{label:'退出 ServerLoom',click:()=>requestQuit()}]))
  }
  handle('runtime:interrupt', async () => { runtime.cancelTools(); if (active) await runtime.request('turn/interrupt', active) })
  handle('runtime:approve', async value => { if(scheduleApprovals.pending.has(value.id)){scheduleApprovals.answer(value.id,value.decision);return}; const request = runtime.approvals.get(value.id); if(value.decision==='accept' && scheduler.current?.task?.operations==='readonly') throw new Error('此定时任务仅允许只读检查，不能批准命令或文件变更'); if (value.decision === 'accept' && copilot.threadModes.get(request?.params.threadId) === 'plan') throw new Error('Plan 模式不批准命令或文件变更，请切换 Agent'); runtime.approve(value.id, value.decision); await record({ kind: 'approval', title: '操作审批', detail: value.decision }) })
  function createWindow() {
    window = new BrowserWindow({ show: !process.argv.includes('--hidden'), width: 1360, height: 900, minWidth: 880, minHeight: 640, frame: false, resizable: true, backgroundColor: '#0D1118', title: 'ServerLoom', icon: join(__dirname, '../resources/branding/servers.ico'), webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    const publishWindowState = () => window?.webContents.send('runtime:event', { method: 'window/state', params: windowState() })
    for (const event of ['maximize', 'unmaximize', 'focus', 'blur', 'restore', 'enter-full-screen', 'leave-full-screen']) window.on(event, publishWindowState)
    window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('did-start-loading', () => { workbench.closeAll(); migration.clear() })
    if (dev) window.loadURL('http://127.0.0.1:5173'); else window.loadFile(join(__dirname, '../dist/index.html'))
    window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window.hide() } })
    window.on('closed', () => { window = null })
  }
  tray = new Tray(join(__dirname, '../resources/branding/servers.ico'))
  tray.on('double-click',()=>{window?.show();window?.focus()})
  createWindow()
  await runtime.start().catch(error => runtime.status('error', error.message))
  await scheduler.init()
  await updateTray()
  powerMonitor.on('resume',()=>scheduler.tick().catch(error=>runtime.status('error',error.message)))
  // Own runtime lifetime in the main process; renderer reloads must not spawn it again.
  // Runtime has started before recovery and schedule dispatch.
  app.on('activate', () => { if (!window) createWindow() })
})
app.on('before-quit', event => {
  if(quitReady)return
  event.preventDefault(); if(quitting)return; quitting=true
  runtime?.stop();workbench?.closeAll();for(const controller of connectionChecks)controller.abort()
  Promise.resolve(scheduler?.shutdown()).finally(()=>{quitReady=true;tray?.destroy();app.quit()})
})
app.on('window-all-closed', () => { if(!tray)app.quit() })
