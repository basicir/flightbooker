# Foglalástervező (flightbooker) – projektszabályok

Helyben futó Electron + TypeScript alkalmazás, amely a FlightLogger GraphQL API-jából és az
Open-Meteo előrejelzéséből heti foglalási tervezetet készít egy oktatónak.

- Követelmények forrása: `docs/koncepcio.md` (a Claude Docs-beli koncepciódokumentum másolata).
  A követelmény-azonosítókra (ALP-03, SZB-06 …) hivatkozz kódban és tesztben.
- Jóváhagyott fejlesztési terv és mérföldkövek: `docs/fejlesztesi-terv.md`. Minden mérföldkő végén
  megállunk, és a felhasználó ellenőrzi az eredményt.

## Nem alku tárgya

1. **Csak olvasás (ALP-03).** A FlightLogger felé soha nem mehet `mutation` vagy `subscription`.
   Lekérdezést csak `defineQuery()`-vel, rögzített konstansként lehet felvenni a
   `src/main/net/flightLogger/queries/` alá; a `readOnlyGuard` és az `allowedFetch` is ellenőrzi.
   Írási műveletet ne adj hozzá akkor sem, ha valaki kéri – ez külön döntést igényel.
2. **Engedélyezési lista (ALP-02).** Hálózati hívás csak a `src/main/net/allowedFetch.ts`-ben
   történhet, csak az `api.flightlogger.net`, az `api.open-meteo.com` és az `aviationweather.gov`
   (csak `GET /api/data/metar`, csak ICAO-kód és időablak; a modellpontosság méréséhez) felé, valamint
   a frissítéshez (FRS-02, FRS-03) az `api.github.com` (csak a saját repó kiadáslistája) és a `github.com`
   (csak a saját repó kiadási fájljai, egy átirányítással a GitHub fájltárhelyére) felé. A Foglalástervező DEV
   ezen felül – csak a DEV-csatornán, külön belépési ponton (`createDevPromoteFetch`) – a saját repó
   „Kiadás: dev → main” munkafolyamatát indíthatja és a futásait kérdezheti le (FRS-09); a fő változatban ez
   nem jöhet létre. Az ESLint tiltja a `fetch` és a hálózati modulok használatát máshol. A renderer nem ér el
   hálózatot.
3. **API-kulcs (ALP-06).** Csak `safeStorage`-ban (Keychain / DPAPI) tárolódik, sosem a beállítási
   fájlban. A kulcsot mindig a felhasználó írja be. Nem kerülhet csevegésbe, naplóba, jelentésbe,
   hibaüzenetbe, tesztbe vagy fixture-be. Egyetlen kivétel (a felhasználó döntése, 2026-11-25, FRS-11): a
   Foglalástervező DEV a fő változat kulcsát gombbal átveheti, a macOS Kulcskarika engedélyével; a kulcs ekkor is
   csak a memóriában van, és a DEV titoktárolójába kerül. Ugyanez vonatkozik a DEV kiadás gombjának
   GitHub-tokenjére (FRS-09): azt is a felhasználó írja be a DEV-be, és csak a titoktárolóba kerül.
4. **Nincs személyes adat a repóban.** Tesztadat csak szintetikus lehet (`tests/fixtures/`).
   Név, e-mail, foglalási komment nem kerül jelentésbe vagy naplóba. A `reports/` és a gyorsítótár
   gitignore-olt.
5. **Open-Meteo** felé csak koordináta, időablak és modellnév, az **aviationweather.gov** felé csak a bázis
   ICAO-kódja és az időablak mehet ki.

## Felépítés

- `src/core/` – tiszta TypeScript (modell, beállítások, motor, limitek, időjárás). Nincs benne
  Electron, fájl- vagy hálózatkezelés; az ESLint ezt kikényszeríti.
- `src/main/` – Electron főfolyamat, hálózat (`net/`), titkok, beállítási fájl.
- `src/preload/`, `src/renderer/` – React felület (sandbox, context isolation, CSP `connect-src 'none'`).
- `src/core/maintenanceSheet/` – a karbantartási táblázat fotójának értelmezése (ERF-04): saját
  elrendezés-elemzés, oszlopszerepek a „Következő − Aktuális = Hátralévő” összefüggésből, lajstrom-
  illesztés a flottához. `src/main/maintenanceSheet/` – képdekódolás (JPEG/PNG, EXIF) és helyi OCR
  (tesseract.js). A nyelvi modell csak a programmal szállított fájlból töltődhet (ALP-02), a
  fotó nem hagyja el a gépet és nem kerül mentésre. Mentés előtt a felhasználó mindig átnézi.
- `tests/local/` – gitignore-olt mappa valódi üzemi adatokhoz (pl. a táblázat fotói); a rájuk
  épülő teszt kimarad, ha a mappa hiányzik. Szintetikus tesztkép: `tests/fixtures/maintenanceSheet/`.
- `tools/felderites.ts` – parancssori felderítő eszköz (`npm run felderites`), a felhasználó futtatja.
- `src/core/flImport/` és `tools/tampermonkey/flightlogger-import.user.js` – FlightLogger-import (koncepció
  5.10, `docs/flightlogger-import-terv.md`): a rögzítési lista tételei vágólapon a szkripthez, amely a
  FlightLogger saját foglalási ablakát tölti ki; a mentést mindig az oktató nyomja meg, API-hívás nincs.
  A szkript az appba `?raw` importtal kerül (Beállítások → FlightLogger-import). Visszaigazolás vágólapon.
