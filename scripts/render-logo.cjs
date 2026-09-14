// Run with Electron: electron scripts/render-logo.cjs
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { resolve } = require('node:path')
app.whenReady().then(async () => {
  let window
  try {
    const svg = await readFile(resolve('src/assets/servers-logo.svg'), 'utf8')
    const output = resolve('resources/branding'); await mkdir(output, { recursive: true })
    window = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>html,body{margin:0;width:512px;height:512px;background:transparent}svg{width:512px;height:512px;display:block}</style>${svg}`))
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const rendered = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
    const png = rendered.resize({ width: 512, height: 512 }).toPNG()
    await writeFile(resolve(output, 'servers.png'), png)
    await writeFile(resolve(output, 'servers.svg'), svg)
    const source = nativeImage.createFromBuffer(png)
    const sizes = [16, 24, 32, 48, 64, 128, 256]
    const images = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG())
    const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
    let offset = header.length
    sizes.forEach((size, i) => { const pos = 6 + 16 * i; header[pos] = size === 256 ? 0 : size; header[pos + 1] = header[pos]; header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6); header.writeUInt32LE(images[i].length, pos + 8); header.writeUInt32LE(offset, pos + 12); offset += images[i].length })
    await writeFile(resolve(output, 'servers.ico'), Buffer.concat([header, ...images]))
    console.log('Generated SVG, 512px PNG and multi-resolution Windows ICO (16–256px)')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { window?.destroy(); app.quit() }
})
