// @ts-check
import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * ALP-02: hálózati hívás csak a src/main/net/allowedFetch.ts-ben történhet.
 * Minden más fájlban tilos a fetch és minden alacsony szintű hálózati modul.
 */
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: 'Hálózati hívás csak az allowedFetch-en keresztül mehet ki (src/main/net/allowedFetch.ts).',
}))

const NETWORK_PROPERTIES = ['globalThis', 'window', 'self', 'global'].map((object) => ({
  object,
  property: 'fetch',
  message: 'Hálózati hívás csak az allowedFetch-en keresztül mehet ki (src/main/net/allowedFetch.ts).',
}))

const NETWORK_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'undici', 'axios', 'node-fetch', 'ws']
const networkPaths = NETWORK_MODULES.flatMap((name) => [name, `node:${name}`]).map((name) => ({
  name,
  message: 'Hálózati modul csak az allowedFetch-ben használható.',
}))
const electronNet = {
  name: 'electron',
  importNames: ['net'],
  message: 'Az Electron net modulja megkerülné az engedélyezési listát.',
}

const CORE_FORBIDDEN = ['electron', 'fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'child_process', 'node:child_process', 'os', 'node:os'].map(
  (name) => ({ name, message: 'A src/core tiszta TypeScript: nincs benne Electron, fájl vagy hálózat.' }),
)

export default defineConfig(
  // .claude/: a fejlesztői eszközök (Claude Code skillek) külső kódja, nem az alkalmazás része.
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'reports/**', '.claude/**', 'src/core/airports/data.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
      'no-restricted-properties': ['error', ...NETWORK_PROPERTIES],
      'no-restricted-imports': ['error', { paths: [...networkPaths, electronNet] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...networkPaths, ...CORE_FORBIDDEN] }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        { paths: [...networkPaths, { name: 'electron', message: 'A felület nem érheti el közvetlenül az Electront.' }] },
      ],
    },
  },
  {
    // Tampermonkey-szkript: a felhasználó böngészőjében fut a FlightLogger oldalán, csak a DOM-ot
    // olvassa. Hálózatot itt sem használhat (a tiltás érvényben marad).
    files: ['tools/tampermonkey/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    // Az egyetlen kivétel: itt hívható a fetch.
    files: ['src/main/net/allowedFetch.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
)
