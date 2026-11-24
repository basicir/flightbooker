import type { Criterion } from './criteria'
import type { FlightRoute } from './route'
import type { TaskSelectionMode } from './people'
import type { IsoDateTime, LocalDate, Minutes } from './time'

/**
 * A tervezés fogalmai (4. fejezet, 9. fejezet). A motor bemenete a pillanatkép, a
 * beállítások és a döntések listája; kimenete javaslatok, dilemmák, foglalatlan igények
 * és figyelmeztetések. A dilemmák újraszámolódnak, ezért a döntések igényekre és
 * helyekre hivatkoznak, nem dilemma-azonosítóra (TRV-08, TRV-12).
 */

export type RequestKind = 'flight' | 'simulator' | 'theory'

export interface Durations {
  readonly briefing: Minutes
  /** Repülésnél és szimulátornál a gépidő, elméletnél az óra hossza. */
  readonly main: Minutes
  readonly debriefing: Minutes
}

/** Időablak a foglalás kezdetére: `start` ≤ kezdés ≤ `end` (azonos értéknél pontos kezdés). */
export interface TimeWindow {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
}

/**
 * Fix időpont vagy időablakok (TRV-02). Időpont nélkül az elmélet rossz időre kerül (TRV-03).
 * Több ablak is lehet (például „kedd 9–12, csütörtök 14–18” kezdéssel); a motor az ablakban
 * kezdődő helyek közül választ, ha van elfogadható. `onlyWithin`: az ablakokon kívül egyáltalán nem helyezheti
 * el (kizáró feltétel, `timeWindow`), csak a kényszerítés hozhatja ki onnan.
 */
export type RequestTiming =
  | { readonly kind: 'fixed'; readonly start: IsoDateTime }
  | { readonly kind: 'preferred'; readonly windows: readonly TimeWindow[]; readonly onlyWithin?: boolean }

/** Foglalási igény: egy elhelyezendő tétel (4. fejezet, TRV-20, TRV-21). */
/**
 * Honnan jön a briefing és a debriefing ideje: a beállítások alapértékéből (alapból), a
 * FlightLogger-feladatból, vagy kézzel megadva. A repülés ideje mindig a feladatból jön.
 */
export type BriefingSource = 'default' | 'lecture' | 'manual'

/**
 * Az elmélet fajtája a FlightLogger elméleti foglalástípusai szerint (FLI-01): Meeting (megbeszélés
 * résztvevőkkel, oktató mező nélkül; alapértelmezett), Ground training (osztály- vagy
 * csoportelmélet programmal és tárggyal) vagy Extra theory (egy növendék).
 */
export type TheoryType = 'groundTraining' | 'extraTheory' | 'meeting'

export const DEFAULT_THEORY_TYPE: TheoryType = 'meeting'

/** A Ground training „Session type” választója a FlightLoggerben (alapból Ground lesson). */
export const FL_SESSION_TYPES = ['Ground lesson', 'Progress test', 'Theory release', 'Exam', 'Written progress test'] as const
export type FlSessionType = (typeof FL_SESSION_TYPES)[number]

/**
 * Az elméleti foglalás FlightLogger-mezői, amelyeket az import kitölt (FLI-11): a program (revízió)
 * és a tárgy (Subject) a FlightLogger programlistájából, Ground trainingnél a Session type és a
 * Session is. A felirat is tárolódik (programnév, nem személyes adat), így az import a programlista
 * nélkül is ki tudja tölteni; az osztály az igény `classId` mezője.
 */
export interface FlTheoryFields {
  readonly programRevisionId?: string
  /** A program felirata a FlightLogger listájában: „ATP(A) Integrated Ground School Revision 6”. */
  readonly program?: string
  readonly subjectId?: string
  readonly subject?: string
  readonly sessionType?: FlSessionType
  readonly session?: string
}

/** Az elméleti igény típusa; régi (típus nélküli) igénynél az alapértelmezett. */
export function theoryTypeOf(request: Pick<BookingRequest, 'theoryType'>): TheoryType {
  return request.theoryType ?? DEFAULT_THEORY_TYPE
}

