const { test } = require('node:test')
const assert = require('node:assert/strict')
const parser = import('../src/lib/markdown.mjs')
test('renders headings, emphasis, lists, tables and inline code', async () => {
  const { renderMarkdown } = await parser
  const { html } = renderMarkdown('## 连接成功\n\n**用户**：`admin`\n\n1. 保存\n2. 测试\n\n| 主机 | 状态 |\n| --- | --- |\n| home-server | 通过 |')
  for (const expected of ['<h2>连接成功</h2>', '<strong>用户</strong>', '<code>admin</code>', '<ol>', '<table>', '<td>home-server</td>']) assert.ok(html.includes(expected))
})
test('preserves exact command bytes for copy and renders incomplete streaming fences', async () => {
  const { renderMarkdown } = await parser
  const command = 'ssh -i "$env:USERPROFILE\\.ssh\\id_ed25519" admin@192.0.2.10\n'
  const partial = renderMarkdown('```powershell\n' + command)
  assert.equal(partial.codeBlocks[0], command)
  assert.ok(partial.html.includes('复制代码')); assert.ok(partial.html.includes('powershell'))
  const complete = renderMarkdown('```powershell\n' + command + '```\n\n完成。')
  assert.deepEqual(complete.codeBlocks, [command]); assert.ok(complete.html.includes('<p>完成。</p>'))
})
test('does not turn raw HTML, dangerous URLs or fence labels into active content', async () => {
  const { renderMarkdown } = await parser
  const { html } = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[x](file:///C:/secret.txt)\n\n```"><img/onerror=alert(1)>\n</code><script>bad</script>\n```')
  assert.equal(/<script|<img|href="javascript:|href="file:|<iframe/i.test(html), false)
  assert.ok(html.includes('&lt;script&gt;'))
})
test('links are restricted to webpages and images do not fetch automatically', async () => {
  const { renderMarkdown, safeWebUrl } = await parser
  const { html } = renderMarkdown('[文档](https://example.com/docs)\n\n![预览](https://example.com/image.png)')
  assert.ok(html.includes('href="https://example.com/docs"')); assert.ok(html.includes('图片：预览'))
  assert.equal(html.includes('<img'), false)
  for (const url of ['javascript:alert(1)', 'file:///C:/a', 'data:text/html,test', 'shell:AppsFolder', '//example.com']) assert.equal(safeWebUrl(url), null)
})
