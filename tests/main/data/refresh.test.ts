import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import { createAllowedFetch } from '../../../src/main/net/allowedFetch'
import { FlightLoggerClient } from '../../../src/main/net/flightLogger/client'
import { CATALOG_FULL_REFRESH_DAYS, HISTORY_FULL_REFRESH_DAYS, refreshLive, splitRange, type HistoryCache, type LectureCatalogCache } from '../../../src/main/data/refresh'
import { respond, SYNTHETIC, syntheticNow } from '../../fixtures/syntheticFlightLogger'

describe('élő adatfrissítés szintetikus szerverrel (ADT-01–07)', () => {
  const server = (failing: string[] = []) =>
    createAllowedFetch(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
      if (failing.includes(body.operationName)) return new Response(JSON.stringify({ errors: [{ message: 'szintetikus hiba' }] }))
      return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
    })
  const settings = {
    ...createDefaultSettings(),
    airport: { icaoCode: 'XXXX', latitude: 1, longitude: 2, timezone: 'Europe/Budapest', runways: [{ designator: '04', trueHeadingDeg: 41 }], openingHours: createDefaultSettings().instructor.workWindows },
    students: [{ userId: 'u-novendek-1', allowedResources: [] }],
  }
  const forecast = async () => ({
    latitude: 1,
    longitude: 2,
    hourly: { time: ['2026-11-16T07:00'], wind_speed_10m: [5] },
    daily: { time: ['2026-11-16'], sunrise: ['2026-11-16T05:50'], sunset: ['2026-11-16T15:10'] },
  })

  it('pillanatképet és névjegyzéket épít', async () => {
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: server() })
    const bundle = await refreshLive({ client, fetchForecast: forecast, now: syntheticNow() }, settings, '2026-11-16')
    expect(bundle.source).toBe('live')
    expect(bundle.snapshot.instructorId).toBe(SYNTHETIC.viewerId)
    expect(bundle.snapshot.fleet.map((a) => a.id)).toEqual(['a1', 'a2', 's1'])
    expect(bundle.snapshot.bookings.length).toBeGreaterThan(0)
    expect(bundle.snapshot.lastFlightAt).toHaveProperty('u-novendek-1')
    expect(bundle.snapshot.weather).toHaveLength(1)
    expect(bundle.directory.people['u-novendek-1']?.name).toBe('Kitalált Kornélia')
    expect(bundle.errors).toEqual([])
  })

  it('egy rész hibája nem állítja meg a többit', async () => {
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: server(['Bookings', 'Flights']) })
    const bundle = await refreshLive({ client, fetchForecast: forecast, now: syntheticNow() }, settings, '2026-11-16')
    expect(bundle.snapshot.bookings).toEqual([])
    expect(bundle.errors.map((e) => e.split(':')[0])).toEqual(['Foglalások', 'Korábbi foglalások', 'Repülések'])
    expect(bundle.snapshot.fleet).toHaveLength(3)
  })

  it('első beállításnál csak a névjegyzéket tölti, foglalást és haladást nem kér, és jelzi az előrehaladást', async () => {
    const asked: string[] = []
    const fetch = createAllowedFetch(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
      asked.push(body.operationName)
      return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
    })
    const steps: Array<{ stage: string; done: number; total: number }> = []
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch })
    const bundle = await refreshLive({ client, fetchForecast: forecast, now: syntheticNow(), scope: 'directory', onProgress: (t) => steps.push(t) }, settings, '2026-11-16')
    expect(bundle.snapshot.fleet).toHaveLength(3)
    expect(bundle.directory.people['u-novendek-1']?.name).toBe('Kitalált Kornélia')
    expect(bundle.snapshot.bookings).toEqual([])
    expect([...new Set(asked)].sort()).toEqual(['Aircraft', 'Classes', 'Classrooms', 'UsersByRole', 'Viewer'])
    // A részek párhuzamosan futnak: az előrehaladás a futókat és a készek számát mutatja.
    expect(steps[0]?.stage).toBe('Kapcsolódás a FlightLoggerhez')
    for (const part of ['Gépek', 'Termek', 'Növendékek', 'Oktatók', 'Osztályok']) expect(steps.some((t) => t.stage.includes(part))).toBe(true)
    expect(steps.at(-1)).toEqual({ stage: '', done: 5, total: 5 })
  })

  describe('foglalások időablaka (ADT-01–03, H09)', () => {
    const bookingCallsFor = async (weekStart: string, now: Date): Promise<Array<Record<string, unknown>>> => {
      const calls: Array<Record<string, unknown>> = []
      const fetch = createAllowedFetch(async (_url, init) => {
        const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
        if (body.operationName === 'Bookings') calls.push(body.variables)
        return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
      })
      const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch })
      await refreshLive({ client, fetchForecast: forecast, now }, settings, weekStart)
      return calls
    }
    const day = 86_400_000
    const weekStartMs = Date.parse('2026-11-15T23:00:00Z')
    const range = (c: Record<string, unknown> | undefined): [number, number] => [Date.parse(c?.['from'] as string), Date.parse(c?.['to'] as string)]

    it('jövőbeli hétnél a hét előtti naptól kér, és külön a 28 napos visszatekintést (H09)', async () => {
      const now = new Date('2026-11-10T09:00:00Z')
      const calls = await bookingCallsFor('2026-11-16', now)
      expect(calls).toHaveLength(2)
      for (const c of calls) expect(c['all']).toBe(true)
      const [current, past] = [...calls].sort((x, y) => range(y)[0] - range(x)[0])
      expect(range(current)).toEqual([Date.parse('2026-11-14T23:00:00Z'), Date.parse('2026-11-22T23:00:00Z') + day])
      // A visszatekintés a hét előtt 28 nappal kezd, és ott ér véget, ahol a heti ablak kezdődik.
      expect(range(past)).toEqual([weekStartMs - 28 * day, Date.parse('2026-11-14T23:00:00Z')])
    })

    it('a folyamatban lévő hétnél a mostani időponttól kér, a korábbi rész a visszatekintésből jön', async () => {
      const now = new Date('2026-11-18T12:34:00Z')
      const calls = await bookingCallsFor('2026-11-16', now)
      expect(calls).toHaveLength(2)
      const [current, past] = [...calls].sort((x, y) => range(y)[0] - range(x)[0])
      expect(range(current)[0]).toBe(now.getTime())
      expect(range(past)).toEqual([weekStartMs - 28 * day, now.getTime()])
    })

    it('teljesen elmúlt hétnél csak a visszatekintést kéri (a hét végéig)', async () => {
      const now = new Date('2026-12-01T12:00:00Z')
      const calls = await bookingCallsFor('2026-11-16', now)
      expect(calls).toHaveLength(1)
      expect(range(calls[0])).toEqual([weekStartMs - 28 * day, Date.parse('2026-11-22T23:00:00Z')])
    })
  })

  it('a pillanatkép nem tartalmaz kommentet', async () => {
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: server() })
    const bundle = await refreshLive({ client, fetchForecast: forecast, now: syntheticNow() }, settings, '2026-11-16')
    expect(JSON.stringify(bundle.snapshot)).not.toContain(SYNTHETIC.secretComment)
  })

  describe('gyorsítás minőségvesztés nélkül', () => {
    const day = 86_400_000
    const recordingServer = () => {
      const calls: Array<{ op: string; variables: Record<string, unknown> }> = []
      const fetch = createAllowedFetch(async (_url, init) => {
        const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
        calls.push({ op: body.operationName, variables: body.variables ?? {} })
        return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
      })
      return { calls, client: new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch }) }
    }
    const memoryCache = (initial?: LectureCatalogCache) => {
      const store = { value: initial, load: async () => store.value, save: async (c: LectureCatalogCache) => void (store.value = c) }
      return store
    }

    it('a darabolt időablak lefedi az eredetit, és a határon átfed', () => {
      const ranges = splitRange(0, 8 * day, 4)
      expect(ranges[0]![0]).toBe(0)
      expect(ranges.at(-1)![1]).toBe(8 * day)
      for (let i = 1; i < ranges.length; i++) expect(ranges[i - 1]![1]).toBeGreaterThan(ranges[i]![0])
      expect(ranges.every(([from, to]) => from >= 0 && to <= 8 * day)).toBe(true)
    })

    it('gyorsítótár nélkül két évet kér le darabolva, és elmenti a katalógust', async () => {
      const { calls, client } = recordingServer()
      const cache = memoryCache()
      const now = syntheticNow()
      const bundle = await refreshLive({ client, fetchForecast: forecast, now, catalogCache: cache }, settings, '2026-11-16')
      const catalogCalls = calls.filter((c) => c.op === 'TrainingLectures')
      expect(catalogCalls.length).toBeGreaterThan(1)
      expect(Math.min(...catalogCalls.map((c) => Date.parse(c.variables['from'] as string)))).toBe(now.getTime() - 730 * day)
      expect(Math.max(...catalogCalls.map((c) => Date.parse(c.variables['to'] as string)))).toBe(now.getTime())
      expect(cache.value?.lectures.map((l) => l.id)).toEqual(['l1'])
      expect(bundle.directory.lectures['l1']).toBeDefined()
      expect(bundle.errors).toEqual([])
    })

    it('friss gyorsítótárnál csak a változásokat kéri, és a régi feladatok megmaradnak', async () => {
      const { calls, client } = recordingServer()
      const now = syntheticNow()
      const fetchedAt = new Date(now.getTime() - day).toISOString()
      const cache = memoryCache({ fetchedAt, lectures: [{ id: 'regi', name: 'Korábbi feladat', briefingMinutes: 30, flightMinutes: 60, debriefingMinutes: 15, simulator: false, night: false }] })
      const bundle = await refreshLive({ client, fetchForecast: forecast, now, catalogCache: cache }, settings, '2026-11-16')
      const catalogCalls = calls.filter((c) => c.op === 'TrainingLectures')
      expect(catalogCalls).toHaveLength(1)
      expect(catalogCalls[0]!.variables['changedAfter']).toBeDefined()
      expect(Date.parse(catalogCalls[0]!.variables['changedAfter'] as string)).toBeLessThan(Date.parse(fetchedAt))
      expect(catalogCalls[0]!.variables['from']).toBeUndefined()
      expect(Object.keys(bundle.directory.lectures)).toEqual(expect.arrayContaining(['l1', 'regi']))
      expect(cache.value?.lectures.map((l) => l.id).sort()).toEqual(['l1', 'regi'])
    })

    it(`${CATALOG_FULL_REFRESH_DAYS} napnál régebbi gyorsítótárnál újra teljesen letölt`, async () => {
      const { calls, client } = recordingServer()
      const now = syntheticNow()
      const cache = memoryCache({ fetchedAt: new Date(now.getTime() - (CATALOG_FULL_REFRESH_DAYS + 1) * day).toISOString(), lectures: [] })
      await refreshLive({ client, fetchForecast: forecast, now, catalogCache: cache }, settings, '2026-11-16')
      expect(calls.filter((c) => c.op === 'TrainingLectures').every((c) => c.variables['changedAfter'] === undefined)).toBe(true)
    })

    it('a növendékek haladását egy lekérdezéssel kéri, és a múltbeli repüléseiket a limitekhez átadja', async () => {
      const { calls, client } = recordingServer()
      const bundle = await refreshLive({ client, fetchForecast: forecast, now: syntheticNow() }, settings, '2026-11-16')
      expect(calls.filter((c) => c.op === 'Trainings').map((c) => c.variables['userIds'])).toEqual([['u-novendek-1']])
      expect(bundle.snapshot.studentFlights?.['u-novendek-1']).toHaveLength(1)
    })

    describe('haladás és saját repülések változás szerint (kevesebb kérés a kéréskorlátba)', () => {
      const historyStore = (initial?: HistoryCache) => {
        const store = { value: initial, load: async () => store.value, save: async (c: HistoryCache) => void (store.value = c) }
        return store
      }
      const changedAfterOf = (calls: Array<{ op: string; variables: Record<string, unknown> }>, op: string) => calls.filter((c) => c.op === op).map((c) => c.variables['changedAfter'])

      it('először teljesen letölt és elment, utána csak a változásokat kéri, ugyanazzal az eredménnyel', async () => {
        const historyCache = historyStore()
        const now = syntheticNow()
        const first = recordingServer()
        const a = await refreshLive({ client: first.client, fetchForecast: forecast, now, historyCache }, settings, '2026-11-16')
        expect(changedAfterOf(first.calls, 'Trainings')).toEqual([undefined])
        expect(changedAfterOf(first.calls, 'Flights')).toEqual([undefined])
        expect(historyCache.value?.trainings?.userIds).toEqual(['u-novendek-1'])
        expect(historyCache.value?.flights).toBeDefined()

        const second = recordingServer()
        const b = await refreshLive({ client: second.client, fetchForecast: forecast, now: new Date(now.getTime() + 60_000), historyCache }, settings, '2026-11-16')
        for (const op of ['Trainings', 'Flights']) {
          const since = changedAfterOf(second.calls, op)
          expect(since).toHaveLength(1)
          expect(Date.parse(since[0] as string)).toBeLessThan(now.getTime())
        }
        expect(b.snapshot.lastFlightAt).toEqual(a.snapshot.lastFlightAt)
        expect(b.snapshot.studentFlights).toEqual(a.snapshot.studentFlights)
        expect(b.snapshot.instructorFlights).toEqual(a.snapshot.instructorFlights)
        expect(b.progress).toEqual(a.progress)
      })

      it('új növendéknél a haladást teljesen újratölti', async () => {
        const historyCache = historyStore()
        const now = syntheticNow()
        await refreshLive({ client: recordingServer().client, fetchForecast: forecast, now, historyCache }, settings, '2026-11-16')
        const more = { ...settings, students: [...settings.students, { userId: 'u-uj', allowedResources: [] }] }
        const next = recordingServer()
        await refreshLive({ client: next.client, fetchForecast: forecast, now, historyCache }, more, '2026-11-16')
        expect(changedAfterOf(next.calls, 'Trainings')).toEqual([undefined])
        expect(historyCache.value?.trainings?.userIds).toEqual(['u-novendek-1', 'u-uj'])
      })

      it(`${HISTORY_FULL_REFRESH_DAYS} napnál régebbi teljes letöltés után újra teljesen letölt (a törlések miatt)`, async () => {
        const now = syntheticNow()
        const old = new Date(now.getTime() - (HISTORY_FULL_REFRESH_DAYS + 1) * day).toISOString()
        const historyCache = historyStore({ trainings: { fullAt: old, fetchedAt: old, items: [], userIds: ['u-novendek-1'] }, flights: { fullAt: old, fetchedAt: old, items: [] } })
        const { calls, client } = recordingServer()
        await refreshLive({ client, fetchForecast: forecast, now, historyCache }, settings, '2026-11-16')
        expect(changedAfterOf(calls, 'Trainings')).toEqual([undefined])
        expect(changedAfterOf(calls, 'Flights')).toEqual([undefined])
      })
    })

    it('a névjegyzéket a memóriából veszi, és csak a változásokat kéri le', async () => {
      const userCache = {}
      const first = recordingServer()
      const now = syntheticNow()
      await refreshLive({ client: first.client, fetchForecast: forecast, now, userCache }, settings, '2026-11-16')
      expect(first.calls.filter((c) => c.op === 'UsersByRole').every((c) => c.variables['changedAfter'] === undefined)).toBe(true)
      const second = recordingServer()
      const bundle = await refreshLive({ client: second.client, fetchForecast: forecast, now: new Date(now.getTime() + 60_000), userCache }, settings, '2026-11-16')
      const userCalls = second.calls.filter((c) => c.op === 'UsersByRole')
      expect(userCalls).toHaveLength(2)
      expect(userCalls.every((c) => typeof c.variables['changedAfter'] === 'string')).toBe(true)
      expect(bundle.directory.people['u-novendek-1']?.name).toBe('Kitalált Kornélia')
    })
  })
})

