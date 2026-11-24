import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * A renderer CSP-je élesben `connect-src 'none'`: a felület semmilyen hálózati
 * kapcsolatot nem nyithat (ALP-02). Fejlesztés közben a Vite HMR websocketje
 * miatt csak a helyi dev szerver engedett.
 */
function rendererCsp(): Plugin {
  let isServe = false
  return {
    name: 'flightbooker-renderer-csp',
    configResolved(config) {
      isServe = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const connect = isServe ? "connect-src ws://localhost:* http://localhost:*" : "connect-src 'none'"
      const script = isServe ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
      return html.replace('__CSP_CONNECT_SRC__', connect).replace('__CSP_SCRIPT_SRC__', script)
    },
  }
}

/**
 * A fejlesztői (DEV) eszközök (FRS-09–FRS-11) csak a DEV-buildbe kerülnek: a fő kiadás buildjében a
 * `@dev-tools/*` aliasok üres modulra mutatnak, így a kódjuk bele sem kerül (a csomagoló ezt
 * ellenőrzi: tools/release/buildGuard.ts). A DEV-build a verzióról ismerhető fel – a kiadási
 * folyamat a build előtt beírja (X.Y.Z-dev.N) –; helyi próbához a FLIGHTBOOKER_BUILD_CHANNEL=dev|stable
 * környezeti változó felülírja.
 */
const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const buildChannel = process.env['FLIGHTBOOKER_BUILD_CHANNEL']
const devBuild = buildChannel ? buildChannel === 'dev' : /-dev\.\d+$/.test(packageVersion)

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@dev-tools/main': resolve(devBuild ? 'src/main/dev/devTools.ts' : 'src/main/dev/devToolsDisabled.ts'),
      },
    },
  },
  preload: {},
  renderer: {
    // A böngészős előnézet (szintetikus adat) helyén egy üres modul: a programba nem kerül.
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@browser-demo': resolve('src/renderer/src/browserDemo/unavailable.ts'),
        '@dev-tools/ui': resolve(devBuild ? 'src/renderer/src/components/devTools.tsx' : 'src/renderer/src/components/devToolsDisabled.tsx'),
      },
    },
    plugins: [react(), rendererCsp()],
  },
})
