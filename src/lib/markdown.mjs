import MarkdownIt from 'markdown-it'

export function safeWebUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })
const escape = markdown.utils.escapeHtml
markdown.validateLink = value => !!safeWebUrl(value)
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('rel', 'noopener noreferrer')
  tokens[index].attrSet('title', tokens[index].attrGet('href') || '')
  return renderer.renderToken(tokens, index, options)
}
// Images remain explicit links; rendering a reply never fetches remote resources.
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], label = `图片：${token.content || '查看图片'}`, url = safeWebUrl(token.attrGet('src'))
  return url ? `<a href="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>` : escape(label)
}
function codeBlock(tokens, index, options, env) {
  const token = tokens[index], language = (token.info || '').trim().split(/\s+/)[0] || 'text'
  const id = env.codeBlocks.push(token.content) - 1
  return `<div class="md-code-block"><div class="md-code-toolbar"><span>${escape(language)}</span><button type="button" class="md-copy" data-code-index="${id}" aria-label="复制代码">复制代码</button></div><pre tabindex="0"><code>${escape(token.content)}</code></pre></div>\n`
}
markdown.renderer.rules.fence = codeBlock
markdown.renderer.rules.code_block = codeBlock
markdown.renderer.rules.table_open = () => '<div class="md-table-wrap"><table>\n'
markdown.renderer.rules.table_close = () => '</table></div>\n'

export function renderMarkdown(source) {
  const env = { codeBlocks: [] }
  return { html: markdown.render(String(source ?? ''), env), codeBlocks: env.codeBlocks }
}
