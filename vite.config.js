import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Inject a unique cache version into sw.js at build time.
// Every deploy gets a new timestamp, which causes the service worker to
// activate and clear the old cache — so nurses always load the latest app.
function injectSwVersion() {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
  const cacheVersion = `handova-v${pkg.version}-${Date.now()}`

  return {
    name: 'inject-sw-version',
    writeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js')
      try {
        let sw = readFileSync(swPath, 'utf-8')
        sw = sw.replace('__HANDOVA_CACHE_VERSION__', cacheVersion)
        writeFileSync(swPath, sw)
        console.log(`[Handova] SW cache version injected: ${cacheVersion}`)
      } catch (e) {
        console.warn('[Handova] Could not inject SW version:', e.message)
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), injectSwVersion()],
})