export interface BookingRequest {
  readonly id: string
  readonly kind: RequestKind
  /** Repülésnél és szimulátornál egy növendék, elméletnél több is. */
  readonly studentIds: readonly string[]
  /** Egész osztály (SZB-09, 2. kör); az adatmodell már tartalmazza. */
  readonly classId?: string
  /** FlightLogger-feladat (Lecture), ha van (SZB-02, 7.5). */
  readonly lectureId?: string
  /** Elméletnél a FlightLogger-foglalás típusa (FLI-01); hiányában Meeting. */
  readonly theoryType?: TheoryType
  /** Elméletnél a FlightLogger-ablak további mezői (FLI-11). */
  readonly flTheory?: FlTheoryFields
  readonly taskSelectionMode: TaskSelectionMode
  readonly durations: Durations
  /** A briefing és a debriefing forrása; hiányában az alapérték (`default`). */
  readonly briefingSource?: BriefingSource
  readonly timing?: RequestTiming
  /**
   * Repülésnél a napszak: egy repülés vagy nappali, vagy éjszakai, harmadik eset nincs.
   * `true`: nappali, a repülés napkelte és napnyugta közé esik (SZB-12);
   * `false`: éjszakai, a repülés az esti polgári szürkület után (vagy a hajnali előtt) zajlik.
   * Szimulátornál és elméletnél nincs jelentése (`false`).
   */
  readonly daylightOnly: boolean
  /**
   * Útvonalas repülés (K27, SZB-19): az érintett repülőterek, ahol az időjárást is nézni kell.
   * Hiányában helyi repülés, csak a bázis időjárása számít.
   */
  readonly route?: FlightRoute
  readonly preferredClassroomId?: string
  /**
   * Közös briefing csapat (KBR-01, KBR-05): a csapat tagjai azonos időben kezdenek, közös
   * briefinggel, egymás után repülnek, és a végén közös a debriefing. A tagság csak itt tárolódik;
   * a csapat az, akik ezt viselik (a heti tervezet `briefingTeams` listája csak a nevét adja).
   */
  readonly briefingTeamId?: string
  /**
   * Elsőbbség (ELS-01): 1 a legfontosabb, 5 a legkevésbé fontos. A motor elsőbbségi sorrendben
   * helyez el, az alacsonyabb elsőbbségű igény nem veheti el a magasabb elsőbbségű helyét (ELS-02).
   * Hiányában a beállítások alapértéke (`defaults.requestPriority`, alapból 1).
   */
  readonly priority?: number
  readonly origin: 'progress' | 'manual' | 'deferred'
  /** Halasztott igénynél az eredeti hét hétfője (TRV-17). */
  readonly deferredFromWeek?: LocalDate
  readonly note?: string
}

/**
 * Az elmélet létszáma a teremhez: a résztvevő növendékek és az oktató (aki szintén a
 * teremben van). A terem férőhelyét ehhez kell mérni (ERF-07).
 */
export function theoryHeadcount(request: Pick<BookingRequest, 'studentIds'>): number {
  return request.studentIds.length + 1
}

/** Meglévő FlightLogger-foglalás a pillanatképben, a tervezéshez szükséges mezőkkel. */
export interface ExistingBooking {
  readonly id: string
  readonly type:
    | 'singleStudent'
    | 'multiStudent'
    | 'classTheory'
    | 'theory'
    | 'maintenance'
    | 'operation'
    | 'meeting'
    | 'rental'
    | 'other'
  readonly status: 'OPEN' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'CANCELLED'
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly flightStart?: IsoDateTime
  readonly flightEnd?: IsoDateTime
  readonly resourceId?: string
  readonly classroomId?: string
  readonly instructorId?: string
  /** Elméletnél az osztály, ha osztálynak szól (a rögzített elmélet párosításához). */
  readonly classId?: string
  /** Minden résztvevő: növendék, személyzet, megbeszélés résztvevői. */
  readonly participantIds: readonly string[]
  /**
   * Karbantartási foglalásnál a fajta a komment szerint (50, 100 vagy 200 órás, Q8). Csak a
   * fajtás karbantartás indítja újra a gépóra-keretet; a többi (javítás) csak lezárja a gépet.
   */
  readonly maintenanceLevel?: 50 | 100 | 200
  /** A FlightLogger-foglalás színe, ha van (9.5). */
  readonly color?: string
  /**
   * A foglalásra tervezett feladat neve (Lecture), ha van. Az automatikus feladatválasztás
   * a már lefoglalt jövőbeli feladatokat átugorja (7.5); a párosítás a név kódja szerint megy.
   */
  readonly plannedLectureName?: string
  /**
   * A foglalásra tervezett feladat azonosítója (Lecture), ha van. Ezzel ismerhető fel a
   * FlightLoggerben áthelyezett vagy rögzítettnek nem jelölt foglalás igénye (9.6).
   * Egynövendékes foglalásnál van; a többnövendékesnél a feladat növendékenként a `lessons`-ben.
   */
  readonly lectureId?: string
  /**
   * Repülési foglalásnál a növendékek a FlightLogger sorrendjében (Student 1, Student 2), a
   * tervezett feladatukkal, ha van (KBR-10). A megfigyelők nincsenek benne.
   */
  readonly lessons?: readonly BookingLesson[]
  /** Repülési foglalás megfigyelői (observer): a foglalásban vannak, de nem repülnek. */
  readonly observerIds?: readonly string[]
}

