import { readMaintenanceSheet, type SheetReading } from '../../core/maintenanceSheet/read'
import type { FleetAircraft } from '../../core/maintenanceSheet/registration'
import { decodeImage } from './decode'
import { withOcrEngine, type TesseractPaths } from './ocrEngine'

/** A karbantartási táblázat fotójának beolvasása fájltartalomból (ERF-04). */
export async function readSheetImage(bytes: Uint8Array, fleet: readonly FleetAircraft[], paths: TesseractPaths): Promise<SheetReading> {
  const rgba = decodeImage(bytes)
  return withOcrEngine(paths, (engine) => readMaintenanceSheet(rgba, fleet, engine))
}
