<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import UpdateSettings from './components/UpdateSettings.vue'
import { Download } from 'lucide-vue-next'
import SchedulerPane from './components/SchedulerPane.vue'
import { Clock } from 'lucide-vue-next'
import TerminalPane from './components/TerminalPane.vue'
import FilesPane from './components/FilesPane.vue'
import BandwidthPane from './components/BandwidthPane.vue'
import ServerSidebar from './components/ServerSidebar.vue'
import MigrationDialog from './components/MigrationDialog.vue'
import ServerOverview from './components/ServerOverview.vue'
import ComposerOptions from './components/ComposerOptions.vue'
import TaskState from './components/TaskState.vue'
import QuotaStatus from './components/QuotaStatus.vue'
import { useCopilot } from './lib/copilot'
import logo from './assets/servers-logo.svg'
import { Minus, Copy, MessageSquare, FolderOpen, PanelRight, Maximize2, Minimize2, List, Network } from 'lucide-vue-next'
import MarkdownMessage from './components/MarkdownMessage.vue'
import { Server, Plus, Search, ArrowUp, Square, Activity, Settings2, Terminal, ChevronRight, ShieldCheck, CircleHelp, PanelLeft, X, Cpu, History, ArrowRight, RefreshCw } from 'lucide-vue-next'
const updateState=ref({version:'',phase:'idle',channel:'alpha',autoCheck:true})
const updateLabel=computed(()=>({checking:'检查更新中',available:'发现新版本',downloading:`下载更新 ${updateState.value.progress}%`,ready:'更新已就绪',waiting:'等待完成后更新',installing:'正在安装更新',error:'更新失败',current:'已是最新版本',idle:'软件更新'}[updateState.value.phase]))
async function showUpdates(){selectNav('settings');await nextTick();document.getElementById('software-updates')?.scrollIntoView()}
async function updateAction(name,value){try{const result=await api[name](value);if(result?.phase)updateState.value=result}catch(e){error.value=e.message}}
const scheduleState=ref({tasks:[],runs:[],paused:false,current:null}), desktop=ref({loginStartup:false,startHidden:false})
async function refreshSchedules(){scheduleState.value=await api.schedulerSnapshot();for(const r of scheduleState.value.runs){if(r.source==='manual'&&['failed','interrupted'].includes(r.status)){const m=messages.value.findLast(m=>m.role==='user'&&m.conversationId===r.conversationId);if(m&&!m.failed){m.failed=true;if(r.conversationId===conversationId.value)error.value=r.error}}}for(const tab of tabs.value){if(tab.kind==='schedule')tab.title=scheduleState.value.tasks.find(t=>t.id===tab.taskId)?.name||'新建定时任务'}}
async function saveDesktop(){await perform(async()=>{try{desktop.value=await api.desktopSettings({...desktop.value})}catch(e){desktop.value=await api.desktopSettings();throw e}})}
async function openSchedule(id='new'){if(id!=='new')await refreshSchedules();let tab=tabs.value.find(t=>t.kind==='schedule'&&t.taskId===id);if(!tab&&id!=='new'){tab=tabs.value.find(t=>t.kind==='schedule'&&t.taskId==='new');if(tab){tab.taskId=id;tab.title=scheduleState.value.tasks.find(t=>t.id===id)?.name||'定时任务'}}if(!tab){tab={id:crypto.randomUUID(),kind:'schedule',taskId:id,title:scheduleState.value.tasks.find(t=>t.id===id)?.name||'新建定时任务'};tabs.value.push(tab)};reveal(tab)}
async function openRun(run){let s=sessions.value.find(s=>s.id===run.conversationId);if(!s){s={id:run.conversationId,title:run.name,serverId:run.task?.serverIds?.length===1?run.task.serverIds[0]:'',updatedAt:Date.now(),draft:''};sessions.value.unshift(s)};switchChat(s.id);copilot.value=true;await cp.restore(s.id);const restored=await api.copilotSnapshot(s.id);approvals.value=restored.approvals||[];if(run.result&&!messages.value.some(m=>m.id==='run-'+run.id))messages.value.push({id:'run-'+run.id,role:'assistant',text:run.result,conversationId:s.id});}
const ownRun=computed(()=>scheduleState.value.runs.find(r=>r.conversationId===conversationId.value&&['queued','running','waiting'].includes(r.status)))
watch(scheduleState,()=>{const r=scheduleState.value.runs.find(r=>r.id===scheduleState.value.current);running.value=!!r;runningConversation.value=r?.conversationId||''})
const api = window.servers
const windowInfo = ref({ maximized: false, focused: true, fullscreen: false })
async function controlWindow(action) { try { await api.windowControl(action) } catch (e) { error.value = e.message } }
const page = ref('workspace'), servers = ref([]), groups = ref([]), migration = ref(null), history = ref([]), selected = ref(''), query = ref('')
const state = ref('stopped'), detail = ref(''), error = ref(''), busy = ref(false), running = ref(false), input = ref(''), account = ref(null), loginPending = ref(false)
const messages = ref([]), approvals = ref([]), showEditor = ref(false), editor = ref(null), feed = ref(null), sidebar = ref(innerWidth > 1100)
const form = reactive({ name: '', host: '', user: '', port: 22, group: '', groupId: '', knownHostsPath: '', notes: '', authType: 'unspecified', privateKeyPath: '' })
const savedNotice = ref('')
const savedNoticeFailed = ref(false), testing = ref(false)
const current = computed(() => servers.value.find(s => s.id === selected.value))
const filtered = computed(() => servers.value.filter(s => `${s.name} ${s.host} ${s.group}`.toLowerCase().includes(query.value.toLowerCase())))
const statusText = computed(() => ({ stopped: '未启动', starting: '正在启动', ready: '已就绪', error: '启动失败' })[state.value])
const prompts = [ { title: '查看硬件状态', text: '查看这台服务器当前的 CPU、内存、磁盘和系统负载，并分析异常。', icon: Cpu }, { title: '制定巡检计划', text: '为这台服务器制定一份日常巡检计划。', icon: Activity }, { title: '分析故障日志', text: '我想排查服务故障，请告诉我需要提供哪些日志。', icon: Terminal } ]
let unsubscribe, previousFocus
async function perform(fn) { error.value = ''; busy.value = true; try { return await fn() } catch (e) { error.value = e.message } finally { busy.value = false } }
async function load() { if (!api) return; const data = await api.load(); servers.value = data.servers; groups.value = data.groups || []; history.value = data.history; state.value = data.runtime.state; detail.value = data.runtime.detail; if (data.window) windowInfo.value = data.window; await refreshSchedules();desktop.value=await api.desktopSettings();updateState.value=await api.updateSnapshot() }
let accountRequest
async function refreshAccount() {
  if (state.value !== 'ready') return
  if (accountRequest) return accountRequest
  accountRequest = api.account().then(result => { if (state.value === 'ready') account.value = result.account }).finally(() => { accountRequest = null })
  return accountRequest
}
async function start() { await perform(() => api.start()) }
async function stop() { await perform(() => api.stop()); running.value = false; approvals.value = [] }
async function login() { await perform(async () => { await api.login(); loginPending.value = true }) }
async function openEditor(server) {
  error.value = ''
  previousFocus = document.activeElement
  Object.assign(form, { id: undefined, name: '', host: '', user: '', port: 22, group: '', groupId: '', knownHostsPath: '', notes: '', authType: 'unspecified', privateKeyPath: '' }, server || {})
  showEditor.value = true; await nextTick(); editor.value.showModal(); editor.value.querySelector('input').focus()
}
function closeEditor() { editor.value.close(); showEditor.value = false; previousFocus?.focus() }
async function save() { await perform(async () => { const saved = await api.saveServer({ ...form }); await load(); openOverview(saved); closeEditor() }) }
async function selectKey() { await perform(async () => { const path = await api.selectKey(); if (path) form.privateKeyPath = path }) }
async function checkConnection(server = current.value) {
  if (!server || testing.value) return
  testing.value = true
  try { await perform(() => api.testConnection(server.id)) } finally { testing.value = false }
}
async function scroll() { await nextTick(); if (feed.value) feed.value.scrollTop = feed.value.scrollHeight }
async function send() {
  const text = input.value.trim(); if ((!text && !cp.attachments.length) || !!ownRun.value || busy.value || cp.attaching || cp.saving || !cp.model || !account.value || state.value !== 'ready') return
  const sentAttachments = cp.attachments.map(a => ({...a})); const eventConversation = conversationId.value; runningConversation.value = eventConversation; const session = sessions.value.find(s => s.id === eventConversation); if (session.title === '新对话') session.title = (text || sentAttachments[0]?.name || '附件').slice(0, 40); session.updatedAt = Date.now(); input.value = ''; error.value = ''; running.value = true
  messages.value.push({ id: crypto.randomUUID(), role: 'user', text, attachments: sentAttachments, settings: {...cp.settings}, serverId: sessions.value.find(s => s.id === eventConversation)?.serverId || '', conversationId: eventConversation })
  scroll()
  try { await api.send({ text, serverId: session.serverId || undefined, conversationId: eventConversation, settings: {...cp.settings}, attachments: sentAttachments.map(a => a.id) }); cp.setState(eventConversation, {attachments: []}) } catch (e) { error.value = e.message; running.value = false; session.draft = text; if (conversationId.value === eventConversation) input.value = text; const message = messages.value.findLast(m => m.role === 'user' && m.conversationId === eventConversation); if (message) message.failed = true }
}
function approvalSummary(item){const p=item.params||{},a=p.arguments||{};return a.command||p.command||p.item?.command||JSON.stringify({tool:p.tool,reason:p.reason,changes:p.changes||p.item?.changes},null,2)}
async function approve(item, decision) { await perform(async () => { await api.approve(item.id, decision); approvals.value = approvals.value.filter(a => a.id !== item.id) }) }
function onEvent(event) {
  const p = event.params || {}
  if(event.method==='updates/changed'){updateState.value=p;return}
  if(event.method==='scheduler/changed'){refreshSchedules().catch(e=>error.value=e.message);return}
  if(event.method==='scheduler/openRun'){openRun(p.run);return}
  if (event.method === 'window/state') { windowInfo.value = p; return }
  const eventConversation = event.conversationId || runningConversation.value || conversationId.value
  cp.event(event, eventConversation)
  if (event.method === 'workbench/openPanel') { openTool(p.kind, p.server, p.path); return }
  if (event.method === 'servers/changed') {
    load().catch(e => { error.value = e.message })
    const i = servers.value.findIndex(s => s.id === p.server.id)
    if (i < 0) servers.value.push(p.server); else servers.value[i] = p.server
    const check = p.server.lastConnection
    savedNoticeFailed.value = p.notice ? p.server.lastHardware?.status === 'failed' : check?.status === 'failed'
    savedNotice.value = p.notice ? `${p.server.name} · ${p.notice}` : check ? `${p.server.name} · ${check.message}` : `${p.server.name} 已保存${p.server.configStatus === 'draft' ? ' · 待补全：' + p.server.missingFields.join('、') : ' · 可以测试连接'}`
  }
  if (['item/started', 'item/completed'].includes(event.method) && p.item?.type === 'dynamicToolCall') {
    const title = { servers_open_panel: '打开工具面板', servers_exec: '执行远程命令', servers_list: '查询服务器台账', servers_upsert: '保存服务器配置', servers_bind_private_key: '直接绑定已有私钥', servers_test_connection: '测试 SSH 连接', servers_inspect_hardware: '读取服务器硬件状态', servers_select_private_key: '选择并保存私钥路径' }[p.item.tool] || p.item.tool
    const text = event.method === 'item/started' ? `正在${title}…` : `${title}：${p.item.success === false ? '未完成，请查看后续说明' : '已完成'}`
    const id = `tool-${p.item.id}`, existing = messages.value.find(m => m.id === id)
    if (existing) existing.text = text; else messages.value.push({ id, role: 'tool', text, serverId: sessions.value.find(s => s.id === eventConversation)?.serverId || '', conversationId: eventConversation })
    scroll()
  }
  if (event.method === 'runtime/status') {
    state.value = p.state; detail.value = p.detail
    if (p.state === 'ready') refreshAccount().catch(e => { error.value = e.message })
    else { running.value = false; approvals.value = []; account.value = null; loginPending.value = false }
    if (p.state === 'error') error.value = p.detail || '运行时启动失败，请重试'
  }
  if (event.method === 'account/updated') refreshAccount().catch(e => { error.value = e.message })
  if (event.method === 'account/login/completed') { loginPending.value = false; if (p.success) perform(refreshAccount); else error.value = p.error || '登录未完成，请重试' }
  if (event.method === 'item/agentMessage/delta') {
    let message = messages.value.find(m => m.id === p.itemId)
    if (!message) { message = { id: p.itemId, role: 'assistant', text: '', serverId: sessions.value.find(s => s.id === eventConversation)?.serverId || '', conversationId: eventConversation }; messages.value.push(message); message = messages.value.at(-1) }
    message.text += p.delta; scroll()
  }
  if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
    let message = messages.value.find(m => m.id === p.item.id)
    if (message) message.text = p.item.text
    else messages.value.push({ id: p.item.id, role: 'assistant', text: p.item.text, serverId: sessions.value.find(s => s.id === eventConversation)?.serverId || '', conversationId: eventConversation })
    scroll()
  }
  if (event.method === 'turn/completed') { running.value = false; approvals.value = []; if (p.turn.error) error.value = p.turn.error.message; perform(load) }
  if (event.method === 'error') error.value = p.error?.message || '任务执行失败'
  if (event.method === 'runtime/unsupported') error.value = `当前客户端尚未支持此交互：${p.method}`
  if (event.method === 'runtime/storageError') error.value = `操作记录保存失败：${p.message}`
  if (event.id !== undefined && event.method.endsWith('/requestApproval')) approvals.value.push(event)
  if (event.method === 'serverRequest/resolved') approvals.value = approvals.value.filter(a => a.id !== p.requestId)
}
const visibleMessages = computed(() => messages.value.filter(m => m.conversationId === conversationId.value))
onMounted(() => { if (api) { unsubscribe = api.onEvent(onEvent); perform(async () => { await load(); if (state.value === 'ready') await refreshAccount(); if (state.value === 'error') error.value = detail.value }) } else error.value = '当前是界面预览。请通过 Electron 客户端使用服务器存储和 Codex runtime。' })
onUnmounted(() => { clearTimeout(saveTimer); unsubscribe?.(); window.removeEventListener('resize', measure); window.removeEventListener('beforeunload', saveWorkspace); endDrag(); saveWorkspace() })