/** Egy növendék a repülési foglaláson, a tervezett feladatával. */
export interface BookingLesson {
  readonly studentId: string
  readonly lectureId?: string
  readonly lectureName?: string
  /** A feladat tervezett repült (vagy szimulátoros) ideje percben, ha ismert. */
  readonly flightMinutes?: number
}

/** Egy feltétel hozzájárulása a ponthoz, a „Miért ide?” magyarázathoz (9.5). */
export interface ScoreFactor {
  readonly criterion: Criterion
  readonly weight: number
  /** Részpont 0 és 1 között. */
  readonly subScore: number
}

export type WarningKind =
  | 'limitApproach'
  | 'limitExceeded'
  | 'doubleBooking'
  | 'outsideAvailability'
  | 'blockedPeriod'
  | 'hardConstraintOverridden'
  | 'longNoFly'
  | 'staleData'
  | 'bookingBlockedByFlightLogger'
  /** A gép kirepülhető kerete a héten elfogy, várható karbantartás (SZB-06). */
  | 'maintenanceDue'
  /** Zivatarveszély az előrejelzés szerint (H19, Q11): jelzés és pontlevonás. */
  | 'weatherRisk'
  /** Közös briefing csapat (KBR-06): egy főre fogyott, vegyes feladatú, vagy a tag nem lehet benne. */
  | 'team'
  /** Nincs megadva ráérés, vagy hiányzik más adat, amelyet a motor szabadnak vesz (A6). */
  | 'missingData'

export interface PlanWarning {
  readonly kind: WarningKind
  readonly message: string
  readonly requestId?: string
  readonly ruleId?: string
}

export interface Slot {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly flightStart?: IsoDateTime
  readonly flightEnd?: IsoDateTime
  readonly resourceId?: string
  readonly classroomId?: string
}

/** Foglalásjavaslat (4. fejezet). */
export interface Proposal {
  readonly requestId: string
  readonly slot: Slot
  /** Súlyozott átlag 0 és 100 között. */
  readonly score: number
  readonly factors: readonly ScoreFactor[]
  readonly warnings: readonly PlanWarning[]
  readonly standby: boolean
  /** Ki döntött: a motor egyértelmű helyzetben, az oktató, vagy a „döntse el a rendszer” (9.3). */
  readonly decidedBy: 'engine' | 'instructor' | 'autoResolved'
  /** Ha a hely egy nyitott dilemma ajánlása: a dilemma azonosítója (ideiglenes elhelyezés). */
  readonly dilemmaId?: string
  /** Feltételezés: egymást követő feladatoknál a korábbi sikere (7.5). */
  readonly assumptions: readonly string[]
  readonly comment?: string
  /** Standby elméletnél a párosított repülés igénye (H06). */
  readonly pairedRequestId?: string
  /** Közös briefing csapat tagjaként került ide (KBR-01): a kezdés és a vég a csapaté. */
  readonly teamId?: string
  /** A FlightLoggerbe már rögzítve, de a frissítés még nem hozta le (H02): a hely le van zárva. */
  readonly recorded?: boolean
  /**
   * FlightLogger-jelölés (9.7): az igénynek már van FlightLogger-foglalása, amelyet erre a
   * (tervezett) helyre kell átírni. `from`: a foglalás mostani helye (ha még megvan).
   */
  readonly change?: { readonly kind: 'move'; readonly bookingId: string; readonly from?: Slot }
}

