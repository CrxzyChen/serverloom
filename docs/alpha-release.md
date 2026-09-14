# Alpha release validation

Version: `0.10.0-alpha.1` / Windows x64.

## Scope

This is the first public release of ServerLoom. It includes server inventory and groups, SSH/SFTP/bandwidth tabs, Copilot, local scheduling, tray operation and explicit approval for scheduled commands.

## Reproducible checks

```sh
npm ci
npm run runtime:fetch
npm test
npm run build
npm run privacy:check
node scripts/check-runtime.cjs
node scripts/smoke-scheduler.mjs
node scripts/smoke-scheduler-approvals.mjs
npm run notices
npm run pack -- --config.electronDist=node_modules/electron/dist
node scripts/smoke-package.mjs release-alpha/win-unpacked/ServerLoom.exe
```

- Unit tests cover SSH validation, Markdown safety, inventory persistence, encrypted migration, attachments, model settings, scheduling/DST/recovery, serial execution and approval boundaries.
- Desktop tests cover scheduler editing, closable tabs, tray hiding, single-instance activation, approval notification navigation, reload recovery, approve/decline/cancel and quit confirmation.
- The approval desktop fixture simulates external model/SSH execution. It does not contact a real server and must not be confused with native model execution.
- Optional `check-scheduler-live.mjs` uses a signed-in runtime home and account quota. Set `SERVERLOOM_TEST_RUNTIME_HOME` explicitly for an isolated test account. Its tasks emit synthetic text and create one disabled local test schedule.

## Public runtime provenance

Runtime: official `openai/codex` tag `rust-v0.154.0`.

Archive: `codex-package-x86_64-pc-windows-msvc.tar.gz`.

SHA-256: `94cc5b3632769504c809f6c0364b693c0dfddc5c30c8361095d2263a07ac45a4`.

The build verifier requires this public version and source. Local desktop-app binaries, runtime homes, authentication files and machine-specific configuration are not distributed.

## Privacy review

Public source uses documentation-only endpoints such as `192.0.2.10` and `example.invalid`. Live SSH scripts require explicit connection inputs. Account and attachment data, private keys, connection exports, old release directories and local verification artifacts are git-ignored and excluded by the package allowlist. Commit attribution uses GitHub's public noreply address rather than a personal email.

The release includes a SHA-256 checksum file. Extract the entire portable ZIP before launching; no installer or elevated system service is required.

## Limitations

Alpha quality; Windows x64 only. Use a non-production test server first. No automatic updater, remote/cloud scheduler or execution while the PC is off. Models, reasoning levels, goal features and quotas vary with account/runtime capabilities. Native threads created with an older tool set retain it; start a new Copilot conversation to use newly added tools. Stopping SSH does not guarantee remote rollback.

The Windows release excludes optional locally compiled CPU-detection/SSH crypto bindings and their build metadata. SSH2 uses its supported Node.js crypto fallback, preventing local compiler paths and build logs from entering the portable archive.

## Alpha.1 acceptance results

- 58 unit tests passed; production UI build and privacy scan passed.
- The public Codex runtime passed handshake and dynamic-tool registration with a fresh unsigned-in home.
- Live model tests passed using an explicitly selected test account/model: scheduled background completion, resume after runtime restart, and dynamic-tool creation of a disabled schedule.
- Packaged first launch confirmed no preloaded login; custom close/tray and explicit exit passed.
- Packaged SSH2 fallback passed an isolated loopback SSH connection test with an ephemeral key.
- Every portable file was scanned for the development machine's identifiers in UTF-8 and UTF-16; no matches remained. Build metadata, private keys, account files and server data are excluded.
