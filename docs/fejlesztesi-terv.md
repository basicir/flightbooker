# Foglalástervező – fejlesztés indítása

## Kontextus

A koncepciódokumentum (15 fejezet, 84 követelmény) elkészült, a 11. fejezet kérdései a K02 kivételével eldőltek. A `flightbooker` mappa üres, nincs benne kód és git sem. Most indul a fejlesztés: Electron + TypeScript alapon, és mivel van oktatói API-kulcs, az első kézzelfogható darab a csak olvasó API-kliens és a felderítő eszköz, amely éles adaton lezárja a K02-t és a 13.1 teendőit. A motor ettől függetlenül, szintetikus adatokon épül.

Hatókör: a dokumentum „MVP” fázisú követelményei. A „2. kör” és „Később” tételek (SZB-09, SZB-17, LIM-07, TRV-13, TRV-15, ADT-09, ALP-07, ERF-06) kimaradnak, de az adatmodell nem zárja ki őket.

## Technológia

- **Electron + electron-vite + React + TypeScript**, csomagolás electron-builderrel (macOS dmg, Windows NSIS).
- **Vitest** a tesztekhez, **zod** a beállítási fájl sémájához, a `graphql` csomag a lekérdezések elemzéséhez.
- Kódazonosítók angolul, a felület szövegei magyarul.
- A pontos csomagverziókat és a FlightLogger sémáját telepítéskor a hivatalos dokumentációból ellenőrzöm, nem emlékezetből írom.

## Felépítés

```
flightbooker/
  docs/koncepcio.md          a csatolt dokumentum másolata, a követelmények forrása
  CLAUDE.md                  projektszabályok (csak olvasás, nincs személyes adat a repóban)
  src/
    core/                    tiszta TypeScript, nincs benne Electron, fájl vagy hálózat
      model/                 a 4. fejezet fogalmai típusként
      config/                zod séma + alapértékek (7.3 súlyok, 8.2 limitek, 10. fejezet táblája)
      engine/                jelöltek, szűrés, pontozás, elhelyezés, dilemmák, indoklás
      limits/                szabálytáblázat kiértékelése előrevetítéssel
      weather/               órák minősítése, oldalszél a pályairányból
    main/                    Electron főfolyamat
      net/allowedFetch.ts    az egyetlen hely, ahol hálózati hívás történik
      net/readOnlyGuard.ts   mutation-zár
      net/flightLogger/      kliens + rögzített lekérdezések (queries/*.ts)
      net/openMeteo.ts
      secrets.ts             API-kulcs (safeStorage: Keychain / Windows DPAPI)
      configStore.ts         beállítási fájl olvasása és írása
    preload/  renderer/      React felület, a 10. fejezet kilenc képernyője
  tools/felderites.ts        parancssori felderítő eszköz
  tests/fixtures/            csak szintetikus adat
```

### A három technikai zár

1. **Csak olvasás (ALP-03).** A FlightLogger felé egyetlen függvény küldhet kérést. A lekérdezések rögzített konstansok, küldés előtt a `graphql.parse` elemzi őket, és minden nem `query` művelet (mutation, subscription, elemezhetetlen szöveg) hibát dob. Teszt igazolja, hogy a `createSingleStudentBooking` és a `deleteBookings` nem megy ki, egy további teszt pedig azt, hogy a forrásban sehol nincs mutation.
2. **Engedélyezési lista (ALP-02).** Az `allowedFetch` csak az `api.flightlogger.net` és az `api.open-meteo.com` hosztot engedi, ESLint-szabály tiltja a `fetch` közvetlen használatát máshol. A felület (renderer) nem ér el hálózatot: CSP `connect-src 'none'`, sandbox, context isolation, és a `session.webRequest` minden más kérést megszakít.
3. **Kulcs (ALP-06).** Az API-kulcs a `safeStorage` titkosításával tárolódik, a beállítási fájlba nem kerül. A kulcsot mindig te írod be; a csevegésbe, naplóba és jelentésbe nem kerülhet.

### A motor alakja

