import type { ExistingBooking, Slot } from './planning'
import type { FleetEntry } from './resources'
import type { AirportWeather } from './route'
import type { IsoDateTime, LocalDate } from './time'

/**
 * A motor bemeneti pillanatképe: a FlightLoggerből és az Open-Meteóból összegyűjtött
 * adat egy adott pillanatban (ADT-01–07). A motor ezt nem módosítja, és semmi mást
 * nem olvas: ugyanarra a bemenetre mindig ugyanazt a tervet adja.
 */

export interface AvailabilityEvent {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly unavailable: boolean
}

/** Repült idő a limitekhez (block time), a múltból. */
export interface FlownActivity {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly simulator: boolean
}

/** Egy óra előrejelzése; az időpont az óra kezdete UTC-ben. A hiányzó érték `null`. */
export interface WeatherHour {
  readonly time: IsoDateTime
  readonly temperatureC: number | null
  readonly dewPointC: number | null
  readonly windSpeedKt: number | null
  readonly windDirectionDeg: number | null
  readonly windGustKt: number | null
  readonly visibilityM: number | null
  readonly cloudCoverLowPct: number | null
  readonly precipitationMm: number | null
  readonly precipitationProbabilityPct: number | null
  readonly capeJPerKg: number | null
  /** WMO időjárás-kód; a régebbi gyorsítótárban hiányozhat. */
  readonly weatherCode?: number | null
  /**
   * Plafon a modell nyomási szintenkénti felhőzetéből, láb a repülőtér fölött
   * (`ceilingFromProfile`; `NO_CEILING_FT`: nincs plafon). Hiányzik vagy `null`, ha nincs
   * profil (régebbi gyorsítótár): ekkor a hőmérséklet–harmatpont becslés marad.
   */
  readonly ceilingFt?: number | null
}

export interface Daylight {
  readonly sunrise: IsoDateTime
  readonly sunset: IsoDateTime
}

/** A tervezés előrejelzésének forrása: a modellek pontosság szerint súlyozott együttese. */
export interface WeatherSource {
  readonly kind: 'blend'
  /** Az együttesbe került modellek. */
  readonly models: readonly string[]
  /** Az elmúlt 30 napban METAR-ral mért modellórák száma (0: még az induló súlyok). */
  readonly measuredHours: number
  /**
   * A most le nem jött modellek, amelyeket a legutóbbi sikeres letöltésük pótolt (lásd
   * `fetchPlanningWeather`); hiányában mind friss.
   */
  readonly staleModels?: readonly string[]
}

export interface Snapshot {
  /** A tervezés pillanata. A korábbi időpontokra nem kerül javaslat. */
  readonly generatedAt: IsoDateTime
  /** A tervezett hét hétfője, a repülőtér időzónájában. */
  readonly weekStart: LocalDate
  readonly timezone: string
  /** A tervet készítő oktató (a kulcs tulajdonosa). */
  readonly instructorId: string
  readonly fleet: readonly FleetEntry[]
  readonly classroomIds: readonly string[]
  /**
   * FlightLogger-foglalások, más oktatóké is. A limitek miatt legalább 28 nappal a hét
   * előttről is kellenek; a lemondottakat a motor figyelmen kívül hagyja.
   */
  readonly bookings: readonly ExistingBooking[]
  /** Ráérések felhasználónként (SZB-03). Hiányzó kulcs = nincs adat. */
  readonly availabilities: Readonly<Record<string, readonly AvailabilityEvent[]>>
  /** A növendék utolsó repülésének vége (NOV-08); `null`, ha még nem repült. */
  readonly lastFlightAt: Readonly<Record<string, IsoDateTime | null>>
  /** Az oktató múltbeli repülései a limitekhez (LIM-01). */
  readonly instructorFlights: readonly FlownActivity[]
  /**
   * A hozzárendelt növendékek múltbeli repülései (block time) a növendéki limitekhez
   * (TM II.6.4). Hiányában csak a foglalások számítanak.
   */
  readonly studentFlights?: Readonly<Record<string, readonly FlownActivity[]>>
  readonly weather: readonly WeatherHour[]
  /** A `weather` forrása; a régebbi gyorsítótárban hiányzik (akkor best_match volt). */
  readonly weatherSource?: WeatherSource
  /**
   * Az útvonalas igények (a bázison kívüli) repülőtereinek előrejelzése ICAO-kód szerint
   * (K27, SZB-19). A hiányzó repülőtér időjárása ismeretlen.
   */
  readonly routeWeather?: Readonly<Record<string, AirportWeather>>
  readonly daylight: Readonly<Record<LocalDate, Daylight>>
  /** Újratervezéskor a korábbi terv helyei igényenként (TRV-18, terv stabilitása). */
  readonly previousPlan?: Readonly<Record<string, Slot>>
}
