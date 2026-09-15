import builder from 'electron-builder'
import { readFile, copyFile } from 'node:fs/promises'
import { prerelease } from 'semver'
const pkg=JSON.parse(await readFile('package.json','utf8'))
const channel=prerelease(pkg.version)?.[0] || 'latest'
await builder.build({targets:builder.Platform.WINDOWS.createTarget(['nsis','zip'],builder.Arch.x64),publish:'never'})

// GitHub's builder provider generates latest.yml; publish a verified channel alias too.
if(channel !== 'latest') await copyFile(`${pkg.build.directories.output}/latest.yml`, `${pkg.build.directories.output}/${channel}.yml`)