- `tools/tampermonkey/foglalas-felvevo.user.js` – fejlesztői felvevő a FlightLogger foglalási felületének
  feltérképezéséhez (kattintások és hatásuk, DOM-pillanatkép, képernyőkép, térkép). Csak figyel, hálózatot
  nem használ; a nevek álnevesítve. Kimenete (ZIP) a `tests/local/fl-felvetel/` alá kerül.
- `src/main/dev/` – csak a Foglalástervező DEV eszközei (koncepció FRS-09–FRS-11): a fő változat beállításainak
  (első indításkor magától) és API-kulcsának (gombbal, Kulcskarika-engedéllyel) átvétele, a „Kiadás: dev → main” gomb.
  **A fő kiadásba a kódjuk sem kerül bele:** a `@dev-tools/main` és `@dev-tools/ui` aliasok a fő buildben üres
  modulra mutatnak (`electron.vite.config.ts`, a verzióból: `-dev.N` = DEV-build), és a csomagoló ezt ellenőrzi
  (`tools/release/buildGuard.ts`). DEV-elemet csak ezeken az aliasokon át szabad bekötni.
- Bemutató mód nincs (megszűnt 2026-11-25). A szintetikus adat (`src/core/demo/`) csak a tesztekhez és a böngészős
  fejlesztői előnézethez (`npm run dev:web`, `src/renderer/src/browserDemo/`) kell; az Electron-buildben a
  `@browser-demo` alias üres modulra mutat, így a programba nem kerül.
- `src/core/update/`, `src/main/update/` – a program frissítése a GitHub-kiadásokból (koncepció 5.11,
  `docs/kiadas-es-frissites.md`): Ed25519-tel aláírt leírás, lenyomat-ellenőrzés, macOS-en csomagcsere,
  Windowson csendes NSIS. Két csatorna: `main` → Foglalástervező (macOS és Windows), `dev` → Foglalástervező DEV
  (csak Apple Silicon Mac, zip).
- `.github/workflows/`, `tools/release/` – kiadási folyamat: push a `dev` ágra → DEV-kiadás; az Actions
  „Kiadás: dev → main” gombja (vagy dev → main PR) → fő kiadás. A verziót a folyamat számolja. Az aláíró
  titkos kulcs csak a GitHub `UPDATE_SIGNING_KEY` titkában és a fejlesztő gépén van, sosem a repóban.
- `feladatsorok/` – program-revíziók feladatsorai (JSON), a `tools/tampermonkey/feladatsor-export.user.js`
  exportja a FlightLogger Programs oldaláról (az iskolai kulccsal a programszerkezet nem olvasható).
  Személyes adat nem lehet benne; a felhasználó a saját adatmappájában is bővítheti.

## Konvenciók

- Kódazonosítók angolul, a felület és a jelentések szövegei magyarul.
- Csomagverziók pontosan rögzítve (`.npmrc`: `save-exact`).
- A motor determinisztikus tiszta függvény: `plan(snapshot, settings, decisions[])`.
- Ellenőrzés minden mérföldkő végén: `npm run typecheck`, `npm run lint`, `npm test`.
- A repó nyilvános (GitHub): személyes adat és titok nem kerülhet bele.

## Munkamenet: dev → main

1. **Minden munka a `dev` ágon készül.** A `main`-re közvetlenül nem dolgozunk.
2. **A feladat végén minden módosítás felkerül a `dev`-re** (külön kérés nélkül): `npm run typecheck`,
   `npm run lint`, `npm test`; ha mind zöld, commit (a változás leírásával) és `git push origin dev`. A push
   DEV-kiadást indít (kb. 5 perc), a Foglalástervező DEV a következő indításkor frissül rá. Ha valamelyik
   ellenőrzés hibás, nincs push: előbb javítani kell, vagy a felhasználóval megbeszélni.
3. **A `main`-re csak a felhasználó döntésére kerül a kipróbált `dev`**, mert a `main` minden felhasználónak
   kiadás. Ezt a felhasználó indítja: a Foglalástervező DEV Beállítások → Frissítés → „Kiadás: dev → main”
   gombjával (pontosan a kipróbált commitot adja ki), vagy a GitHub Actions „Kiadás: dev → main” munkafolyamatával.
   Claude a `main`-re magától nem pushol, és fő kiadást nem indít.
4. Ha a `dev` a `.github/workflows` fájljait is módosítja, a gomb nem tudja kiadni (a GitHub-token korlátja).
   Ilyenkor a felhasználó jóváhagyásával Claude a `main`-t előrepörgeti a `dev`-re (`git push origin
   origin/dev:refs/heads/main`, csak fast-forward, összefésülési commit soha). Ha a különbség csak kiadási folyamat,
   teszt vagy dokumentáció (`.github/**`, `tools/release/**`, `tests/**`, `docs/**`, `*.md`), ebből nem lesz új
   programverzió (release.yml `paths-ignore`). Erre a feladat végén szólni kell.