describe('feladatkatalógus: túl nagy időablak (lapszám-korlát)', () => {
  it('a korlátot elérő részt kettébontja, és így is mindent letölt', async () => {
    const { FlightLoggerPageLimitError } = await import('../../../src/main/net/flightLogger/client')
    const { refreshLive: refresh } = await import('../../../src/main/data/refresh')
    const ranges: Array<[number, number]> = []
    let failures = 0
    // Ál-kliens: a 100 napnál hosszabb ablakra lapszám-korlátot jelez.
    const client = {
      query: async () => ({ user: { id: 'u-oktato' } }),
      fetchAll: async (query: { name: string }, vars: Record<string, unknown>) => {
        if (query.name !== 'TrainingLectures') return []
        const from = Date.parse(vars['from'] as string)
        const to = Date.parse(vars['to'] as string)
        if (to - from > 100 * 86_400_000) {
          failures++
          throw new FlightLoggerPageLimitError('TrainingLectures', 200)
        }
        ranges.push([from, to])
        return []
      },
    }
    const s = { ...(await import('../../../src/core/config/defaults')).createDefaultSettings(), students: [] }
    const bundle = await refresh({ client: client as never, fetchForecast: async () => ({}) as never, now: new Date('2026-11-12T10:00:00Z') }, s, '2026-11-16')
    expect(failures).toBeGreaterThan(0)
    expect(bundle.errors.filter((e) => e.startsWith('Feladatlista'))).toEqual([])
    // A részek lefedik a két évet.
    const covered = ranges.reduce((sum, [f, t]) => sum + (t - f), 0)
    expect(covered).toBeGreaterThanOrEqual(730 * 86_400_000)
  })
})

