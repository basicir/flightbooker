import type * as Real from './devTools'

/**
 * A fő kiadás buildjében a `@dev-tools/main` alias ide mutat (electron.vite.config.ts): a fejlesztői
 * eszközök kódja így a fő változatba bele sem kerül. A típusok a valódi modulhoz kötöttek.
 */
export type { DevTools } from './devTools'

export const createDevTools: typeof Real.createDevTools = () => {
  throw new Error('Ez a build nem tartalmaz fejlesztői eszközöket.')
}

export const importOnFirstStart: typeof Real.importOnFirstStart = async () => undefined

export const registerDevIpc: typeof Real.registerDevIpc = () => undefined
