import type * as Real from './devTools'

/**
 * A fő kiadás buildjében a `@dev-tools/ui` alias ide mutat (electron.vite.config.ts): a fejlesztői
 * felületelemek kódja így a fő változatba bele sem kerül. A paraméterek a valódi modulhoz kötöttek.
 */
type Props<T extends (props: never) => unknown> = Parameters<T>[0]

export const DevTools = (): null => null
export const DevImportNotice = (_props: Props<typeof Real.DevImportNotice>): null => null
export const DevBadge = (_props: Props<typeof Real.DevBadge>): null => null
export const StableImport = (): null => null
export const StableApiKeyButton = (_props: Props<typeof Real.StableApiKeyButton>): null => null