describe('korábbi foglalások: a legutóbbi letöltéskor még jövőbeli szakasz (H09, fizetett idő)', () => {
  const settings = { ...createDefaultSettings(), dataSource: 'live' as const, students: [{ userId: 'u-novendek-1', allowedResources: [] }] }
  const forecast = async () => ({ latitude: 47, longitude: 21, elevation: 0, timezone: 'Europe/Budapest', utc_offset_seconds: 3600, hourly: { time: [] } })
  const hour = 3_600_000
  const NOW = syntheticNow().getTime()
  // A foglalás az első letöltéskor még jövőbeli, utána nem változik (a változás szerinti lekérdezés nem adná vissza).
  const flown = {
    __typename: 'SingleStudentBooking',
    id: 'b-later',
    startsAt: new Date(NOW + 10 * hour).toISOString(),
    endsAt: new Date(NOW + 12 * hour).toISOString(),
    flightStartsAt: new Date(NOW + 10.5 * hour).toISOString(),
    flightEndsAt: new Date(NOW + 11.5 * hour).toISOString(),
    status: 'OPEN',
    comment: null,
    color: null,
    audit: { createdAt: new Date(NOW - 48 * hour).toISOString(), updatedAt: new Date(NOW - 48 * hour).toISOString(), createdById: SYNTHETIC.viewerId, updatedById: SYNTHETIC.viewerId },
    aircraft: { id: 'a1', callSign: 'HA-SZA' },
    instructor: { id: SYNTHETIC.viewerId },
    student: { id: 'u-novendek-1' },
    plannedLesson: null,
  }
  /** Ál-szerver: a foglalásokat időablak és változás szerint szűri, mint a FlightLogger. */
  const server = () =>
    new FlightLoggerClient({
      apiKey: SYNTHETIC.apiKey,
      fetch: createAllowedFetch(async (_url, init) => {
        const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
        const v = body.variables ?? {}
        if (body.operationName !== 'Bookings') return new Response(JSON.stringify({ data: respond(body.operationName, v) }))
        const from = Date.parse(v['from'] as string)
        const to = Date.parse(v['to'] as string)
        const since = typeof v['changedAfter'] === 'string' ? Date.parse(v['changedAfter']) : undefined
        const nodes = [flown].filter((b) => Date.parse(b.endsAt) > from && Date.parse(b.startsAt) < to && (since === undefined || Date.parse(b.audit.updatedAt) > since))
        return new Response(JSON.stringify({ data: { bookings: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } }))
      }),
    })

  it('a második letöltés a közben elmúlt szakaszt teljesen lekéri, így a változatlan foglalás sem vész el', async () => {
    const store: { value?: HistoryCache } = {}
    const historyCache = { load: async () => store.value, save: async (c: HistoryCache) => void (store.value = c) }
    const week = '2026-11-09'
    const first = await refreshLive({ client: server(), fetchForecast: forecast, now: new Date(NOW), historyCache }, settings, week)
    expect(first.snapshot.bookings.map((b) => b.id)).toEqual(['b-later'])
    expect(store.value?.pastBookings?.to).toBe(new Date(NOW).toISOString())
    const second = await refreshLive({ client: server(), fetchForecast: forecast, now: new Date(NOW + 24 * hour), historyCache }, settings, week)
    expect(second.snapshot.bookings.map((b) => b.id)).toEqual(['b-later'])
    expect(store.value?.pastBookings?.to).toBe(new Date(NOW + 24 * hour).toISOString())
  })
})
