import { describe, expect, it } from 'vitest'
import { isRendererRequestAllowed } from '../../src/main/rendererNetworkPolicy'

describe('renderer hálózati zár (ALP-02)', () => {
  it('a csomagolt fájlokat engedi', () => {
    expect(isRendererRequestAllowed('file:///Applications/x/index.html')).toBe(true)
  })

  it('fájlból csak az alkalmazás saját mappáját engedi (B2)', () => {
    const root = '/Applications/x/out'
    expect(isRendererRequestAllowed('file:///Applications/x/out/renderer/index.html', undefined, root)).toBe(true)
    expect(isRendererRequestAllowed('file:///Applications/x/out/renderer/assets/planWorker-1.js', undefined, root)).toBe(true)
    expect(isRendererRequestAllowed('file:///Users/valaki/Documents/titok.txt', undefined, root)).toBe(false)
    expect(isRendererRequestAllowed('file:///Applications/x/out/../../etc/passwd', undefined, root)).toBe(false)
    expect(isRendererRequestAllowed('file:///Applications/x/outside.html', undefined, root)).toBe(false)
    expect(isRendererRequestAllowed('file:///C:/Program%20Files/x/out/renderer/index.html', undefined, 'C:\\Program Files\\x\\out')).toBe(true)
  })

  it('a FlightLoggert és az Open-Meteót a renderer nem érheti el', () => {
    expect(isRendererRequestAllowed('https://api.flightlogger.net/graphql')).toBe(false)
    expect(isRendererRequestAllowed('https://api.open-meteo.com/v1/forecast')).toBe(false)
  })

  it('idegen hosztot és elemezhetetlen URL-t tilt', () => {
    expect(isRendererRequestAllowed('https://example.com/')).toBe(false)
    expect(isRendererRequestAllowed('nem url')).toBe(false)
  })

  it('a helyi dev szervert csak fejlesztéskor, csak a saját portján engedi', () => {
    const dev = 'http://localhost:5173'
    expect(isRendererRequestAllowed('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isRendererRequestAllowed('ws://localhost:5173/', dev)).toBe(true)
    expect(isRendererRequestAllowed('http://localhost:5173/src/main.tsx')).toBe(false)
    expect(isRendererRequestAllowed('http://localhost:8080/', dev)).toBe(false)
  })
})
