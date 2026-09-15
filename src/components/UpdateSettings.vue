<script setup>
import { computed } from 'vue'
import MarkdownMessage from './MarkdownMessage.vue'
const props = defineProps({ state: { type: Object, required: true } })
const emit = defineEmits(['action'])
const locked = computed(() => ['checking','downloading','ready','waiting','installing'].includes(props.state.phase))
const checking = computed(() => ['checking','downloading','waiting','installing','ready'].includes(props.state.phase))
function settings(key, value) { emit('action','updateSettings',{channel:props.state.channel,autoCheck:props.state.autoCheck,[key]:value}) }
</script>
<template>
  <section id="software-updates" class="update-settings" aria-labelledby="update-heading">
    <div class="update-heading"><div><h3 id="update-heading">关于与更新</h3><p>ServerLoom {{state.version}} · {{state.installed?'安装版':'便携版 / 开发环境'}}</p></div><button :disabled="checking" @click="emit('action','checkUpdate')">{{state.phase==='checking'?'正在检查…':'检查更新'}}</button></div>
    <div class="update-preferences"><label>更新通道<select aria-label="更新通道" :value="state.channel" :disabled="locked" @change="settings('channel',$event.target.value)"><option value="stable">Stable · 稳定版</option><option value="alpha">Alpha · 预览版</option></select></label><label class="update-check"><input type="checkbox" :checked="state.autoCheck" :disabled="locked" @change="settings('autoCheck',$event.target.checked)"/>自动检查更新</label></div>
    <p>预览版包含尚在验证的功能。切回稳定通道后等待更高版本，不会自动降级。</p>
    <p v-if="!state.installed">便携版可查看新版本并下载；安装一次安装版后，即可在软件内升级。</p>
    <div class="update-result" role="status" aria-live="polite">
      <p v-if="state.phase==='current'">当前通道暂无更新。</p>
      <p v-if="state.error" class="update-error">{{state.error}}</p>
      <template v-if="state.available"><strong>新版本 {{state.available.version}}</strong><details><summary>查看更新日志</summary><MarkdownMessage :source="state.available.notes || '此版本未提供更新说明。'"/></details></template>
      <div v-if="state.phase==='downloading'"><p>正在下载并校验 {{state.progress}}%</p><progress :value="state.progress" max="100" aria-label="更新下载进度"/></div>
      <p v-if="state.phase==='ready'">更新已下载。重启前会等待任务和文件操作完成。</p>
      <p v-if="state.phase==='waiting'">等待当前工作完成：{{state.blockers?.tasks||0}} 个执行任务，{{state.blockers?.operations||0}} 个操作。新任务已暂停；等待审批的任务仍需你处理。</p>
      <p v-if="state.phase==='installing'">正在准备安装并重启…</p>
    </div>
    <div class="update-actions">
      <button v-if="state.installed && state.available && ['available','error'].includes(state.phase)" class="primary" @click="emit('action','downloadUpdate')">{{state.phase==='error'?'重试下载':'下载更新'}}</button>
      <button v-if="state.phase==='ready'" class="primary" @click="emit('action','installUpdate')">重启并更新</button>
      <button v-if="state.phase==='waiting'" @click="emit('action','cancelUpdate')">取消等待</button>
      <button @click="emit('action','openRelease')">{{state.installed?'打开版本下载页':'下载安装包'}}</button>
    </div>
    <p v-if="state.checkedAt">上次检查：{{new Date(state.checkedAt).toLocaleString()}}</p>
  </section>
</template>
<style scoped>
.update-settings{padding:28px 0;border-bottom:1px solid var(--line);min-width:0;scroll-margin-top:20px}.update-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.update-heading button{flex-shrink:0}.update-settings p{font-size:12px;line-height:1.8;margin-top:8px;color:var(--muted)}.update-preferences{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:18px}.update-preferences label{display:flex;gap:8px;align-items:center;font-size:12px}.update-preferences select{max-width:100%;padding:7px}.update-check input{accent-color:var(--accent)}.update-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.update-result{margin-top:12px;overflow-wrap:anywhere}.update-result strong{font-size:13px}.update-result summary{cursor:pointer;font-size:12px;padding:10px 0;min-height:28px}.update-error{color:var(--danger)!important}progress{width:100%;height:6px;accent-color:var(--accent)}details{max-height:280px;overflow:auto}
</style>