export type DilemmaType = 'competition' | 'warningSlot' | 'noSlot' | 'fixedConflict' | 'lowAttendance' | 'standby' | 'team'

/** A kizáró feltételek fajtái: indokláshoz és kézi felülbíráláshoz (TRV-16, 9.2). */
export type HardCode =
  | 'past'
  | 'window'
  | 'blocked'
  | 'resource'
  | 'roomSize'
  | 'daylight'
  | 'night'
  | 'weather'
  | 'instructorBusy'
  | 'studentBusy'
  | 'aircraftBusy'
  | 'roomBusy'
  | 'reserve'
  | 'timeWindow'
  /** A növendék automatikus feladatainak sorrendje (ELS-05): a későbbi nem előzheti meg a korábbit. */
  | 'order'

export interface DilemmaOption {
  readonly id: string
  readonly label: string
  readonly pros: readonly string[]
  readonly cons: readonly string[]
  readonly consequence: string
  /** Az a döntés, amelyet ez a lehetőség rögzít. */
  readonly decision: Decision
  /** Csapatnál a többi tag döntése (KBR-07): a lehetőség ezeket is rögzíti, a `decision` után. */
  readonly also?: readonly Decision[]
}

/** Dilemma (9.1, 9.2): ajánlással és pro-kontra érvekkel. */
export interface Dilemma {
  readonly id: string
  readonly type: DilemmaType
  readonly requestIds: readonly string[]
  readonly question: string
  readonly summary: string
  /** Rövid, egy mondatos összefoglaló a felületnek; a részletek a `summary`-ben. */
  readonly headline?: string
  /** „Nincs hely” dilemmánál: mely kizáró feltétel hány jelölt helyet zárt ki. */
  readonly blockers?: ReadonlyArray<{ readonly code: HardCode; readonly count: number }>
  readonly recommendedOptionId: string
  readonly options: readonly DilemmaOption[]
  /** Rangsoroláshoz: a legnagyobb hatású döntés kerül előre (9.3). */
  readonly impact: number
}

/** Oktatói döntés (TRV-06, 9.2). A lista sorrendje számít; visszavonás = elhagyás (TRV-12). */
export type Decision =
  | {
      readonly kind: 'assign'
      readonly requestId: string
      readonly slot: Slot
      readonly acceptWarnings: boolean
      /** A „döntse el a rendszer” gomb hozta (9.3); a tervezet külön jelöli. */
      readonly auto?: boolean
      /** A tervezeten végzett kézi mozgatás (TRV-10), nem dilemma-válasz. */
      readonly fromDraft?: boolean
      readonly comment?: string
      /**
       * Közös briefing csapat elhelyezése (KBR-07): a `slot.start` a csapat közös kezdése, a
       * `slot.resourceId` a tag gépe; a többi idő a csapat elrendezéséből jön.
       */
      readonly team?: string
    }
  | {
      readonly kind: 'standby'
      readonly requestId: string
      /** A standby terme és ideje a döntéskor; a párosított repüléssel együtt mozog. */
      readonly slot: Slot
      /** A repülés, amely mellé a standby elmélet kerül (H06). */
      readonly pairedRequestId?: string
      readonly auto?: boolean
      readonly comment?: string
    }
  | { readonly kind: 'defer'; readonly requestId: string; readonly auto?: boolean }
  /** Ehhez az elmélethez az oktató nem kér standbyt (H05). */
  | { readonly kind: 'noStandby'; readonly requestId: string; readonly auto?: boolean }
  /** A csapattag ezen a héten egyénileg tervezett (KBR-07); a tagsága megmarad. */
  | { readonly kind: 'teamOff'; readonly requestId: string; readonly auto?: boolean }
  | { readonly kind: 'avoidSlot'; readonly requestId: string; readonly slot: Slot }
  | { readonly kind: 'comment'; readonly requestId: string; readonly comment: string }

/** Egy FlightLogger-foglalás a közös briefing csapatban: pár (multi student) vagy egyéni (KBR-02). */
export interface TeamUnit {
  readonly requestIds: readonly string[]
  readonly bookingType: 'multiStudent' | 'singleStudent'
  readonly resourceId?: string
  readonly flightStart: IsoDateTime
  readonly flightEnd: IsoDateTime
}

