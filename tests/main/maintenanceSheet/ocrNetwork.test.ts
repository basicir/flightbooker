import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withOcrEngine } from '../../../src/main/maintenanceSheet/ocrEngine'

/**
 * B4: a helyi OCR (tesseract.js, saját worker szálban) nem fordulhat a hálózathoz. Az
 * engedélyezési lista (allowedFetch) a worker szálat nem fedi, ezért azt ellenőrizzük, hogy a
 * nyelvi modell csak helyi fájlból jöhet: hiányában az OCR azonnal hibát ad (nem tölti le a
 * CDN-ről, és nem is vár a végtelenségig), URL-t pedig nem fogad el.
 */

describe('helyi OCR hálózat nélkül (B4)', () => {
  it('hiányzó helyi modellnél azonnal hibát ad, letöltés helyett', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'fb-ocr-'))
    try {
      const started = Date.now()
      await expect(withOcrEngine({ langPath: empty }, async () => 'kész')).rejects.toThrow(/nyelvi modellje hiányzik/)
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('URL-t nem fogad el nyelvi modellként', async () => {
    await expect(withOcrEngine({ langPath: 'https://cdn.example.com/tessdata' }, async () => 'kész')).rejects.toThrow(/helyi fájlból/)
  })
})
