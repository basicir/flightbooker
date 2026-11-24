import { describe, expect, it } from 'vitest'
import { assertBuildMatchesChannel, DEV_MARKERS, findDevMarkers } from '../../tools/release/buildGuard'

describe('csomagolási őr: DEV-eszköz csak a DEV-ben (FRS-09–FRS-11)', () => {
  const devBuild = { main: [`x("${DEV_MARKERS.main}")`], renderer: [`<div data-${DEV_MARKERS.renderer}="">`] }
  const stableBuild = { main: ['console.log(1)'], renderer: ['<div class="stack">'] }

  it('felismeri a DEV-modulok jelölőit', () => {
    expect(findDevMarkers(devBuild)).toEqual({ main: true, renderer: true })
    expect(findDevMarkers(stableBuild)).toEqual({ main: false, renderer: false })
  })

  it('a fő kiadás nem tartalmazhat fejlesztői eszközt, a DEV-nek kell', () => {
    expect(() => assertBuildMatchesChannel('stable', findDevMarkers(stableBuild))).not.toThrow()
    expect(() => assertBuildMatchesChannel('dev', findDevMarkers(devBuild))).not.toThrow()
    expect(() => assertBuildMatchesChannel('stable', findDevMarkers(devBuild))).toThrow(/fejlesztői eszköz/)
    expect(() => assertBuildMatchesChannel('stable', { main: false, renderer: true })).toThrow()
    expect(() => assertBuildMatchesChannel('dev', findDevMarkers(stableBuild))).toThrow(/hiányoznak/)
    expect(() => assertBuildMatchesChannel('dev', { main: true, renderer: false })).toThrow()
  })
})
