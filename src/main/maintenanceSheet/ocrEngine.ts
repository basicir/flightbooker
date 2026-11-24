import { access } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createWorker, OEM, PSM } from 'tesseract.js'
import { encodePgm } from '../../core/maintenanceSheet/image'
import type { OcrLine } from '../../core/maintenanceSheet/mosaic'
import type { OcrEngine } from '../../core/maintenanceSheet/read'

/**
 * Helyben futó OCR (ERF-04, ALP-02): a Tesseract WebAssembly-változata (tesseract.js) egy
 * worker szálban. A nyelvi modellt (angol, „best_int” LSTM) a programmal szállított fájlból
 * töltjük be; a tesseract.js alapból egy CDN-ről töltené le, ezért a `langPath` mindig helyi,
 * abszolút útvonal, és gyorsítótárat sem ír. Hálózati kérés így nem indul.
 */

export interface TesseractPaths {
  /** Az `eng.traineddata.gz`-t tartalmazó mappa. */
  readonly langPath: string
  /** A worker szkript (csomagolt alkalmazásban az app.asar.unpacked alól). */
  readonly workerPath?: string
}

export function assertLocalPath(path: string): void {
  if (!isAbsolute(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error('Az OCR nyelvi modellje csak helyi fájlból tölthető be (ALP-02).')
  }
}

interface TesseractLine {
  readonly text: string
  readonly confidence: number
  readonly bbox: { readonly y0: number; readonly y1: number }
}

/**
 * Egy OCR-munkamenet: létrehozza a workert, lefuttatja a feldolgozást, majd mindenképp
 * leállítja (nem marad háttérszál).
 */
/** A worker indításának időkorlátja: hibás telepítésnél se várjon a felület örökké. */
export const OCR_START_TIMEOUT_MS = 60_000

export async function withOcrEngine<T>(paths: TesseractPaths, run: (engine: OcrEngine) => Promise<T>): Promise<T> {
  assertLocalPath(paths.langPath)
  if (paths.workerPath) assertLocalPath(paths.workerPath)
  // A modell hiányában a tesseract.js worker hibája elnyelődne, és a hívás sosem térne vissza.
  try {
    await access(join(paths.langPath, 'eng.traineddata.gz'))
  } catch {
    throw new Error('Az OCR nyelvi modellje hiányzik a telepítésből; a beolvasás nem indítható.')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Az OCR nem indult el időben.')), OCR_START_TIMEOUT_MS)
  })
  const starting = createWorker('eng', OEM.LSTM_ONLY, {
    langPath: paths.langPath,
    cacheMethod: 'none',
    gzip: true,
    // Enélkül a worker hibája kezeletlen kivételként a főfolyamatot is leállítaná; így csak
    // az adott hívás ígérete utasítódik el.
    errorHandler: () => undefined,
    ...(paths.workerPath ? { workerPath: paths.workerPath } : {}),
  })
  const worker = await Promise.race([starting, timeout])
    .catch((error: unknown) => {
      // A később mégis elinduló worker se maradjon a háttérben.
      void starting.then((w) => w.terminate()).catch(() => undefined)
      throw error
    })
    .finally(() => clearTimeout(timer))
  try {
    const engine: OcrEngine = async (image, whitelist) => {
      await worker.setParameters({
        // Egységes szövegblokk: a mozaik minden sora egy cella.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: whitelist,
        user_defined_dpi: '300',
      })
      const result = await worker.recognize(Buffer.from(encodePgm(image)), {}, { blocks: true, text: false })
      const lines: OcrLine[] = []
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines as readonly TesseractLine[]) {
            lines.push({ text: line.text, confidence: line.confidence, y0: line.bbox.y0, y1: line.bbox.y1 })
          }
        }
      }
      return lines
    }
    return await run(engine)
  } finally {
    await worker.terminate()
  }
}
