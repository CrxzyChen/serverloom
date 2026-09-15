const { valid, gt, prerelease } = require('semver')
const RELEASES = 'https://github.com/CrxzyChen/serverloom/releases'
const busyStates = new Set(['checking', 'downloading', 'waiting', 'installing'])
function eligible(version, current, channel) {
  return !!valid(version) && gt(version, current) && (channel === 'alpha' || !prerelease(version))
}
class Updates {
  constructor({ version, installed, updater, store, fetch, emit, activity, suspend, resume, install, confirm }) {
    Object.assign(this, { updater, store, fetch, emit, activity, suspend, resume, install, confirm })
    this.state = { version, installed, phase: 'idle', channel: prerelease(version) ? 'alpha' : 'stable', autoCheck: true, available: null, progress: 0, error: '', checkedAt: null, blockers: null }
    this.blockNew = false
    if (updater) {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.on('error', () => {}) // Errors are also rejected by check/download; never log credentials or URLs.
      updater.on('download-progress', p => this.set({ progress: Math.round(p.percent) }))
    }
  }
  snapshot() { return structuredClone(this.state) }
  set(value) { Object.assign(this.state, value); this.emit(this.snapshot()) }
  async init() {
    const preferences = (await this.store.read()).updates
    if (preferences) Object.assign(this.state, { channel: ['stable', 'alpha'].includes(preferences.channel) ? preferences.channel : this.state.channel, autoCheck: preferences.autoCheck !== false })
    this.startTimer = setTimeout(() => this.automatic(), 30000); this.startTimer.unref?.()
    this.checkTimer = setInterval(() => this.automatic(), 6 * 3600000); this.checkTimer.unref?.()
    return this.snapshot()
  }
  automatic() { if (this.state.autoCheck && !busyStates.has(this.state.phase) && this.state.phase !== 'ready') void this.check().catch(() => {}) }
  async settings(value) {
    if (busyStates.has(this.state.phase) || this.state.phase === 'ready') throw new Error('请先完成或取消当前更新，再切换设置')
    if (!value || !['stable', 'alpha'].includes(value.channel) || typeof value.autoCheck !== 'boolean') throw new Error('更新设置无效')
    await this.store.update(d => { d.updates = { channel: value.channel, autoCheck: value.autoCheck } })
    this.set({ channel: value.channel, autoCheck: value.autoCheck, available: null, phase: 'idle', error: '' }); return this.snapshot()
  }
  async check() {
    if (busyStates.has(this.state.phase) || this.state.phase === 'ready') return this.snapshot()
    this.set({ phase: 'checking', error: '', available: null, progress: 0 })
    try {
      let info
      if (this.state.installed) {
        this.updater.channel = this.state.channel === 'stable' ? 'latest' : 'alpha'
        this.updater.allowPrerelease = this.state.channel === 'alpha'
        this.updater.allowDowngrade = false // Setting channel enables downgrade implicitly: always reset it.
        const result = await this.updater.checkForUpdates()
        info = result?.updateInfo
      } else {
        const response = await this.fetch('https://api.github.com/repos/CrxzyChen/serverloom/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error('Release source unavailable')
        const releases = await response.json()
        const candidates = releases.filter(r => !r.draft && (this.state.channel === 'alpha' || !r.prerelease) && eligible(r.tag_name?.replace(/^v/, ''), this.state.version, this.state.channel))
        candidates.sort((a,b) => gt(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, '')) ? -1 : 1)
        const release = candidates[0]
        if (release) info = { version: release.tag_name.replace(/^v/, ''), releaseNotes: release.body }
      }
      const available = info && eligible(info.version, this.state.version, this.state.channel) ? { version: info.version, notes: (typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes || []).map(n => n.note).join('\n')).slice(0, 30000), url: `${RELEASES}/tag/v${info.version}` } : null
      this.set({ phase: available ? 'available' : 'current', available, checkedAt: new Date().toISOString() })
    } catch { this.set({ phase: 'error', error: '无法检查更新，请检查网络或稍后重试；发布源可能尚未就绪。' }) }
    return this.snapshot()
  }
  async download() {
    if (!this.state.installed || !this.state.available || !['available', 'error'].includes(this.state.phase)) throw new Error('请先检查安装版更新')
    this.set({ phase: 'downloading', progress: 0, error: '' })
    try { await this.updater.downloadUpdate(); this.set({ phase: 'ready', progress: 100 }) }
    catch { this.set({ phase: 'error', error: '更新下载或校验失败，现有版本可继续使用。请重试下载。' }) }
    return this.snapshot()
  }
  async requestInstall() {
    if (this.state.phase !== 'ready' || this.confirming) return this.snapshot()
    this.confirming = true
    try {
      const status = this.activity()
      if (!await this.confirm(status)) return this.snapshot()
      this.blockNew = true; this.suspend()
      this.set({ phase: 'waiting', error: '', blockers: this.activity() })
      this.waitTimer = setInterval(() => void this.tryInstall(), 1000); this.waitTimer.unref?.()
      await this.tryInstall()
    } finally { this.confirming = false }
    return this.snapshot()
  }
  async tryInstall() {
    if (this.state.phase !== 'waiting' || this.installing) return
    const blockers = this.activity(); this.set({ blockers })
    if (blockers.tasks || blockers.operations) return
    this.installing = true; clearInterval(this.waitTimer); this.set({ phase: 'installing' })
    try { await this.install() }
    catch { this.blockNew = false; await this.resume(); this.set({ phase: 'ready', error: '安装未启动，已恢复任务调度。请重试或下载完整安装包。', blockers: null }) }
    finally { this.installing = false }
  }
  async cancel() {
    if (this.state.phase !== 'waiting') throw new Error('当前没有等待安装的更新')
    clearInterval(this.waitTimer); this.blockNew = false; await this.resume(); this.set({ phase: 'ready', blockers: null }); return this.snapshot()
  }
  dispose() { clearTimeout(this.startTimer); clearInterval(this.checkTimer); clearInterval(this.waitTimer) }
}
module.exports = { Updates, eligible, RELEASES }
