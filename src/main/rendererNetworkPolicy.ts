/**
 * Mely URL-eket tölthet be a renderer (ALP-02)? Élesben csak a csomagolt fájlokat,
 * fejlesztéskor ezen felül a helyi Vite dev szervert. Minden más – köztük a
 * FlightLogger és az Open-Meteo – tiltott a renderer számára.
 */
export function isRendererRequestAllowed(rawUrl: string, devServerUrl?: string, fileRoot?: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  // Fájlból csak az alkalmazás saját mappája tölthető (B2); a gyökér nélkül (tesztben) bármelyik.
  if (url.protocol === 'file:') return fileRoot === undefined || isInside(decodeURIComponent(url.pathname), fileRoot)
  if (url.protocol === 'devtools:' || url.protocol === 'chrome-extension:') return true
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true
  if (devServerUrl) {
    const dev = new URL(devServerUrl)
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (isLocalHost && url.port === dev.port && ['http:', 'ws:'].includes(url.protocol)) return true
  }
  return false
}

/** A fájl az alkalmazás mappáján belül van-e (a `..` lépéseket a URL-elemzés már feloldotta). */
function isInside(path: string, root: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\/([A-Za-z]:)/, '$1').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  const ci = /^[A-Za-z]:/.test(r)
  return ci ? p.toLowerCase() === r.toLowerCase() || p.toLowerCase().startsWith(`${r.toLowerCase()}/`) : p === r || p.startsWith(`${r}/`)
}