function restore() { try { return JSON.parse(localStorage.getItem('servers-workbench') || '{}') } catch { return {} } }
const restored = restore()
const sessions = ref(Array.isArray(restored.sessions) ? restored.sessions : [])
const conversationId = ref(restored.conversationId || ''), runningConversation = ref(''), sessionQuery = ref('')
const copilot = ref(true), sessionList = ref(false), expanded = ref(false), copilotWidth = ref(Number(restored.copilotWidth) || 420), sidebarWidth = ref(Number(restored.sidebarWidth) || 218)
const windowWidth = ref(innerWidth), tabs = ref([]), activeTab = ref(''), nav = ref('servers')
const chat = computed(() => sessions.value.find(s => s.id === conversationId.value))
const attachmentDialog = ref(null)
const cp = reactive(useCopilot(api, sessions, conversationId, state, value => { error.value = value }))
watch(() => cp.preview, async value => { await nextTick(); if (value && !attachmentDialog.value.open) attachmentDialog.value.showModal(); else if (!value) attachmentDialog.value.close() })
watch(()=>cp.state.approvals, value=>{if(value)approvals.value=value},{deep:true})
watch(() => cp.state.activeConversationId, id => { if (id) { running.value = true; runningConversation.value = id } })
async function executePlan(proposal) { await cp.changeSettings({mode: 'default'}); if (cp.settings.mode !== 'default') return; input.value = '请按以下已确认计划执行：\n\n' + proposal; await send() }
const chatServer = computed(() => servers.value.find(s => s.id === chat.value?.serverId))
const filteredSessions = computed(() => sessions.value.filter(s => s.title.toLowerCase().includes(sessionQuery.value.toLowerCase())))
const toolKinds = [{ kind: 'ssh', title: 'SSH 终端', icon: Terminal }, { kind: 'files', title: '文件管理器', icon: FolderOpen }, { kind: 'bandwidth', title: '带宽监控', icon: Network }]
function newChat(serverId = selected.value) { const item = { id: crypto.randomUUID(), serverId: serverId || '', title: '新对话', updatedAt: Date.now(), draft: '' }; sessions.value.unshift(item); switchChat(item.id); copilot.value = true }
function switchChat(id) { if (chat.value) chat.value.draft = input.value; conversationId.value = id; input.value = chat.value?.draft || ''; scroll() }
if (!sessions.value.some(s => s.id === conversationId.value)) newChat('')
else input.value = chat.value?.draft || ''
messages.value = Array.isArray(restored.messages) ? restored.messages : []
function saveWorkspace() { try { if (chat.value) chat.value.draft = input.value; localStorage.setItem('servers-workbench', JSON.stringify({ sessions: sessions.value, messages: messages.value, conversationId: conversationId.value, copilotWidth: copilotWidth.value, sidebarWidth: sidebarWidth.value })) } catch { error.value = '会话显示记录保存失败；请检查本机存储空间。' } }
let saveTimer
watch([sessions, messages, conversationId, input, copilotWidth, sidebarWidth], () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWorkspace, 250) }, { deep: true })
let lastOverview
function reveal(tab) { activeTab.value = tab.id; selected.value = tab.server?.id || ''; page.value = 'workspace'; expanded.value = false; if (windowWidth.value < 980) { copilot.value = false; sidebar.value = false } }
function openOverview(server) { if (!server) return; let tab = tabs.value.find(t => t.kind === 'overview' && t.server.id === server.id); if (!tab) { tab = { id: crypto.randomUUID(), kind: 'overview', server, title: '概览' }; tabs.value.push(tab); lastOverview = { id: tab.id, at: Date.now(), serverId: server.id } }; reveal(tab) }
function openTool(kind, server = current.value, path) { if (kind === 'overview') return openOverview(server); if (!server) return; if (server.configStatus !== 'configured') { error.value = '请先补全服务器连接配置'; return }; let tab = tabs.value.find(t => t.kind === kind && t.server.id === server.id); if (!tab) { tab = { id: crypto.randomUUID(), kind, path, server: JSON.parse(JSON.stringify(server)), title: toolKinds.find(t => t.kind === kind).title }; tabs.value.push(tab) } else if (path) tab.path = path; reveal(tab) }
function openTerminal(server) { if (server.configStatus === 'configured' && lastOverview?.serverId === server.id && Date.now() - lastOverview.at < 1000) closeTab(lastOverview.id); lastOverview = null; openTool('ssh', server) }
function closeTab(id) { const index = tabs.value.findIndex(t => t.id === id); tabs.value = tabs.value.filter(t => t.id !== id); if (activeTab.value === id) { const next = tabs.value[Math.max(0, index - 1)]; activeTab.value = next?.id || ''; selected.value = next?.server?.id || '' } }
function migrationNotice(text) { savedNoticeFailed.value = false; savedNotice.value = text }
function dropPackage(event) { const file = [...(event.dataTransfer?.files || [])].find(f => f.name.toLowerCase().endsWith('.servers')); if (file) { event.preventDefault(); migration.value.openImport(file) } }
function useServerPrompt(prompt) { const server = current.value || chatServer.value; if (!server) { error.value = '请先在左侧选择要检查的服务器'; return }; ask({serverId:server.id,text:prompt.text}) }
function ask(value) { if (chat.value?.serverId !== value.serverId) newChat(value.serverId); copilot.value = true; input.value = value.text }
function selectNav(value) { nav.value = value; sidebar.value = windowWidth.value >= 980 || value === 'servers'; if (windowWidth.value < 980 && ['history', 'settings'].includes(value)) copilot.value = false; if (value === 'history' || value === 'settings') { page.value = value; perform(load) } else page.value = 'workspace' }
function measure() { windowWidth.value = innerWidth }
window.addEventListener('resize', measure)
window.addEventListener('beforeunload', saveWorkspace)
let drag
function beginDrag(event, target) { event.preventDefault(); drag = { target, x: event.clientX, width: target === 'copilot' ? copilotWidth.value : sidebarWidth.value }; window.addEventListener('pointermove', moveDrag); window.addEventListener('pointerup', endDrag); document.body.classList.add('resizing') }
function changeWidth(target, value) { if (target === 'copilot') copilotWidth.value = Math.max(330, Math.min(value, innerWidth * .65)); else sidebarWidth.value = Math.max(180, Math.min(330, value)) }
function moveDrag(event) { if (drag) changeWidth(drag.target, drag.width + (event.clientX - drag.x) * (drag.target === 'copilot' ? -1 : 1)) }
function endDrag() { drag = null; window.removeEventListener('pointermove', moveDrag); window.removeEventListener('pointerup', endDrag); document.body.classList.remove('resizing') }
function keyResize(event, target) { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); changeWidth(target, (target === 'copilot' ? copilotWidth.value : sidebarWidth.value) + (event.key === 'ArrowRight' ? 20 : -20) * (target === 'copilot' ? -1 : 1)) } }
</script>

