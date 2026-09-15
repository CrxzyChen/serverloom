const { randomUUID } = require('node:crypto')
const LIVE = new Set(['queued', 'running', 'waiting'])
const iso = ms => new Date(ms).toISOString()
function timezone(value) { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value } catch { throw new Error('时区无效，请填写 IANA 时区，例如 Asia/Shanghai') } }
function nextRun(rule, zone, after) {
  if (rule.type === 'once') return Date.parse(rule.at) > after ? rule.at : null
  if (rule.type === 'interval') { const anchor = Date.parse(rule.at); return iso(anchor + Math.max(0, Math.floor((after - anchor) / (rule.minutes * 60000)) + 1) * rule.minutes * 60000) }
  // UTC minute traversal resolves DST gaps by skipping and folds by choosing the first occurrence.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const parts = ms => Object.fromEntries(fmt.formatToParts(ms).map(p => [p.type, p.value]))
  for (let ms = Math.floor(after / 60000) * 60000 + 60000, end = ms + 16 * 86400000; ms < end; ms += 60000) {
    const p = parts(ms)
    if (`${p.hour}:${p.minute}` !== rule.time || (rule.type === 'weekly' && !rule.days.includes(days.indexOf(p.weekday)))) continue
    let duplicate = false
    for (let back = 1; back <= 180; back++) { const q = parts(ms - back * 60000); if (q.year === p.year && q.month === p.month && q.day === p.day && q.hour === p.hour && q.minute === p.minute) { duplicate = true; break } }
    if (!duplicate) return iso(ms)
  }
  throw new Error('未找到下一次执行时间')
}
function validateTask(v, data, now) {
  if (!v || typeof v !== 'object') throw new Error('任务配置无效')
  const name = String(v.name || '').trim(), prompt = String(v.prompt || '').trim()
  if (!name || name.length > 100 || !prompt || prompt.length > 30000) throw new Error('任务名称需 1–100 字，指令需 1–30000 字')
  const zone = timezone(v.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone), rule = { ...v.rule }
  if (!['once','interval','daily','weekly'].includes(rule.type)) throw new Error('调度类型无效')
  if (['once','interval'].includes(rule.type)) { if (typeof rule.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(rule.at) || !Number.isFinite(Date.parse(rule.at))) throw new Error('开始时间无效'); rule.at = iso(Date.parse(rule.at)) }
  if (rule.type === 'interval' && (!Number.isInteger(rule.minutes) || rule.minutes < 1 || rule.minutes > 525600)) throw new Error('间隔需为 1–525600 分钟')
  if (['daily','weekly'].includes(rule.type) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) throw new Error('时间需为 HH:mm')
  if (rule.type === 'weekly' && (!Array.isArray(rule.days) || !rule.days.length || rule.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('请选择有效的星期')
  const serverIds = [...new Set(v.serverIds || [])]
  if (serverIds.length > 50 || serverIds.some(id => !data.servers.some(s => s.id === id))) throw new Error('目标服务器不存在')
  if (!['new','existing'].includes(v.conversationMode)) throw new Error('会话方式无效')
  if (v.conversationMode === 'existing' && !data.chatThreads?.[v.conversationId]) throw new Error('请先创建并发送一次目标会话')
  if (!['readonly','approval'].includes(v.operations)) throw new Error('操作权限无效')
  if (!['skip','once'].includes(v.missedPolicy)) throw new Error('漏跑策略无效')
  if (!['all','attention','none'].includes(v.notification)) throw new Error('通知设置无效')
  if (!Number.isInteger(v.timeoutMinutes) || v.timeoutMinutes < 1 || v.timeoutMinutes > 1440) throw new Error('超时需为 1–1440 分钟')
  if (typeof v.enabled !== 'boolean') throw new Error('启用状态无效')
  return { id: v.id || randomUUID(), name, prompt, timezone: zone, rule, serverIds, conversationMode: v.conversationMode, conversationId: v.conversationMode === 'existing' ? v.conversationId : '', operations: v.operations, missedPolicy: v.missedPolicy, notification: v.notification, timeoutMinutes: v.timeoutMinutes, enabled: v.enabled, settings: v.settings || null, nextRunAt: v.enabled ? nextRun(rule, zone, now) : null, updatedAt: iso(now) }
}
class Scheduler {
  constructor(store, execute, changed = () => {}, notify = () => {}, clock = Date.now) { Object.assign(this, { store, execute, changed, notify, clock }); this.stopping = false; this.draining = false; this.ticking = false; this.current = null }
  async init() {
    await this.store.update(d => { d.schedules ||= []; d.runs ||= []; d.scheduler ||= { paused: false }; for (const r of d.runs) if (LIVE.has(r.status) && !(r.status === 'queued' && d.scheduler.updateResume?.includes(r.id))) Object.assign(r, { status: 'interrupted', endedAt: iso(this.clock()), error: '应用上次退出时任务未完成；请检查结果后手动重试，未自动重放。' }); delete d.scheduler.updateResume })
    await this.tick(); this.timer = setInterval(() => this.tick().catch(e => this.changed({ error: e.message })), 15000); this.timer.unref?.()
  }
  async snapshot() { const d = await this.store.read(); return { tasks: d.schedules || [], runs: d.runs || [], paused: !!d.scheduler?.paused, current: this.current?.id || null } }
  async save(value) {
    const task = await this.store.update(d => { d.schedules ||= []; const old = value.id && d.schedules.find(t => t.id === value.id); if (value.id && !old) throw new Error('任务不存在'); const t = validateTask({ ...old, ...value }, d, this.clock()); if (t.enabled && t.rule.type === 'once' && !t.nextRunAt) throw new Error('一次性任务必须选择未来时间'); if (d.runs?.some(r => r.scheduleId === t.id && LIVE.has(r.status))) throw new Error('请等待任务结束或停止任务后编辑'); if (old) Object.assign(old,t); else d.schedules.push(t); return t })
    this.changed(); return task
  }
  async remove(id) { await this.store.update(d => { if (d.runs?.some(r => r.scheduleId === id && LIVE.has(r.status))) throw new Error('请先停止此任务'); d.schedules = (d.schedules || []).filter(t => t.id !== id) }); this.changed() }
  async enable(id, enabled) { if (typeof enabled !== 'boolean') throw new Error('状态无效'); await this.store.update(d => { const t = d.schedules?.find(t => t.id === id); if (!t) throw new Error('任务不存在'); t.enabled = enabled; t.nextRunAt = enabled ? nextRun(t.rule,t.timezone,this.clock()) : null; if (enabled && !t.nextRunAt) throw new Error('执行时间已过，请编辑时间') }); this.changed() }
  async pause(paused) { if (typeof paused !== 'boolean') throw new Error('状态无效'); await this.store.update(d => { d.scheduler = { ...d.scheduler, paused } }); this.changed(); if (!paused) await this.tick() }
  createRun(task, at, source = 'schedule') { return { id: randomUUID(), scheduleId: task.id, name: task.name, scheduledAt: at, createdAt: iso(this.clock()), status: 'queued', source, conversationId: task.conversationMode === 'existing' ? task.conversationId : randomUUID(), task: structuredClone(task), result: '' } }
  assertAccepting() { if (this.updateHold || this.stopping) throw new Error('正在准备更新，请稍后重试或取消等待更新') }
  suspendForUpdate() { this.updateHold = true }
  async resumeAfterUpdate() { this.updateHold = false; this.stopping = false; await this.store.update(d => { if(d.scheduler) delete d.scheduler.updateResume }); await this.tick() }
  async preserveForUpdate() {
    if (this.current || this.draining || this.ticking) throw new Error('任务仍在结束中')
    await this.store.update(d => { d.scheduler ||= {}; d.scheduler.updateResume = (d.runs || []).filter(r => r.status === 'queued').map(r => r.id) })
  }
  async runNow(id) { this.assertAccepting(); const r = await this.store.update(d => { this.assertAccepting(); const t = d.schedules?.find(t => t.id === id); if (!t) throw new Error('任务不存在'); if (d.runs.some(r => r.scheduleId === id && LIVE.has(r.status))) throw new Error('此任务已在队列中'); const r = this.createRun(t, iso(this.clock()), 'runNow'); d.runs.push(r); return r }); this.changed(); void this.drain(); return r }
  async manual(value) {
    this.assertAccepting()
    if (!value || typeof value.text !== 'string' || value.text.length > 30000 || (!value.text.trim() && !value.attachments?.length) || !/^[a-zA-Z0-9-]{1,64}$/.test(value.conversationId || '')) throw new Error('会话或任务内容无效')
    const r = { id: randomUUID(), source: 'manual', conversationId: value.conversationId, name: value.text.slice(0,100) || '附件', createdAt: iso(this.clock()), status: 'queued', value: structuredClone(value), result: '' }
    await this.store.update(d => { this.assertAccepting(); d.runs ||= []; if (d.runs.filter(r => LIVE.has(r.status)).length >= 100) throw new Error('队列已满'); d.runs.push(r) }); this.changed(); void this.drain(); return { queued: true, runId: r.id }
  }
  async tick() {
    if (this.stopping || this.updateHold || this.ticking) return
    this.ticking = true
    try {
      const now = this.clock(), data = await this.store.read()
      if (!data.scheduler?.paused && data.schedules?.some(t => t.enabled && t.nextRunAt && Date.parse(t.nextRunAt) <= now)) {
        await this.store.update(d => { if (d.scheduler?.paused || this.updateHold) return; for (const t of d.schedules || []) {
          if (!t.enabled || !t.nextRunAt || Date.parse(t.nextRunAt) > now) continue
          const at = t.nextRunAt, late = now - Date.parse(at) > 60000
          const duplicate = d.runs.some(r => r.scheduleId === t.id && (LIVE.has(r.status) || (r.source === 'schedule' && r.scheduledAt === at)))
          if (!duplicate) { const r = this.createRun(t,at); if (late && t.missedPolicy === 'skip') Object.assign(r,{ status:'skipped', endedAt:iso(now), error:'错过执行时间，按策略跳过' }); d.runs.push(r) }
          t.nextRunAt = nextRun(t.rule,t.timezone,now); if (!t.nextRunAt) t.enabled = false
        } }); this.changed()
      }
      void this.drain()
    } finally { this.ticking = false }
  }
  async patch(id, value) { await this.store.update(d => { const r = d.runs.find(r => r.id === id); if (r) Object.assign(r,value) }); this.changed() }
  async drain() {
    if (this.draining || this.stopping || this.updateHold) return
    this.draining = true
    try {
      while (!this.stopping && !this.updateHold) {
        const d = await this.store.read(), run = d.runs?.find(r => r.status === 'queued' && (!d.scheduler?.paused || r.source !== 'schedule'))
        if (!run || this.updateHold || this.stopping) break
        const controller = new AbortController(); this.current = { ...run, controller }
        await this.patch(run.id, { status: 'running', startedAt: iso(this.clock()) })
        const timer = setTimeout(() => controller.abort(new Error('执行超时，已停止；请检查远端状态后重试')), (run.task?.timeoutMinutes || 60) * 60000)
        try {
          const result = await this.execute(run,controller.signal, async (state, extra = {}) => { await this.patch(run.id, { status: state, ...extra }); if (state === 'waiting' && run.task?.notification !== 'none') this.notify(run,'需要确认',extra.error || '任务正在等待审批或回答') })
          await this.patch(run.id, { status: 'completed', endedAt: iso(this.clock()), result: result?.text || '' })
          if (run.task?.notification === 'all') this.notify(run,'任务完成',run.name)
        } catch (e) {
          await this.patch(run.id, { status: controller.signal.aborted ? 'interrupted' : 'failed', endedAt: iso(this.clock()), error: controller.signal.aborted ? (controller.signal.reason?.message || e.message) : e.message, failureKind: controller.signal.aborted ? 'interrupted' : /usage limit|rate.limit|quota|额度/i.test(e.message) ? 'quota' : /Runtime|runtime/i.test(e.message) ? 'runtime' : /network|offline|ECONN|连接|网络/i.test(e.message) ? 'network' : 'execution' })
          if (run.task?.notification !== 'none') this.notify(run,'任务未完成',e.message)
        } finally { clearTimeout(timer); this.current = null; this.changed() }
      }
    } catch (e) { this.changed({ error:e.message }) } finally { this.draining = false }
  }
  async cancel(id) { if (this.current?.id === id) { this.current.controller.abort(new Error('用户已停止任务')); return }; await this.store.update(d => { const r = d.runs?.find(r => r.id === id); if (r?.status === 'queued') Object.assign(r,{ status:'interrupted', endedAt:iso(this.clock()), error:'用户取消排队' }) }); this.changed() }
  async shutdown() { this.stopping = true; clearInterval(this.timer); this.current?.controller.abort(new Error('应用退出，任务中断')); await this.store.update(d => { for (const r of d.runs || []) if (LIVE.has(r.status)) Object.assign(r,{ status:'interrupted', endedAt:iso(this.clock()), error:'应用退出，任务中断；未自动重放' }) }) }
}
module.exports = { Scheduler, nextRun, validateTask, LIVE }
