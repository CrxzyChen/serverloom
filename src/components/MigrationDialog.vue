<script setup>
import { ref, nextTick } from 'vue'
import { X, LockKeyhole } from 'lucide-vue-next'
const props = defineProps({ servers: Array })
const emit = defineEmits(['changed', 'notice'])
const dialog = ref(null), mode = ref('export'), ids = ref([]), passphrase = ref(''), repeat = ref(''), includeKeys = ref(false), includeNotes = ref(false), busy = ref(false), error = ref(''), staged = ref(null), rows = ref(null), choices = ref([]), trust = ref(false)
let previousFocus
function reset() { passphrase.value = ''; repeat.value = ''; includeKeys.value = false; includeNotes.value = false; error.value = ''; rows.value = null; choices.value = []; trust.value = false }
function show() { previousFocus = document.activeElement; dialog.value.showModal(); nextTick(() => dialog.value.querySelector('input')?.focus()) }
function openExport(selectedIds) { reset(); ids.value = selectedIds; mode.value = 'export'; show() }
async function openImport(file) { if (busy.value || dialog.value.open) return; reset(); mode.value = 'import'; show(); busy.value = true; try { staged.value = await window.servers.selectMigration(file); if (!staged.value) { busy.value = false; close() } } catch (e) { error.value = e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') } finally { busy.value = false } }
function close() { if (busy.value) return; if (staged.value) window.servers.discardMigration(staged.value.token); staged.value = null; reset(); dialog.value.close(); previousFocus?.focus() }
async function run() {
  busy.value = true; error.value = ''
  try {
    if (mode.value === 'export') {
      if (passphrase.value !== repeat.value) throw new Error('两次口令不一致')
      const result = await window.servers.exportMigration({ ids: [...ids.value], passphrase: passphrase.value, includeKeys: includeKeys.value, includeNotes: includeNotes.value })
      passphrase.value = ''; repeat.value = ''
      if (result.saved) { emit('notice', '加密连接包已保存：' + result.path); busy.value = false; close() }
    } else if (!rows.value) {
      const result = await window.servers.previewMigration({ token: staged.value.token, passphrase: passphrase.value }); passphrase.value = ''; rows.value = result.rows; choices.value = result.rows.map(row => row.duplicate || row.revoked ? 'skip' : 'add')
    } else {
      const result = await window.servers.commitMigration({ token: staged.value.token, choices: [...choices.value], trustHosts: trust.value }); staged.value = null; emit('changed'); emit('notice', `已导入 ${result.imported} 台服务器，选择服务器即可打开或测试连接`); busy.value = false; close()
    }
  } catch (e) { error.value = e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); if (mode.value === 'import') passphrase.value = '' } finally { busy.value = false }
}
defineExpose({ openExport, openImport })
</script>
<template><dialog ref="dialog" class="migration-dialog" @cancel.prevent="close"><form @submit.prevent="run"><div class="dialog-header"><h2>{{ mode === 'export' ? '迁移到我的设备' : rows ? '预览连接包' : '导入连接包' }}</h2><button type="button" :disabled="busy" aria-label="关闭迁移对话框" @click="close"><X :size="18" /></button></div><template v-if="mode === 'export'"><p>将 {{ ids.length }} 台服务器放入加密连接包，在另一台电脑导入。口令只用于本次连接包。</p><div class="migration-targets"><span v-for="id in ids" :key="id">{{ servers.find(s => s.id === id)?.name }}</span></div><label class="check-label"><input type="checkbox" v-model="includeKeys" />包含私钥（用于自己的另一台设备）</label><small>选择后私钥在本机加密，不经过模型。SSH Agent 中的密钥无法导出。</small><label class="check-label"><input type="checkbox" v-model="includeNotes" />包含用途与备注</label><label>加密口令<input v-model="passphrase" type="password" required minlength="10" maxlength="256" autocomplete="new-password" /></label><label>确认口令<input v-model="repeat" type="password" required minlength="10" maxlength="256" autocomplete="new-password" /></label></template><template v-else-if="!rows"><p>{{ staged?.name || '请选择 .servers 加密连接包' }}</p><label>连接包口令<input v-model="passphrase" type="password" required minlength="10" maxlength="256" autocomplete="off" /></label><p>也可将 .servers 文件拖入工作区。解密后先预览，不立即写入配置。</p></template><template v-else><p>核对服务器、认证与主机指纹。重复连接默认跳过；更新会保留该连接的 ID。</p><div class="migration-preview"><section v-for="row in rows" :key="row.index"><div class="preview-heading"><strong>{{ row.config.name }}</strong><select v-model="choices[row.index]" :aria-label="'导入方式 ' + row.config.name"><option value="skip">跳过</option><option v-if="!row.duplicate && !row.revoked" value="add">新增连接</option><option v-if="row.existingId && !row.revoked" value="replace">更新已有连接</option></select></div><code>{{ row.config.user || '未填用户名' }}@{{ row.config.host }}:{{ row.config.port }}</code><p>{{ row.config.group || '未分组' }} · {{ row.keyIncluded ? '包含私钥，将保存到本机新路径' : '未携带私钥；新增连接可能需要补全认证' }}</p><p v-if="row.ambiguous || row.revoked" class="form-error">{{ row.revoked ? '该主机密钥在本机已被撤销，只能跳过' : '本机存在多个相同连接，只能跳过' }}</p><p v-if="row.hostConflict" class="form-error">主机指纹与本机记录不同，请核实后再导入。仅为导入连接使用此包中的指纹，不修改系统记录。</p><p v-for="fingerprint in row.fingerprints" :key="fingerprint" class="fingerprint">包内：{{ fingerprint }}</p><p v-if="!row.fingerprints.length">未携带指纹，首次连接需在本机核实。</p><p v-for="fingerprint in row.hostConflict ? row.localFingerprints : []" :key="fingerprint" class="fingerprint">本机：{{ fingerprint }}</p></section></div><label v-if="rows.some(r => r.fingerprints.length)" class="check-label"><input v-model="trust" type="checkbox" />我已核对并信任连接包中的服务器主机指纹</label></template><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="dialog-actions"><span class="local-encryption"><LockKeyhole :size="14" />本机加密处理</span><button type="button" :disabled="busy" @click="close">取消</button><button class="primary" :disabled="busy || (mode === 'import' && !staged) || (rows && choices.every(c => c === 'skip'))">{{ busy ? '处理中…' : mode === 'export' ? '导出加密连接包' : rows ? '确认导入' : '解密并预览' }}</button></div></form></dialog></template>
