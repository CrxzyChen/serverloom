<script setup>
import { computed, ref } from 'vue'
import { renderMarkdown } from '../lib/markdown.mjs'

const props = defineProps({ source: { type: String, default: '' } })
const rendered = computed(() => renderMarkdown(props.source))
const feedback = ref('')
async function interact(event) {
  const button = event.target.closest('button.md-copy')
  if (button && event.type === 'click') {
    event.preventDefault()
    const code = rendered.value.codeBlocks[Number(button.dataset.codeIndex)]
    if (code === undefined) return
    try {
      if (window.servers) await window.servers.copyText(code)
      else await navigator.clipboard.writeText(code)
      feedback.value = '代码已复制'; button.textContent = '已复制'
    } catch { feedback.value = '复制失败，请选中代码手动复制' }
    return
  }
  const anchor = event.target.closest('a')
  if (anchor) {
    event.preventDefault()
    if (event.type === 'auxclick' && event.button !== 1) return
    try {
      if (window.servers) await window.servers.openLink(anchor.getAttribute('href'))
      else feedback.value = '请在桌面客户端打开链接'
    } catch { feedback.value = '无法打开此链接' }
  }
}
</script>

<template>
  <div class="markdown-message">
    <div class="markdown-body" @click="interact" @auxclick="interact" v-html="rendered.html" />
    <span class="markdown-feedback" role="status" aria-live="polite">{{ feedback }}</span>
  </div>
</template>
