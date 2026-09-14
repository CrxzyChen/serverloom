export function parseNetwork(text) {
  const lines = text.trim().split('\n'), uptime = Number(lines.shift().split(' ')[0]), interfaces = {}
  if (!Number.isFinite(uptime)) throw new Error('服务器未返回有效采样时间')
  for (const line of lines) { const match = line.match(/^\s*([^:]+):\s*(.+)$/); if (!match) continue; const fields = match[2].trim().split(/\s+/).map(Number); if (fields.length >= 16 && fields.every(Number.isFinite)) interfaces[match[1].trim()] = { rx: fields[0], tx: fields[8] } }
  if (!Object.keys(interfaces).length) throw new Error('服务器未返回网卡计数器')
  return { uptime, interfaces }
}
export function networkRates(previous, current) {
  if (!previous || current.uptime <= previous.uptime) return []
  return Object.entries(current.interfaces).filter(([name, value]) => previous.interfaces[name] && value.rx >= previous.interfaces[name].rx && value.tx >= previous.interfaces[name].tx).map(([name, value]) => ({ name, rx: (value.rx - previous.interfaces[name].rx) / (current.uptime - previous.uptime), tx: (value.tx - previous.interfaces[name].tx) / (current.uptime - previous.uptime) }))
}
