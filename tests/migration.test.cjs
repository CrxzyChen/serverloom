const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const { Store } = require('../electron/store.cjs')
const { Migration, seal, unseal, validatePayload } = require('../electron/migration.cjs')
const pass = 'test-only-password-8132'
const config = { name: 'fixture', host: 'example.invalid', user: 'tester', port: 22, authType: 'privateKey', group: 'Lab' }
const hosts = [{ type: 'ssh-ed25519', data: Buffer.alloc(40, 7).toString('base64') }]
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'servers-migration-')); const store = new Store(join(dir, 'store.json')); return { dir, store } }
test('group lifecycle migrates old labels and preserves servers', async () => {
 const { dir, store } = await fixture(); await writeFile(join(dir, 'store.json'), JSON.stringify({ servers: [{ ...config, id: 'old' }], history: [] })); const first = await store.read(); const id = first.groups[0].id; assert.equal((await store.read()).groups[0].id, id)
 await store.saveGroup({ id, name: 'Renamed' }); assert.equal((await store.read()).servers[0].group, 'Renamed')
 const second = await store.saveGroup({ name: 'Second' }); await store.upsertServer({ id: 'old', groupId: second.id }); await store.reorderGroup(second.id, -1); assert.equal((await store.read()).groups[0].id, second.id)
 await store.removeGroup(second.id); const data = await store.read(); assert.equal(data.servers.length, 1); assert.equal(data.servers[0].groupId, ''); await assert.rejects(store.saveGroup({ name: 'Renamed' }))
})
test('authenticated encryption rejects wrong passwords and tampering without plaintext leaks', async () => {
 const payload = { version: 1, servers: [{ config }] }; const bytes = await seal(payload, pass); assert.ok(!bytes.includes('example.invalid')); assert.notDeepEqual(bytes, await seal(payload, pass)); assert.deepEqual(await unseal(bytes, pass), payload)
 await assert.rejects(unseal(bytes, 'incorrect-password')); const tampered = JSON.parse(bytes); tampered.data = Buffer.alloc(Buffer.from(tampered.data, 'base64').length).toString('base64'); await assert.rejects(unseal(Buffer.from(JSON.stringify(tampered)), pass))
 const entry = validatePayload({ version: 1, servers: [{ config: { ...config, privateKeyPath: 'C:/overwrite', knownHostsPath: 'C:/overwrite', id: 'injected' } }] })[0]; assert.equal(entry.config.privateKeyPath, ''); assert.equal(entry.config.knownHostsPath, ''); assert.notEqual(entry.config.id, 'injected')
})
test('device migration imports generated key to a new local path and handles duplicate updates', async () => {
 const a = await fixture(), b = await fixture(); const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }); const keyPath = join(a.dir, 'fixture.key'); await writeFile(keyPath, privateKey)
 const server = await a.store.saveServer({ ...config, privateKeyPath: keyPath, notes: 'do not export this note' }); const outgoing = new Migration(a.store, join(a.dir, 'credentials'), async () => [...hosts]); const bytes = await outgoing.export([server.id], pass, true); assert.ok(!bytes.includes(privateKey)); const file = join(b.dir, 'fixture.servers'); await writeFile(file, bytes)
 const incoming = new Migration(b.store, join(b.dir, 'credentials'), async () => []); let staged = await incoming.stage(file); let preview = await incoming.preview(staged.token, pass); assert.ok(!JSON.stringify(preview).includes(privateKey)); assert.ok(!JSON.stringify(preview).includes(keyPath)); assert.equal(preview.rows[0].keyIncluded, true)
 await assert.rejects(incoming.commit(staged.token, ['add'], false)); assert.equal((await b.store.read()).servers.length, 0)
 assert.equal((await incoming.commit(staged.token, ['add'], true)).imported, 1); let imported = (await b.store.read()).servers[0]; assert.notEqual(imported.privateKeyPath, keyPath); assert.equal(await readFile(imported.privateKeyPath, 'utf8'), privateKey); assert.equal(imported.group, 'Lab'); assert.equal(imported.notes, ''); assert.match(await readFile(imported.knownHostsPath, 'utf8'), /^example.invalid ssh-ed25519 /)
 await b.store.upsertServer({ id: imported.id, notes: 'local note' }); staged = await incoming.stage(file); preview = await incoming.preview(staged.token, pass); assert.equal(preview.rows[0].existingId, imported.id); await assert.rejects(incoming.commit(staged.token, ['add'], true)); await incoming.commit(staged.token, ['replace'], true); imported = (await b.store.read()).servers[0]; assert.equal(imported.notes, 'local note'); assert.equal((await b.store.read()).servers.length, 1)
})
test('stale configuration and changed host trust invalidate previews', async () => {
 const { dir, store } = await fixture(); const file = join(dir, 'fixture.servers'); await writeFile(file, await seal({ version: 1, servers: [{ config, hostKeys: hosts }] }, pass)); let local = []; const migration = new Migration(store, join(dir, 'credentials'), async () => [...local]); let staged = await migration.stage(file); await migration.preview(staged.token, pass); await store.saveServer({ ...config, name: 'another', host: 'another.invalid' }); await assert.rejects(migration.commit(staged.token, ['add'], true), /配置发生变化/)
 staged = await migration.stage(file); await migration.preview(staged.token, pass); local = [{ ...hosts[0], data: Buffer.alloc(40, 8).toString('base64') }]; await assert.rejects(migration.commit(staged.token, ['add'], true), /指纹发生变化/)
 const preview = await migration.preview(staged.token, pass); assert.equal(preview.rows[0].hostConflict, true)
 local = [{ ...hosts[0], revoked: true }]; assert.equal((await migration.preview(staged.token, pass)).rows[0].revoked, true); await assert.rejects(migration.commit(staged.token, ['add'], true)); assert.equal((await store.read()).servers.length, 1)
})
