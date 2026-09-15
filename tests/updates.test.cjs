const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Updates, eligible } = require('../electron/updates.cjs')
function setup(extra = {}) {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => ({updateInfo:{version:'0.10.0-alpha.3',releaseNotes:'Update'}})
  updater.downloadUpdate = async () => { updater.emit('download-progress',{percent:75}) }
  let saved = {}, installs = 0, suspended = false
  const service = new Updates({ version:'0.10.0-alpha.2', installed:true, updater,
    store:{read:async()=>saved, update:async fn=>fn(saved)}, emit:()=>{},
    activity:()=>({tasks:0,operations:0,sessions:2}), confirm:async()=>true,
    suspend:()=>{suspended=true}, resume:async()=>{suspended=false}, install:async()=>{installs++}, ...extra })
  return {service,updater,get installs(){return installs},get suspended(){return suspended}}
}
test('channels compare semver and never downgrade', () => {
  assert.equal(eligible('0.10.0-alpha.10','0.10.0-alpha.2','alpha'),true)
  assert.equal(eligible('0.10.0-alpha.3','0.10.0-alpha.2','stable'),false)
  assert.equal(eligible('0.10.0','0.10.0-alpha.2','stable'),true)
  assert.equal(eligible('0.9.0','0.10.0-alpha.2','stable'),false)
  assert.equal(eligible('../../payload','0.10.0','alpha'),false)
})
test('check and download never install or suspend; explicit install waits for tasks AND transfers', async () => {
  let activity={tasks:1,operations:1,sessions:2}
  const f=setup({activity:()=>activity}), u=f.service
  try {
    await u.check();assert.equal(u.state.phase,'available');assert.equal(f.suspended,false)
    await u.download();assert.equal(u.state.phase,'ready');assert.equal(f.installs,0)
    assert.equal(f.updater.autoInstallOnAppQuit,false);assert.equal(f.updater.allowDowngrade,false)
    await u.requestInstall();assert.equal(u.state.phase,'waiting');assert.equal(u.blockNew,true)
    activity.tasks=0;await u.tryInstall();assert.equal(f.installs,0)
    activity.operations=0;await Promise.all([u.tryInstall(),u.tryInstall()]);assert.equal(f.installs,1)
  } finally {u.dispose()}
})
test('canceling installation confirmation does not suspend; cancel waiting restores work', async () => {
  const declined=setup({confirm:async()=>false});await declined.service.check();await declined.service.download();await declined.service.requestInstall();assert.equal(declined.suspended,false)
  const f=setup({activity:()=>({tasks:1,operations:0,sessions:0})}),u=f.service
  try {await u.check();await u.download();await u.requestInstall();await u.cancel();assert.equal(u.state.phase,'ready');assert.equal(f.suspended,false);assert.equal(u.blockNew,false)}finally{u.dispose()}
})
test('download and install failures remain recoverable without exposing error details', async () => {
  const f=setup({install:async()=>{throw Error('private local path')}}),u=f.service
  f.updater.downloadUpdate=async()=>{throw Error('private token')}
  await u.check();await u.download();assert.equal(u.state.phase,'error');assert.doesNotMatch(u.state.error,/private/)
  f.updater.downloadUpdate=async()=>{};await u.download();await u.requestInstall()
  assert.equal(u.state.phase,'ready');assert.equal(u.blockNew,false);assert.equal(f.suspended,false);u.dispose()
})
test('portable check excludes drafts and prereleases on stable; newer stable is chosen numerically', async () => {
  const f=setup({installed:false,fetch:async()=>({ok:true,json:async()=>[
    {tag_name:'v0.11.0-alpha.1',prerelease:true},{tag_name:'v0.12.0',draft:true},{tag_name:'v0.10.0',body:'Stable'}, {tag_name:'v0.9.0'}
  ]})}),u=f.service
  await u.settings({channel:'stable',autoCheck:false});await u.check();assert.equal(u.state.available.version,'0.10.0')
  await assert.rejects(()=>u.download(),/安装版/);assert.equal(f.installs,0)
})
test('overlapping checks and settings cannot change an in-flight provider', async () => {
  const f=setup();let finish
  f.updater.checkForUpdates=()=>new Promise(resolve=>{finish=resolve})
  const first=f.service.check();await f.service.check();await assert.rejects(()=>f.service.settings({channel:'stable',autoCheck:true}),/当前更新/)
  finish({updateInfo:{version:'0.10.0-alpha.3'}});await first
  f.service.dispose()
})
