# Software updates

ServerLoom 0.10.0-alpha.2 adds a Windows NSIS installer and in-app updates. The status bar opens **Settings → About and updates**. Checks run 30 seconds after startup and every six hours when enabled. Downloads and installation always require user actions. Closing to the tray or ordinary application exit never installs an update implicitly.

## Distribution and channels

- Installed Windows builds use `electron-updater` with the public GitHub Releases provider for `CrxzyChen/serverloom`.
- Portable builds check public release metadata and open a version download page. Install the NSIS edition once to enable in-app installation. Development builds cannot self-install.
- Stable excludes prereleases; Alpha includes preview releases and subsequent stable versions. Neither channel automatically downgrades.
- The desktop and pinned public Codex runtime are updated together. Authentication, SSH credentials, attachments, conversations and task data remain in the application user-data directory.
- GitHub publication must be completed before real update discovery can succeed. No GitHub access token is shipped in the client.

## Task coordination

Downloading does not suspend work. After the user confirms **Restart and update**, new manual jobs, automatic dispatch, new SSH operations, transfers and imports are held. Existing jobs and transfers finish, including any approvals. Waiting can be canceled. The user's normal scheduler pause preference is unchanged.

Once idle, the application records the IDs of queued, never-started jobs and writes a timestamped snapshot of the JSON store under `userData/update-backups`. It then launches the installer and uses the dedicated quit path so the tray cannot hide the window instead. SSH and SFTP connections close at exit. On startup, only the explicitly preserved queued jobs can resume; uncertain running jobs are interrupted and never replayed. Missed scheduled times follow each task's existing skip/catch-up-once policy.

The backup contains private operational data: it stays local, is not a release artifact, and must not be uploaded. It covers the JSON store, not separate credential files or conversation display storage; these are retained in place. No automatic rollback or schema downgrade is implemented. If an installer is canceled after the app exits, restart the existing version. For a bad release, ship a corrected higher version; manual recovery should use a compatible build and a local backup after closing the app.

## Building and publishing

```powershell
npm ci
npm test
npm run privacy:check
npm run runtime:fetch
npm run notices
npm run dist
npm run release:check
```

Output in `release-update`: NSIS installer, `.exe.blockmap`, portable ZIP, channel YAML files and SHA256SUMS. The release checker validates the exact version, installer size and SHA-512 against the updater manifests. Upload the generated assets together; never hand-edit download hashes.

The release workflow builds on a version tag matching `package.json`, then creates a **draft** with all allowlisted assets. Preview tags are marked prerelease. A maintainer reviews artifacts and publishes the draft only after all uploads succeed. `workflow_dispatch` builds downloadable CI artifacts without creating a release. Do not upload unpacked build diagnostics or private test artifacts. Source privacy checks and runtime provenance verification run before packaging.

Alpha builds may be unsigned. HTTPS and manifest hashes provide transport/integrity checks, not an independent publisher identity. Production Windows signing requires a publisher certificate configured in the protected build environment; never commit certificate material or passwords. Keep the publisher identity stable so updater signature validation can work across releases. Validate installed-build upgrades on a clean Windows machine before promoting a stable release.

## Verification

Unit tests cover version/channel selection, failure recovery, waiting for tasks and file operations, cancellation, and queue preservation across restart. `scripts/smoke-updates.mjs` tests real Electron IPC, the settings view, narrow layout, Markdown, progress, cancellation and error handling with synthetic release transport. It does not publish to GitHub or install a production update on the developer machine.


### Local alpha.2 acceptance

- 66 unit tests passed, including 8 new updater/queue recovery cases.
- Production Vite build and NSIS + ZIP packaging passed; five generated assets passed manifest/hash verification.
- Real electron-updater loopback transport rejected a corrupt payload, downloaded valid bytes and emitted the native quit-for-update event. OS installer execution was deliberately substituted in this test.
- Real Electron update UI passed settings persistence, Markdown safety, progress, waiting/cancel, guarded IPC and error recovery. Reviewed at 1360×900 and 960×720 with 125% zoom; the compact capture uses Electron capturePage to avoid Playwright zoom cropping. Visual rubric: 9/10, no zero category.
- Scheduler approval/queue/tray/ordinary-exit regression and packaged application startup passed.
- Source privacy check and portable archive integrity/private-path/private-endpoint scans passed.
- Installer signature status: unsigned. GitHub publication and a complete installed-to-installed production upgrade have not been performed in this workspace.


### alpha.3 migration compatibility fix

The product rename accidentally changed AES-GCM additional authenticated data while retaining connection-package version 1. Original Servers packages therefore failed authentication in alpha.1/alpha.2 even with the correct passphrase. alpha.3 accepts both known historical contexts, requiring full GCM authentication for each, and writes the original immutable protocol context. Passphrases are used exactly as entered, including spaces and Unicode; no trimming, normalization or authentication bypass is applied. Existing files do not need to be re-exported. Import using alpha.3 or later on the destination computer.
