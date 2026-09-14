<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
const props = defineProps({ server: Object, active: Boolean })
const host = ref(null), status = ref('未连接'), error = ref(''), connecting = ref(false)
let terminal, fit, observer, id, unsubscribe, disposed = false, pending = [], generation = 0
function event(e) {
  if (e.method !== 'workbench/event') return
  const p = e.params
  if (!id && connecting.value) { if (pending.length < 500) pending.push(p); return }
  if (p.id !== id) return
  if (p.type === 'data') terminal.write(p.data)
  if (p.type === 'closed') { status.value = '已断开'; id = null }
  if (p.type === 'error') error.value = p.message
}
function resize() { if (!props.active || !terminal || !host.value?.clientWidth) return; fit.fit(); if (id) window.servers.terminalResize(id, terminal.cols, terminal.rows).catch(e => { error.value = e.message }) }
async function connect() {
  if (connecting.value) return
  const attempt = ++generation
  connecting.value = true; status.value = '正在连接'; error.value = ''; pending = []
  try {
    if (id) await window.servers.closeTool(id)
    id = null
    resize()
    const result = await window.servers.openTool({ serverId: props.server.id, kind: 'ssh', cols: terminal.cols, rows: terminal.rows })
    if (disposed || attempt !== generation) { await window.servers.closeTool(result.id); return }
    id = result.id; status.value = '已连接'; for (const p of pending) event({ method: 'workbench/event', params: p }); pending = []
    resize(); if (props.active) terminal.focus()
  } catch (e) { status.value = '连接失败'; error.value = e.message } finally { connecting.value = false }
}
async function disconnect() { generation++; if (id) await window.servers.closeTool(id); id = null; status.value = '已断开' }
onMounted(() => {
  terminal = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, scrollback: 3000, theme: { background: '#0D1118', foreground: '#C9D1D9', cursor: '#49CDDD', selectionBackground: '#243943' } })
  fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.value)
  terminal.onData(data => { if (id) window.servers.terminalInput(id, data).catch(e => { error.value = e.message }) })
  unsubscribe = window.servers.onEvent(event); observer = new ResizeObserver(resize); observer.observe(host.value)
  connect()
})
watch(() => props.active, () => nextTick(resize))
onBeforeUnmount(() => { disposed = true; generation++; observer?.disconnect(); unsubscribe?.(); if (id) window.servers.closeTool(id).catch(() => {}); terminal?.dispose() })
</script>
<template><section class="tool-pane"><div class="tool-toolbar"><code>{{ server.user }}@{{ server.host }}</code><span class="tool-status">{{ status }}</span><button :disabled="connecting" @click="connect">重新连接</button><button :disabled="status !== '已连接'" @click="disconnect">断开</button></div><p v-if="error" class="pane-error" role="alert">{{ error }}</p><div class="terminal-host" ref="host" aria-label="SSH 交互终端" /></section></template>