<template>
<div @dragover.prevent @drop="dropPackage" class="desktop-shell" :class="{ 'copilot-expanded': expanded, 'copilot-open': copilot, 'window-inactive': !windowInfo.focused, 'window-maximized': windowInfo.maximized }" :style="{ '--sidebar-width': sidebarWidth + 'px', '--copilot-width': copilotWidth + 'px' }">
  <header class="app-header"><div class="brand"><img class="brand-logo" :src="logo" alt="ServerLoom Logo" draggable="false" /><strong>SERVERLOOM</strong><span class="version">WORKSPACE</span></div><div class="header-caption">服务器运维工作空间</div><div class="header-actions"><button aria-label="切换侧边栏" :aria-pressed="sidebar" @click="sidebar = !sidebar"><PanelLeft :size="17" /></button><button aria-label="切换 Copilot 面板" :aria-pressed="copilot" @click="copilot = !copilot; expanded = false"><PanelRight :size="17" /></button><span class="runtime-indicator"><span class="status-dot" :class="state" />{{ statusText }}</span></div><div class="window-controls" role="group" aria-label="窗口控制"><button aria-label="最小化窗口" title="最小化" @click="controlWindow('minimize')"><Minus :size="15" /></button><button :aria-label="windowInfo.maximized || windowInfo.fullscreen ? '还原窗口' : '最大化窗口'" :title="windowInfo.maximized || windowInfo.fullscreen ? '还原窗口' : '最大化'" @click="controlWindow('toggleMaximize')"><Copy v-if="windowInfo.maximized || windowInfo.fullscreen" :size="13" /><Square v-else :size="12" /></button><button class="window-close" aria-label="关闭窗口" title="关闭" @click="controlWindow('close')"><X :size="16" /></button></div></header>
  <div class="desktop-body">
    <nav class="activity-rail" aria-label="主导航"><button :class="{ active: nav === 'servers' }" aria-label="运维工作台" @click="selectNav('servers')"><Server :size="21" /><span>服务器</span></button><button :class="{ active: nav === 'history' }" aria-label="操作记录" @click="selectNav('history')"><History :size="21" /><span>记录</span></button><button :class="{active:nav==='scheduler'}" aria-label="定时任务" @click="selectNav('scheduler')"><Clock :size="21"/><span>Scheduler</span></button><div class="rail-spacer" /><button aria-label="打开 Copilot" :class="{ active: copilot }" @click="copilot = !copilot; expanded = false"><MessageSquare :size="21" /><span>Copilot</span></button><button aria-label="运行时设置" :class="{ active: nav === 'settings' }" @click="selectNav('settings')"><Settings2 :size="21" /><span>设置</span></button></nav>
    <aside v-show="sidebar && !expanded" class="asset-panel">
      <div class="panel-heading"><strong>{{ { scheduler:'Scheduler', servers: '服务器', tools: '工具', history: '操作记录', settings: '运行时' }[nav] }}</strong><button aria-label="收起功能侧栏" @click="sidebar = false"><PanelLeft :size="15" /></button></div>
      <ServerSidebar v-if="nav === 'servers'" :servers="servers" :groups="groups" :selected="selected" @select="openOverview" @terminal="openTerminal" @open="openTool" @edit="openEditor" @chat="server => newChat(server.id)" @migrate="ids => migration.openExport(ids)" @import="migration.openImport()" @changed="perform(load)" @error="error = $event" />
      <template v-else-if="nav==='scheduler'"><button class="panel-item" @click="openSchedule()"><Plus :size="16"/>新建任务</button><button class="panel-item" @click="perform(()=>api.pauseScheduler(!scheduleState.paused))">{{scheduleState.paused?'恢复调度':'暂停调度'}}</button><p v-if="!scheduleState.tasks.length" class="tool-caption">暂无任务。创建定时巡检，或让 Copilot 帮你安排。</p><button v-for="task in scheduleState.tasks" :key="task.id" class="panel-item" @click="openSchedule(task.id)"><Clock :size="14"/><span>{{task.name}}<small style="display:block;color:#94a4b8">{{task.enabled?'已启用':'已暂停'}}</small></span></button></template><template v-else-if="nav === 'history'"><p class="tool-caption">最近 {{ history.length }} 条本地操作记录</p><button class="panel-item" @click="perform(load)"><RefreshCw :size="16" />刷新记录</button></template>
      <template v-else><p class="tool-caption">Codex {{ statusText }}</p><p class="tool-caption">{{ account?.email || '尚未登录' }}</p><p class="tool-caption">内置运行时随客户端启动。</p></template>
    </aside>
    <div v-if="sidebar && !expanded" class="splitter asset-splitter" role="separator" aria-label="调整功能侧栏宽度" aria-orientation="vertical" :aria-valuenow="sidebarWidth" tabindex="0" @pointerdown="beginDrag($event, 'sidebar')" @keydown="keyResize($event, 'sidebar')" />
    <main class="center-workspace" v-show="!expanded">
      <div class="tab-strip" role="tablist" aria-label="工具标签页"><div v-for="tab in tabs" :key="tab.id" class="tab-item" :class="{ active: activeTab === tab.id && page === 'workspace' }"><button role="tab" :aria-selected="activeTab === tab.id && page === 'workspace'" @click="reveal(tab)">{{ tab.title }}{{ tab.server ? ' · '+tab.server.name : '' }}</button><button :aria-label="'关闭 ' + tab.title + (tab.server ? ' · '+tab.server.name : '')" @click="closeTab(tab.id)"><X :size="13" /></button></div></div>
      <div v-show="page === 'workspace'" class="workspace-stack"><section v-show="!activeTab" class="workspace-home"><div class="eyebrow">SERVER WORKSPACE</div><h1>选择服务器，开始工作。</h1><p>单击打开概览，双击进入 SSH；右键直接打开文件和监控。</p><div class="home-secondary"><button @click="openEditor()">添加服务器</button><button @click="migration.openImport()">导入连接包</button></div></section>
      <template v-for="tab in tabs" :key="tab.id"><SchedulerPane v-if="tab.kind === 'schedule'" v-show="activeTab === tab.id" :task-id="tab.taskId" :snapshot="scheduleState" :servers="servers" :sessions="sessions" :models="cp.models" @changed="refreshSchedules" @open="openSchedule" @conversation="openRun"/><ServerOverview v-else-if="tab.kind === 'overview'" v-show="activeTab === tab.id" :server="servers.find(s => s.id === tab.server.id) || tab.server" :testing="testing" @open="openTool" @edit="openEditor" @test="checkConnection" @chat="server => newChat(server.id)" @migrate="server => migration.openExport([server.id])" /><TerminalPane v-else-if="tab.kind === 'ssh'" v-show="activeTab === tab.id" :server="tab.server" :active="page === 'workspace' && activeTab === tab.id && !expanded && (windowWidth >= 980 || !copilot)" /><FilesPane v-else-if="tab.kind === 'files'" v-show="activeTab === tab.id" :server="tab.server" :initial-path="tab.path" @ask="ask" /><BandwidthPane v-else v-show="activeTab === tab.id" :server="tab.server" :active="page === 'workspace' && activeTab === tab.id && !expanded && (windowWidth >= 980 || !copilot)" @ask="ask" /></template></div>
      <section v-if="page === 'settings'" class="settings-page">
        <div class="eyebrow">ENGINE / LOCAL RUNTIME</div><h1>运行时设置</h1><p>打开客户端时自动启动 Codex 并读取已有登录状态，关闭窗口后保留托盘运行；选择“退出 ServerLoom”才会停止。</p>
        <UpdateSettings :state="updateState" @action="updateAction"/>
        <div class="setting-row"><div><h3>后台与启动</h3><p>关闭窗口收起到托盘。定时任务需要电脑开机且应用运行。</p><label><input type="checkbox" v-model="desktop.loginStartup" @change="saveDesktop"/>登录 Windows 后启动</label><label><input type="checkbox" v-model="desktop.startHidden" @change="saveDesktop"/>登录启动时隐藏窗口</label></div><button @click="perform(()=>api.quit())">退出 ServerLoom</button></div><div class="setting-row"><div><h3>Codex runtime</h3><p>内置 codex-rs · 本地 stdio 通信</p></div><div class="setting-actions"><span class="runtime-indicator"><span class="status-dot" :class="state" />{{ statusText }}</span><button v-if="state === 'ready'" :disabled="busy" @click="stop">停止运行时</button><button v-else class="primary" :disabled="!api || busy" @click="start">{{ busy ? '启动中…' : '启动运行时' }}</button></div></div>
        <p v-if="detail" class="runtime-detail">{{ detail }}</p>
        <div class="setting-row"><div><h3>ChatGPT 账号</h3><p>{{ account ? (account.email || '已登录') : loginPending ? '请在浏览器完成登录，随后回到这里。' : '使用 Codex 的登录流程连接账号。' }}</p></div><div class="setting-actions"><button class="icon-button" aria-label="刷新登录状态" :disabled="state !== 'ready' || busy" @click="perform(refreshAccount)"><RefreshCw :size="16" /></button><button :disabled="state !== 'ready' || busy || loginPending" @click="login">{{ account ? '重新登录' : loginPending ? '等待登录…' : '登录 ChatGPT' }}</button></div></div>
        <div class="setting-row"><div><h3>SSH 连接</h3><p>支持通用 SSH 命令执行：查询端口、进程、服务和日志，按任务执行配置操作并记录历史。窗口隐藏后连接保持；退出应用时关闭连接。</p></div><span class="tag">通用远程执行</span></div>
        <div class="setting-row"><div><h3>操作策略</h3><p>本机只读沙箱；运行时请求的命令与文件变更需在客户端审批。</p></div><ShieldCheck :size="20" /></div>
      </section>
      <section v-else-if="page === 'history'" class="history-page"><div class="eyebrow">ACTIVITY / AUDIT TRAIL</div><h1>操作记录</h1><p>最近 500 条任务、服务器配置、状态采集与审批记录。</p><div v-if="!history.length" class="history-empty"><History :size="32" /><h3>还没有操作记录</h3><p>添加服务器或发起任务后，记录会显示在这里。</p></div><div v-for="entry in history" :key="entry.id" class="history-row"><span class="history-kind">{{ { server: '资产', task: '任务', turn: '结果', approval: '审批', command: '命令', connection: '连接', hardware: '硬件' }[entry.kind] }}</span><div><strong>{{ entry.title }}</strong><p>{{ entry.detail }}</p></div><time>{{ new Date(entry.at).toLocaleString('zh-CN') }}</time></div></section>

    </main>
    <div v-if="copilot && !expanded" class="splitter copilot-splitter" role="separator" aria-label="调整 Copilot 宽度" aria-orientation="vertical" :aria-valuenow="copilotWidth" tabindex="0" @pointerdown="beginDrag($event, 'copilot')" @keydown="keyResize($event, 'copilot')" />
    <aside v-show="copilot" class="copilot-panel" :class="{ 'with-sessions': sessionList }" aria-label="Copilot 独立面板">
      <div class="copilot-chat"><div class="panel-heading"><MessageSquare :size="16" /><strong>Copilot</strong><div class="panel-actions"><button aria-label="新建对话" @click="newChat()"><Plus :size="16" /></button><button aria-label="切换会话列表" :aria-pressed="sessionList" @click="sessionList = !sessionList"><List :size="16" /></button><button :aria-label="expanded ? '还原 Copilot' : '展开 Copilot'" @click="expanded = !expanded"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /></button><button aria-label="收起 Copilot" @click="copilot = false; expanded = false"><X :size="16" /></button></div></div>
      <div class="chat-context"><span>{{ chatServer?.name || '全局工作区' }}</span><code>{{ chatServer?.host || '跨服务器规划' }}</code><span v-if="running && runningConversation !== conversationId">其他会话执行中</span></div>
      <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button aria-label="关闭错误提示" @click="error = ''"><X :size="15" /></button></div><div v-if="savedNotice" class="save-banner" :class="{ failed: savedNoticeFailed }" role="status"><span>{{ savedNotice }}</span><button aria-label="关闭保存提示" @click="savedNotice = ''"><X :size="15" /></button></div>
      <div class="conversation" ref="feed" aria-live="polite" aria-label="运维对话"><div v-if="!visibleMessages.length" class="chat-welcome"><div class="eyebrow">COPILOT / OPERATIONS</div><h2>{{ chatServer ? '开始管理 ' + chatServer.name : '一起处理服务器上的工作。' }}</h2><p>描述目标，Copilot 会执行命令、检查结果并继续排查。</p><div class="chat-prompts"><button v-for="prompt in prompts" :key="prompt.title" @click="useServerPrompt(prompt)"><component :is="prompt.icon" :size="16" />{{ prompt.title }}<ArrowRight :size="14" /></button></div></div><div v-else class="messages"><article v-for="message in visibleMessages" :key="message.id" :class="message.role"><div class="message-author"><Terminal v-if="message.role !== 'user'" :size="15" />{{ message.role === 'user' ? '你' : message.role === 'tool' ? '客户端工具' : 'Codex' }}</div><MarkdownMessage v-if="message.role === 'assistant'" :source="message.text" /><div v-else class="message-text">{{ message.text }}</div><div v-if="message.attachments?.length" class="message-attachments"><button v-for="file in message.attachments" :key="file.id" @click="cp.view(file, message.conversationId)">{{ file.name }}</button></div><small v-if="message.failed" class="form-error">发送未成功，草稿及附件已保留</small></article></div><div v-if="ownRun" class="working"><span class="status-dot starting" />{{ ownRun?.status==='queued'?'等待前面的任务完成…':approvals.length ? '等待操作审批' : 'Codex 正在处理…' }}</div></div>
      <div class="composer-area"><TaskState :state="cp.state" :running="running" :conversation-id="conversationId" @execute="executePlan" @answer="cp.answer"/><div v-for="approval in approvals" :key="approval.id" class="approval"><strong>需要批准此操作</strong><p v-if="approval.params.arguments?.id">{{servers.find(s=>s.id===approval.params.arguments.id)?.name||approval.params.arguments.id}} · {{approval.params.arguments.purpose||approval.params.tool}}</p><pre>{{ approvalSummary(approval) }}</pre><div><button @click="approve(approval, 'decline')">拒绝</button><button @click="approve(approval, 'accept')">批准本次</button></div></div><div v-if="state !== 'ready' || !account" class="connect-hint"><span>{{ state === 'starting' ? '正在启动 Codex…' : state !== 'ready' ? 'Codex 已停止' : '登录后开始对话' }}</span><button v-if="state !== 'ready' && state !== 'starting'" :disabled="busy" @click="start">启动</button><button v-else-if="state === 'ready' && !account" :disabled="busy || loginPending" @click="login">登录 ChatGPT</button></div><form class="composer" @submit.prevent="send" @dragover.prevent @drop.stop="cp.drop" @paste="cp.paste"><div v-if="cp.attachments.length" class="attachment-chips"><div v-for="file in cp.attachments" :key="file.id"><button type="button" :title="file.name" @click="cp.view(file)">{{ file.name }}</button><button type="button" :disabled="running" :aria-label="'移除附件 ' + file.name" @click="cp.remove(file.id)"><X :size="12"/></button></div></div><textarea v-model="input" aria-label="发送给 Codex 的任务" placeholder="描述你想完成的运维工作…" rows="3" maxlength="30000" @keydown.enter.exact.prevent="send" /><div class="composer-footer"><ComposerOptions :settings="cp.settings" :models="cp.models" :modes="cp.modes" :loading="cp.loading" :saving="cp.saving" :attaching="cp.attaching" :error="cp.catalogError" @settings="cp.changeSettings" @refresh="cp.catalog(true)" @attach="cp.add()"/><button v-if="ownRun" type="button" class="stop-button" @click="perform(() => api.cancelRun(ownRun.id))"><Square :size="13" />{{ownRun.status==='queued'?'取消排队':'停止任务'}}</button><button v-else type="submit" class="send-button" aria-label="发送任务" :disabled="!api || (!input.trim() && !cp.attachments.length) || state !== 'ready' || !account || busy || cp.attaching || cp.saving || !cp.model"><ArrowUp :size="18" /></button></div></form><div class="composer-note"><span>{{ cp.loading ? '正在获取模型…' : cp.catalogError ? '模型列表加载失败，点击模型图标重试' : 'Enter 发送 · Shift + Enter 换行' }}</span><span>{{ account ? '已登录' : '等待登录' }}</span></div></div>
      </div><aside v-show="sessionList" class="session-panel" aria-label="会话列表"><div class="panel-heading"><strong>会话</strong><button aria-label="收起会话列表" @click="sessionList = false"><PanelRight :size="15" /></button></div><button class="panel-item" @click="newChat()"><Plus :size="16" />新对话</button><label class="search"><Search :size="14" /><input v-model="sessionQuery" placeholder="搜索会话" aria-label="搜索会话" /></label><div class="session-items"><button v-for="session in filteredSessions" :key="session.id" class="session-row" :class="{ active: session.id === conversationId }" @click="switchChat(session.id)"><strong>{{ session.title }}</strong><span>{{ servers.find(s => s.id === session.serverId)?.name || '全局工作区' }}</span><small>{{ new Date(session.updatedAt).toLocaleDateString('zh-CN') }}{{ running && runningConversation === session.id ? ' · 执行中' : '' }}</small></button></div></aside>
    </aside>
  </div>
  <div v-if="error && !copilot" class="global-error" role="alert">{{ error }}<button @click="error = ''">关闭</button></div>
  <div v-if="savedNotice && !copilot" class="global-notice" role="status">{{ savedNotice }}<button aria-label="关闭保存提示" @click="savedNotice = ''">关闭</button></div>
  <footer class="statusbar"><span><span class="status-dot" :class="state" />{{ state === 'ready' ? 'Runtime ready' : statusText }}</span><span>{{ servers.length }} 台服务器<span class="divider" />{{ tabs.length }} 个标签页<span class="divider" />v{{ updateState.version }}</span><button style="font-size:11px" @click="selectNav('scheduler')">{{scheduleState.paused?'调度已暂停':scheduleState.current?'任务执行中':'Scheduler 就绪'}}</button><button class="update-status" :class="{highlight:['available','ready','waiting'].includes(updateState.phase)}" :title="updateLabel" aria-label="软件更新" @click="showUpdates()"><Download :size="14"/><span>{{updateLabel}}</span></button><QuotaStatus :value="cp.limits" :error="cp.limitsError" :updated="cp.limitsAt" :loading="cp.limitsLoading" :plan="account?.planType" @refresh="cp.refreshLimits"/></footer>
    <dialog ref="editor" @cancel.prevent="closeEditor">
      <form @submit.prevent="save">
        <div class="dialog-header"><h2>{{ form.id ? '编辑服务器' : '添加服务器' }}</h2><button type="button" aria-label="关闭服务器表单" @click="closeEditor"><X :size="18" /></button></div>
        <p>名称和地址即可保存草稿，其余信息可稍后让 Agent 补全。保存不会自动连接。</p>
        <label>服务器名称<input v-model="form.name" required maxlength="80" placeholder="例如：香港生产节点" /></label>
        <label>主机地址<input v-model="form.host" required maxlength="253" placeholder="IP 地址或域名" /></label>
        <div class="form-columns"><label>SSH 用户<input v-model="form.user" maxlength="64" placeholder="待补全" /></label><label>端口<input v-model.number="form.port" type="number" min="1" max="65535" required /></label></div>
        <label>认证方式<select v-model="form.authType" aria-label="认证方式"><option value="unspecified">待补全</option><option value="privateKey">私钥文件</option><option value="sshAgent">SSH Agent</option></select></label>
        <div v-if="form.authType === 'privateKey'" class="key-field"><label>私钥文件路径<input v-model="form.privateKeyPath" placeholder="粘贴已有私钥完整路径，或选择文件" /></label><button type="button" :disabled="busy" @click="selectKey">选择私钥文件</button><small>Agent 已知路径时会直接绑定，无需重复选择。不向模型发送私钥内容。</small></div>
        <label>分组<select v-model="form.groupId" aria-label="分组"><option value="">未分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
        <label>用途与备注<textarea v-model="form.notes" rows="3" maxlength="2000" placeholder="运行的项目、环境与注意事项。请勿填写密码。" /></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions"><button type="button" @click="closeEditor">取消</button><button type="submit" class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存服务器' }}</button></div>
      </form>
    </dialog>

<dialog ref="attachmentDialog" class="attachment-preview" aria-label="附件预览" @cancel.prevent="cp.preview=null"><template v-if="cp.preview"><div class="dialog-header"><h2>{{ cp.preview.name }}</h2><button aria-label="关闭附件预览" @click="cp.preview=null"><X :size="18"/></button></div><img v-if="cp.preview.kind==='image'" :src="cp.preview.url" :alt="cp.preview.name"/><pre v-else>{{ cp.preview.text }}</pre><small v-if="cp.preview.truncated">预览前 64 KiB</small></template></dialog>
<MigrationDialog ref="migration" :servers="servers" @changed="perform(load)" @notice="migrationNotice" />
</div>
</template>
