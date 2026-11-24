import { describe, expect, it } from 'vitest'
import { createAllowedFetch } from '../../src/main/net/allowedFetch'
import { FlightLoggerClient } from '../../src/main/net/flightLogger/client'
import { runDiscovery, type DiscoveryResult } from '../../tools/discovery/checks'
import { renderReport } from '../../tools/discovery/report'
import { redactSensitive } from '../../tools/discovery/stats'
import { respond, SYNTHETIC, syntheticForecast, syntheticNow } from '../fixtures/syntheticFlightLogger'

async function runSynthetic(options: { probe?: boolean; weather?: boolean } = {}) {
  const fakeServer = createAllowedFetch(async (_url, init) => {
    const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
    return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
  })
  const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: fakeServer, sleep: async () => {} })
  const sensitive = new Set<string>([SYNTHETIC.apiKey])
  let savedSchema = ''
  const result = await runDiscovery(
    {
      client,
      now: syntheticNow(),
      pastDays: 14,
      futureDays: 21,
      ...(options.weather === false ? {} : { airport: { latitude: 1, longitude: 2 } }),
      ...(options.probe === false ? {} : { unpublishedProbe: new Date(SYNTHETIC.unpublishedStart) }),
      fetchForecast: async (request) => syntheticForecast(request.model) as never,
      saveSchema: async (sdl) => {
        savedSchema = sdl
        return 'docs/schema.graphql'
      },
      log: () => {},
    },
    sensitive,
  )
  const full: DiscoveryResult = { ...result }
  return { result: full, report: renderReport(full), json: JSON.stringify(full), sensitive, savedSchema }
}