Egyetlen determinisztikus, tiszta függvény: `plan(pillanatkép, beállítások, döntések[]) → { javaslatok, dilemmák, foglalatlanok, figyelmeztetések }`. A dilemmák élő frissítése (TRV-08), a döntés visszavonása (TRV-12) és a hét közbeni újratervezés (TRV-18) mind ugyanennek a függvénynek az újrafuttatása más döntéslistával, ezért nem kell hozzájuk külön állapotgép. Mohó elhelyezés helyi javítással (7.1), a kizáró feltételek soha nem súlyozhatók.

## Mérföldkövek

Minden mérföldkő végén megállok, megmutatom az eredményt, és csak utána megyek tovább.

**M0 – Alapok.** `git init`, electron-vite váz, Vitest, ESLint, `docs/koncepcio.md`, `CLAUDE.md`, `.gitignore` (gyorsítótár, jelentések, titkok). Commit csak kérésre.

**M1 – Csak olvasó adatréteg és felderítés** (ALP-02/03/06, ADT-01–05, ADT-07, 13.1).
- `allowedFetch`, `readOnlyGuard`, FlightLogger-kliens (Bearer, lapozás, 429 + `Retry-After`, `changedAfter`), Open-Meteo-kliens.
- `npm run felderites`: rejtett bevitellel kéri a kulcsot, lefuttatja a 13.1 ellenőrzéseit, és **névtelenített** jelentést ír (darabszámok, üres mezők aránya, enum-értékek, mértékegységek; név, e-mail, komment nem kerül bele). A séma introspekcióját `docs/schema.graphql`-be menti.
- A jelentés kérdései: lát-e a kulcs minden gépet és más oktatók foglalásait (K02); mit jelent a `timeLeft` és a `nextService`; megjelennek-e a nem publikált foglalások; aktív-e a ráérés funkció; ICON-D2 lefedettség és a látástávolság forrása a repülőtérre.
- Ezt te futtatod a saját terminálodban, a jelentést utána közösen értelmezzük.

**M2 – Fogalmak és beállítások** (ALP-05, ERF-01–05, 07–10, NOV-01–08, 12, SZB-10/11/13/14/16, LIM-05). Típusok, zod séma, alapértékek, verziózott, embernek olvasható JSON beállítási fájl.

**M3 – Foglalási motor** (7., 8., 9.1–9.3 fejezet; SZB-*, LIM-01–06, TRV-04–06, 08, 12, 16, 17). A részpontok képleteit a súlyozási dokumentumból veszem át, annak példái aranytesztek lesznek. Tulajdonságteszt: javaslat soha nem sért kizáró feltételt.

**M4 – Felület** a tervezés sorrendjében: Első beállítás, Indítópult, Beállítások → Heti igények, Elméletek → Dilemma-varázsló → Tervezet-nézet (húzható idővonal, „Miért ide?”) → Rögzítési lista, Figyelmeztetések.

**M5 – Újraellenőrzés és hét közbeni működés** (ADT-06, ADT-08, TRV-18, TRV-19, 9.6 párosítás).

**M6 – Csomagolás és visszajátszás.** macOS és Windows telepítő, múltbeli hetek visszajátszása (13.2).

Az első munkamenetben az M0 és az M1 készül el. Amíg a felderítést futtatod, az M2-vel és az M3-mal haladok, mert ezek nem függnek az eredményétől.

## Ellenőrzés

- `npm run typecheck`, `npm run lint`, `npm test` minden mérföldkő végén zöld.
- M1: a zár tesztjei (mutation elutasítva, idegen hoszt elutasítva), a felderítő jelentés elkészül éles kulccsal.
- M3: aranytesztek a súlyozási dokumentum példáira, szintetikus heti forgatókönyvek (ütközés, limit-túllépés, rossz idő, kevés gépóra).
- M4-től: `npm run dev`, az alkalmazást elindítva végigmegyek a tervezés lépésein szintetikus adatokkal.

## Megjegyzések a dokumentumhoz

Kód nem függ tőlük, de a Claude Docs-beli dokumentumban érdemes javítani: az 1. fejezet zárómondata még a 11.1 kérdéseire vár, holott már csak a K02 nyitott; az ERF-06 fázisa „Később2. kör”; a látástávolság DWD-forrása november 30-ig él, ezt a felderítés dönti el.
