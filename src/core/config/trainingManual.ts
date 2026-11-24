import type { LimitRule } from '../model/limits'
import type { WeatherLimits } from '../model/weather'

/**
 * Az iskola Training Manualjának (ATP Integrated, Rev 8, 2026.08.23) értékei:
 * II.6.2 – időjárási korlátok gyakorlatonként, II.6.4 – a növendékek szolgálati, blokk- és
 * pihenőideje. Az oktatói szolgálati és pihenőidőt a TM (II.6.3) az Operations Manualhoz utalja.
 */

export const TM_REF = 'TM Rev 8'

/** Képzési fázis a fázisfüggő napi blokkidőhöz (TM II.6.4). */
export type TrainingPhase = '1-2' | '3-4' | '5' | '6'

export interface TrainingPhaseInfo {
  readonly value: TrainingPhase
  readonly label: string
  /** Napi legnagyobb blokkidő (repülőkiképzés), kettős repülésnél. */
  readonly maxDailyBlockHours: number
  /** Egyedül (SOLO) repülésnél, ha a TM külön megadja. */
  readonly maxDailySoloBlockHours?: number
}

export const TRAINING_PHASES: readonly TrainingPhaseInfo[] = [
  { value: '1-2', label: '1–2. fázis (VFR, nappal)', maxDailyBlockHours: 2.5, maxDailySoloBlockHours: 3 },
  { value: '3-4', label: '3–4. fázis', maxDailyBlockHours: 4, maxDailySoloBlockHours: 4 },
  { value: '5', label: '5. fázis', maxDailyBlockHours: 3 },
  { value: '6', label: '6. fázis', maxDailyBlockHours: 6 },
]

export const PHASE_RULE_ID = 'novendek-fazis-blokk-nap'

/**
 * A növendék fázisához tartozó napi blokkidő-szabály (TM II.6.4). A kettős repülés
 * (szigorúbb) értékét használja; a TM a különleges feladatokra (például 300 NM-es útvonal)
 * kivételt enged, ezért csak figyelmeztet.
 */
export function phaseLimitRule(phase: TrainingPhase | undefined): LimitRule | undefined {
  const info = TRAINING_PHASES.find((p) => p.value === phase)
  if (!info) return undefined
  return {
    id: PHASE_RULE_ID,
    subject: 'student',
    metric: 'flightTime',
    window: { kind: 'calendarDay' },
    limit: info.maxDailyBlockHours,
    severity: 'warning',
    warnAtPercent: 80,
    includeSimulator: false,
    source: `${TM_REF}, II.6.4 – ${info.label}`,
    enabled: true,
  }
}

/** Egy sor a TM II.6.2 időjárási táblázatából (csak a valódi géppel végzett gyakorlatok). */
export interface WeatherPreset {
  readonly id: string
  readonly label: string
  readonly limits: WeatherLimits
  /** Ami a táblázatban szerepel, de a program nem tud ellenőrizni (felhőtávolság, horizont). */
  readonly note: string
}

/**
 * A TM „H-wind” oszlopa a szél felső határa; a széllökésre is ezt alkalmazzuk, mert a lökés
 * a legnagyobb szélsebesség. A felhőtől való távolság nem jelezhető előre, ezért csak megjegyzés.
 */
const wind = (crosswindKt: number, windKt: number): WeatherLimits => ({ maxCrosswindKt: crosswindKt, maxWindKt: windKt, maxGustKt: windKt })

export const TM_WEATHER_PRESETS: readonly WeatherPreset[] = [
  { id: 'ex-1-3-1-13', label: '1-3 – 1-13. gyakorlat', limits: { minVisibilityM: 10_000, ...wind(15, 20) }, note: 'felhőmentes, látható horizont' },
  { id: 'vfr-dual-local', label: 'További VFR kettős / SPIC, helyi', limits: { minVisibilityM: 5000, ...wind(17, 30) }, note: 'felhőmentes, látható horizont' },
  { id: 'solo-local', label: 'Helyi egyedül (SOLO)', limits: { minVisibilityM: 8000, ...wind(10, 15) }, note: 'felhőtől 500 ft függőlegesen, 1000 m vízszintesen; földlátás' },
  { id: 'xc-dual', label: '2–3. fázis VFR kettős / SPIC útvonal', limits: { minVisibilityM: 5000, ...wind(17, 30) }, note: 'felhőtől 500 ft / 1000 m; földlátás' },
  { id: 'xc-solo', label: 'Egyedül útvonal (SOLO x-country)', limits: { minVisibilityM: 8000, ...wind(15, 25) }, note: 'felhőtől 1000 ft / 1500 m; földlátás' },
  { id: 'p4-ifr-sep', label: '4. fázis IFR FPL, IR egymotoros géppel', limits: { minVisibilityM: 3000, minCloudBaseFt: 1000, ...wind(17, 30) }, note: 'FCL.905.FI(h)(3) szerinti oktatóval 2000 ft felhőalap' },
  { id: 'p4-vfr', label: '4. fázis VFR FPL géppel', limits: { minVisibilityM: 5000, ...wind(17, 30) }, note: 'felhőtől 500 ft / 1000 m; látható horizont' },
  { id: 'p4-ifr-mep', label: '4. fázis IFR FPL, IR többmotoros géppel', limits: { minVisibilityM: 1000, minCloudBaseFt: 500, ...wind(17, 30) }, note: '' },
  { id: 'p5-uprt', label: '5. fázis Advanced UPRT', limits: { minVisibilityM: 5000, ...wind(17, 30) }, note: 'felhőtől 500 ft / 1000 m; látható horizont' },
]

/** Melyik TM-sorral egyezik pontosan a növendék limitje (a felületen a választó állásához). */
export function matchingWeatherPreset(limits: WeatherLimits | undefined): WeatherPreset | undefined {
  if (!limits) return undefined
  const keys = (l: WeatherLimits): string =>
    JSON.stringify(
      Object.entries(l)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    )
  const wanted = keys(limits)
  return TM_WEATHER_PRESETS.find((p) => keys(p.limits) === wanted)
}

/**
 * A TM II.6.4 azon előírásai, amelyeket a program nem ellenőriz (nincs hozzá adat vagy
 * mérőszám); a limitek oldalán tájékoztatásként jelennek meg.
 */
export const TM_UNCHECKED_RULES: readonly string[] = [
  'Egyedül (SOLO) repült blokkidő naponta: 1–2. fázis 3 óra, 3–4. fázis 4 óra (a program a kettős értéket használja, az a szigorúbb).',
  'Éjszakai blokkidő a 3–4. fázisban: 3 óra (kettős és SOLO).',
  'Legalább 36 óra pihenő minden 168 egymást követő óra után.',
  'Szolgálatmentes napok: naptári hónapban 5, 90 egymást követő napon 15, naptári évben 60.',
  'A teljes képzés legfeljebb 36 hónap (II.6.3).',
]
