<script setup>
import { ref, onBeforeUnmount, watch } from 'vue'
import { parseNetwork, networkRates } from '../lib/bandwidth.mjs'
const props = defineProps({ server: Object, active: Boolean })
const emit = defineEmits(['ask'])
const rates = ref([]), error = ref(''), busy = ref(false), paused = ref(false), samples = ref([]), nic = ref(''), checked = ref('')
let previous, timer, disposed = false
const format = value => value >= 1048576 ? (value / 1048576).toFixed(2) + ' MiB/s' : (value / 1024).toFixed(2) + ' KiB/s'
async function sample() {
  if (busy.value || disposed || !props.active || paused.value || document.hidden) return
  busy.value = true
  try { const result = await window.servers.bandwidth(props.server.id); if (result.status !== 'completed') throw new Error(result.message || result.stderr); const current = parseNetwork(result.stdout); rates.value = networkRates(previous, current); previous = current; if (!nic.value) nic.value = rates.value.find(r => r.name !== 'lo')?.name || rates.value[0]?.name || ''; const row = rates.value.find(r => r.name === nic.value); if (row) samples.value = [...samples.value.slice(-39), row]; checked.value = new Date(result.checkedAt).toLocaleTimeString('zh-CN'); error.value = '' } catch (e) { error.value = e.message } finally { busy.value = false; if (!disposed && props.active && !paused.value) timer = setTimeout(sample, 3000) }
}
function restart() { clearTimeout(timer); previous = null; sample() }
function visibility() { if (!document.hidden) restart() }
document.addEventListener('visibilitychange', visibility)
watch([() => props.active, paused], restart, { immediate: true })
watch(nic, () => { samples.value = [] })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) })
function points(field) { const max = Math.max(1024, ...samples.value.flatMap(s => [s.rx, s.tx])); return samples.value.map((s, i) => `${i * 600 / 39},${160 - s[field] / max * 140}`).join(' ') }
</script>
<template><section class="tool-pane bandwidth-pane"><div class="tool-toolbar"><strong>{{ server.name }} / 网卡流量</strong><span class="tool-status">{{ paused ? '已暂停' : busy ? '采集中' : '每 3 秒采样' }}</span><button @click="paused = !paused">{{ paused ? '继续采样' : '暂停采样' }}</button></div><p v-if="error" class="pane-error" role="alert">{{ error }}<button @click="restart">重试</button></p><div class="bandwidth-body"><div class="chart-heading"><label>网卡 <select v-model="nic"><option v-for="row in rates" :key="row.name">{{ row.name }}</option></select></label><span>接收 / 发送 · {{ checked || '等待首轮采样' }}</span></div><svg class="traffic-chart" viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label="网卡接收与发送速率趋势"><path d="M0 160H600 M0 90H600 M0 20H600" class="chart-grid" /><polyline :points="points('rx')" class="chart-rx" /><polyline :points="points('tx')" class="chart-tx" /></svg><p class="chart-legend"><span>接收</span><span>发送</span>最近 40 次采样 · 自动纵轴</p><p v-if="!rates.length" class="list-empty">{{ error ? '采样失败，请重试。' : '需要两次采样计算速率…' }}</p><table><thead><tr><th>网卡</th><th>接收</th><th>发送</th></tr></thead><tbody><tr v-for="row in rates" :key="row.name"><td>{{ row.name }}</td><td>{{ format(row.rx) }}</td><td>{{ format(row.tx) }}</td></tr></tbody></table><p class="tool-caption">按服务器网卡计数器差值计算。虚拟网卡可能重复计数；这不是链路最大带宽测速。隐藏此 Tab 时暂停采样。</p><button @click="emit('ask', { serverId: server.id, text: `检查 ${server.name} 当前网络流量并分析异常，只读排查。` })">让 Copilot 分析网络</button></div></section></template>