describe('felderítés szintetikus adaton', () => {
  it('minden ellenőrzés lefut', async () => {
    const { result } = await runSynthetic()
    const statuses = Object.fromEntries(
      Object.entries(result)
        .filter(([, v]) => typeof v === 'object' && v !== null && 'status' in v)
        .map(([k, v]) => [k, (v as { status: string }).status]),
    )
    expect(statuses).toEqual({
      viewer: 'ok',
      schema: 'ok',
      aircraft: 'ok',
      bookings: 'ok',
      unpublished: 'ok',
      users: 'ok',
      availability: 'ok',
      classrooms: 'ok',
      programs: 'ok',
      progress: 'ok',
      flights: 'ok',
      logbook: 'ok',
      weather: 'ok',
    })
  })

  it('a jelentés és a JSON nem tartalmaz nevet, e-mailt, kommentet, azonosítót vagy kulcsot', async () => {
    const { report, json } = await runSynthetic()
    const forbidden = [
      SYNTHETIC.apiKey,
      SYNTHETIC.viewerId,
      SYNTHETIC.otherInstructorId,
      SYNTHETIC.secretComment,
      'proba@example.com',
      ...SYNTHETIC.students.flatMap((s) => [s.id, s.firstName, s.lastName, s.callSign]),
      ...SYNTHETIC.instructors.flatMap((s) => [s.id, s.firstName, s.lastName, s.callSign]),
      'Kitalált terem',
      'Kitalált osztály',
    ]
    for (const text of [report, json]) {
      for (const value of forbidden) expect(text, `nem szerepelhet: ${value}`).not.toContain(value)
    }
  })

  it('a látott neveket és kommenteket összegyűjti a kitakaráshoz', async () => {
    const { sensitive } = await runSynthetic()
    expect(sensitive).toContain(SYNTHETIC.secretComment)
    expect(sensitive).toContain('Kornélia')
    const { text, redactions } = redactSensitive(`x ${SYNTHETIC.secretComment} y Kornélia`, sensitive)
    expect(text).not.toContain('Kornélia')
    expect(text).not.toContain('example.com')
    expect(redactions).toBeGreaterThan(0)
  })

  it('a K02 kérdéseire a számokból következő első olvasatot adja', async () => {
    const { result, report } = await runSynthetic()
    const b = result.bookings.data!
    expect(b.own.total).toBe(3)
    expect(b.all.total).toBe(5)
    expect(b.all.otherInstructor).toBe(1)
    expect(b.ownStudentsBookingsWithOtherInstructor).toBe(1)
    expect(report).toContain('| K02 – Látszanak más oktatók foglalásai? | Igen, de egyes foglalásoknál az oktató rejtett |')
    expect(report).toContain('| K02 – Látszanak a növendékek más oktatóval tartott foglalásai? | Igen |')
  })

  it('felismeri, ha a timeLeft a szervizig hátralévő óra', async () => {
    const { result, report } = await runSynthetic()
    const rows = result.aircraft.data!.maintenance.filter((r) => r.aircraftClass !== 'SIMULATOR')
    expect(rows.map((r) => r.timeLeft)).toEqual([12.5, 3])
    expect(report).toContain('Valószínűleg a következő szervizig hátralévő óra')
  })

  it('megtalálja a megadott nem publikált teszt-foglalást, és jelzi, ha nincs megadva', async () => {
    const withProbe = await runSynthetic()
    expect(withProbe.result.unpublished.data!.matchesAll).toBe(1)
    expect(withProbe.report).toContain('Igen, megjelenik az API-ban')
    const withoutProbe = await runSynthetic({ probe: false })
    expect(withoutProbe.report).toContain('| Megjelennek a nem publikált foglalások? | Nem ellenőrizve |')
  })

  it('kiértékeli az ICON-D2 lefedettséget és a látástávolság forrását', async () => {
    const { report } = await runSynthetic()
    expect(report).toMatch(/Lefedi az ICON-D2 a repülőteret\? \| Igen, kb\. \d+ órára előre/)
    expect(report).toContain('Elérhető: best_match, icon_d2, icon_eu, icon_seamless')
    const noWeather = await runSynthetic({ weather: false })
    expect(noWeather.report).toContain('Nem adtál meg koordinátát.')
  })

  it('a sémát elmenti, és jelzi a vele nem egyező lekérdezéseket', async () => {
    const { result, savedSchema } = await runSynthetic()
    expect(savedSchema).toContain('type Query')
    expect(result.schema.data!.mutationFields).toBe(1)
    // A szintetikus séma szándékosan minimális, ezért a valódi lekérdezések nem érvényesek rajta.
    expect(Object.keys(result.schema.data!.validation)).toContain('Bookings')
  })

  it('érvénytelen kulcsnál a többi ellenőrzést kihagyja', async () => {
    const failing = createAllowedFetch(async () => new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] })))
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: failing })
    const result = await runDiscovery(
      {
        client,
        now: syntheticNow(),
        pastDays: 14,
        futureDays: 21,
        fetchForecast: async () => {
          throw new Error('nem hívható')
        },
        saveSchema: async () => '',
        log: () => {},
      },
      new Set(),
    )
    expect(result.viewer.status).toBe('hiba')
    expect(result.bookings.status).toBe('kihagyva')
    expect(renderReport(result)).toContain('Kihagyva')
  })
})

describe('logbook tartalék iskolai kulcsnál', () => {
  it('ha a myFlightLogger nem érhető el, a saját repülésekből számol', async () => {
    const fakeServer = createAllowedFetch(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { operationName: string; variables: Record<string, unknown> }
      if (body.operationName === 'LogbookEntries') {
        return new Response(JSON.stringify({ errors: [{ message: 'my|FlightLogger data cannot be queried using an account-specific API key.' }] }))
      }
      return new Response(JSON.stringify({ data: respond(body.operationName, body.variables ?? {}) }))
    })
    const client = new FlightLoggerClient({ apiKey: SYNTHETIC.apiKey, fetch: fakeServer })
    const result = await runDiscovery(
      {
        client,
        now: syntheticNow(),
        pastDays: 14,
        futureDays: 21,
        fetchForecast: async () => syntheticForecast(undefined) as never,
        saveSchema: async () => '',
        log: () => {},
      },
      new Set(),
    )
    expect(result.logbook.status).toBe('ok')
    expect(result.logbook.data!.source).toBe('flights')
    expect(result.logbook.data!.hours365FromEntries).toBeCloseTo(1)
    expect(renderReport(result)).toContain('A myFlightLogger nem érhető el ezzel a kulccsal')
  })
})