/** Közös briefing csapat a tervben (KBR-01). */
export interface PlannedTeam {
  readonly teamId: string
  /** A tervezett tagok a repülés sorrendjében. */
  readonly requestIds: readonly string[]
  /**
   * `placed`: a terv része (a motor vagy a döntés helyezte el); `unplaced`: egyben nem fér be, a
   * tagok dilemmára várnak.
   */
  readonly state: 'placed' | 'unplaced'
  /** A közös kezdés és vég (a briefing elejétől a közös debriefing végéig). */
  readonly start?: IsoDateTime
  readonly end?: IsoDateTime
  readonly units: readonly TeamUnit[]
}

export interface UnplacedRequest {
  readonly requestId: string
  readonly reason: string
  /** Ajánlott, felülírható időpont (TRV-16). */
  readonly suggestion?: Slot
}

export interface DecisionIssue {
  readonly decisionIndex: number
  readonly message: string
}

export interface PlanResult {
  readonly proposals: readonly Proposal[]
  readonly dilemmas: readonly Dilemma[]
  readonly unplaced: readonly UnplacedRequest[]
  /** Későbbre halasztott igények (TRV-17); a következő heti listába kerülnek. */
  readonly deferred: readonly string[]
  readonly warnings: readonly PlanWarning[]
  /** Döntések, amelyek egy korábbi döntés miatt nem alkalmazhatók (TRV-12). */
  readonly decisionIssues: readonly DecisionIssue[]
  /** A közös briefing csapatok (KBR-01): legalább két tervezett taggal. */
  readonly teams: readonly PlannedTeam[]
  /**
   * Az igények, amelyekhez a FlightLoggerben már van foglalás (H02, 9.6): ezeket a motor nem
   * tervezi újra, a helyüket a FlightLogger-foglalás foglalja.
   */
  readonly recordedInFlightLogger: readonly BookedInFlightLogger[]
  /**
   * Rögzítettnek jelölt igények, amelyeknek a foglalása a (rögzítésnél frissebb) adatban nincs
   * meg (9.6, eltérés). A helyük addig le van zárva, amíg az oktató nem dönt róluk.
   */
  readonly missingInFlightLogger: readonly string[]
  /** A hiányzók közül, amelyeknek a foglalását a FlightLoggerben lemondták (`CANCELLED`). */
  readonly cancelledInFlightLogger: readonly string[]
  /**
   * Áthelyezettnek jelölt foglalások régi FlightLogger-azonosítója: a frissítésig a régi helyük
   * nem foglal, és a tervezet sem mutatja.
   */
  readonly supersededBookings: readonly string[]
  /** Áthelyezendőnek jelölt igények (9.7), elhelyezve vagy sem; `from`: a foglalás mostani helye. */
  readonly plannedMoves: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string; readonly from?: Slot }>
  /**
   * Lemondandónak jelölt igények (9.7): az igény halasztott, a FlightLogger-foglalását le kell
   * mondani. `done`: az oktató jelezte, hogy lemondta, a frissítés még nem hozta le.
   */
  readonly plannedCancels: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string; readonly slot: Slot; readonly done: boolean }>
  /** A frissítés szerint a FlightLoggerben már elvégzett tervbe tett változtatások. */
  readonly completedChanges: ReadonlyArray<{ readonly requestId: string; readonly kind: 'move' | 'cancel'; readonly bookingId: string; readonly slot?: Slot }>
  /** Halasztott igények, amelyeknek a foglalása a legutóbbi frissítés szerint még megvan. */
  readonly deferredStillBooked: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string; readonly slot: Slot }>
}

/** Egy igény FlightLogger-foglalása (9.6 párosítás). */
export interface BookedInFlightLogger {
  readonly requestId: string
  readonly bookingId: string
  /** A FlightLogger-foglalás helye a legutóbbi frissítés szerint. */
  readonly slot: Slot
  /** Rögzítettnek jelölés nélkül ismerte fel a növendék és a feladat alapján. */
  readonly detected?: boolean
  /** Rögzített igénynél: a FlightLoggerben máshol van, mint ahová rögzítetted. */
  readonly moved?: boolean
}
