# FlightLogger-import – megvalósítási terv

Állapot (2026-11-22): **az F1–F5 elkészült, ellenőrzésre vár.** FlightLogger-szerű próbaoldalon
(a felvételek szerkezetével) végigment; az éles FlightLoggeren még nem próbáltuk. A követelmények
(FLI) a koncepciódokumentum 5.10 részében vannak (`docs/koncepcio.md`); a Claude Docs-beli
koncepcióba még át kell vezetni.

## Cél

A rögzítési lista foglalásai a FlightLogger saját foglalási ablakában, pár kattintással
kerüljenek fel, és utána magától rögzítettnek jelölődjenek az appban. A foglalást mindig az
oktató menti el (foglalásonként egy kattintás), a FlightLogger API-ját semmi nem írja.

## Eldöntött kérdések (2026-11-22)

| Kérdés | Döntés |
|---|---|
| Írás a FlightLoggerbe | Nem az app ír: egy Tampermonkey-szkript a FlightLogger saját felületén kitölti az ablakot, a mentést (Create) mindig az oktató nyomja meg. Az app továbbra is csak olvas (ALP-03 változatlan); az ALP-04 kiegészül. |
| Átvitel az app és a böngésző között | Vágólap: az app JSON-csomagot másol, a FlightLogger oldalán beilleszthető. Hálózat nincs (ALP-02). |
| Visszaigazolás | A szkript minden mentés után a vágólapra teszi a visszaigazolást; az app a rögzítési listára visszatérve magától beolvassa (csak a saját formátumát), és rögzítettnek jelöli a tételeket. Gombbal is beolvasható. |
| Elmélettípus | Az elméleti igény új mezője: Meeting (alapértelmezett, a felhasználó kérésére), Ground training, Extra theory – a FlightLogger három elméleti foglalástípusa. |
| Elméleti mezők (FLI-11) | Az igénynél adható meg az osztály, a program, a tárgy, a Session type és a Session (Ground training), illetve a program (Extra theory). A program- és tárgylista a FlightLogger API-jából jön, csak olvasó lekérdezéssel (`programs`, `subjectCategories`), 7 napig gyorsítótárazva; ha az API üres listát ad (a 2026-11-10-i felderítéskor a `programs` üres volt), szabad szöveg. |
| Amit a szkript nem tud kitölteni | Megjelöli („kézzel pótold”), és a mentés előtt az oktató pótolja: az igényen meg nem adott elméleti mezők, és minden, amire nem talál egyértelmű opciót. |

## A FlightLogger foglalási felülete (a felvételek alapján)

A felvételek: `tests/local/fl-felvetel/` (gitignore-olt, álnevesített).

- „Create booking” (`button[title="Create booking"]`) → típusválasztó csempék: Single student,
  Multi student, Rental, Operation, Maintenance, Meeting, Ground training, Extra theory.
- A csempe után `#bookingFormModal`, fejlécében `select#bookingFormTypeSelector[name=bookingType]`.
  Értékek: „Single student”, „Multi student”, „Ground lesson” (felirata Ground training),
  „Extra theory”, „Meeting”.
- Választók: gomb + legördülő react-select kereséssel (`input[role=combobox]`, `[role=option]`).
  Azonosítók: `#instructorbtn`, `#student1btn`, `#student2btn`, `#flightprogrambtn`,
  `#flightprogram-secondbtn`, `#lesson1btn`, `#lesson2btn`, `#programbtn`, `#classbtn`,
  `#theorycategorybtn`, `#sessiontypebtn`, `#classroombtn`. A gépnek nincs azonosítója: a sor
  címkéje („Aircraft”) szerint található.
- Személy: „KÓD - Keresztnév Vezetéknév” (a KÓD a FlightLogger `callSign`). Gép:
  „HA-BAF / CESSNA A152”. Terem: a FlightLogger teremneve.
- Időpontok: soronként (Briefing, Start, End, Debriefing) egy „ÓÓ:PP” és egy „NN.HH.ÉÉÉÉ” mező;
  egymástól függetlenek.
- Elméleti mezők: Ground training: Instructor, Class, Students (több), Program, Subject, Session
  type, Session, Classroom; Extra theory: Instructor, Student (egy), Program, Classroom; Meeting:
  Classroom, Participants (több).
- Naptár: blokk-rács, sorok `#Resource-<id>-aircraft`, `#Resource-<id>-classrooms`,
  `#UserResource-<id>-instructors_and_crew`, óránként egy cella; a látható nap szövegként
  („Sunday, 22.11.2026”).

## Lépések

### F1 – Elmélettípus (FLI-01)

- `BookingRequest.theoryType`: `groundTraining` | `extraTheory` | `meeting`; hiányában Ground
  training. Séma, Elméletek képernyő (választó), rögzítési lista, címkék.
- Extra theorynál több résztvevő esetén növendékenként külön FlightLogger-foglalás.

### F2 – FlightLogger-formátum és másolás (FLI-02, FLI-03)

- `src/core/flImport/`: a rögzítési lista tételeiből FlightLogger-űrlap szerinti importtételek
  (tiszta függvény): foglalástípus, oktató, növendékek programmal és feladattal, résztvevők, gép
  vagy terem, Briefing/Start/End/Debriefing, komment, a naptárrajzhoz a perc-tartomány.
- Csomagformátum (`flightbooker-fl-import`, 1. változat) és visszaigazolás
  (`flightbooker-fl-receipt`) zod-sémával.
- Rögzítési lista: tételenként „FlightLoggerbe” másolás, fejlécben „Mind a FlightLoggerbe”.
- A névjegyzék a FlightLogger-kódot (`callSign`) is tartja (csak memóriában, mint a nevet).

### F3 – Tampermonkey-szkript (FLI-04 – FLI-07)

`tools/tampermonkey/flightlogger-import.user.js`:

- „Import” gomb a foglalási áttekintő eszközsorában; panel beillesztéssel és listával.
- A lista tételei halványan a naptár megfelelő sorában (gép, terem, oktató), csak a látható
  napon; csak megjelenítés.
- „Foglalás megkezdése”: a szkript megnyitja az ablakot, kiválasztja a típust, kitölti a mezőket,
  kiemeli a Create gombot, és vár. Mentés után a következő tétel magától nyílik; bezárásnál megáll.
- Amit nem tud egyértelműen kitölteni, azt a panel felsorolja.

### F4 – Visszaigazolás (FLI-08)

- A szkript mentésenként a vágólapra teszi a visszaigazolást, és a panelen is másolható.
- Az app: „Visszaigazolás beolvasása” a rögzítési listán; az ablakba visszatérve magától is
  beolvassa, ha a vágólapon visszaigazolás van. A létrehozott tételek rögzítettek lesznek.
- Új IPC: vágólap olvasása (csak szöveg, méretkorláttal).

### F6 – Elméleti mezők az igénynél (FLI-11), 2026-11-22

- `BookingRequest.flTheory` (program, tárgy, Session type, Session; az osztály a `classId`), az
  Elméletek oldalon a típus szerinti mezőkkel. A programlista: `TheoryProgramsQuery`,
  `SubjectCategoriesQuery` (csak olvasás), `src/main/data/theoryCatalog.ts`, IPC
  `loadTheoryCatalog`; csak akkor töltődik, ha a héten van Ground training vagy Extra theory.
- A csomagban `theory` (felirat szerint), a szkript (1.1.0) kitölti: Class (az osztály tagjait a
  FlightLogger maga teszi a Students mezőbe; a szkript csak a hiányzókat veszi fel, a fölöslegeseket
  jelzi), Program, Subject, Session type, Session.
- Az alapértelmezett elmélettípus Meeting.

### F7 – Előnézet, színek, gyorsabb kitöltés, űrlap (FLI-05, FLI-12, FLI-13), 2026-11-22

- Előnézet a naptár soraiba téve (a FlightLogger saját blokkjai mellé): görgetéskor és a trackpad
  „rugalmas” túlhúzásakor is a helyén marad. A gépnél a briefingtől a debriefingig, a repülési szakasz
  kiemelve. A naptár tetején az oktató sora: a FlightLogger oktatói sorának blokkjai és a lista tételei,
  az átfedők sávokban egymás alatt.
- Kitöltés: fix várakozások helyett feltételre várás (megjelent az opció, bezárult a lista, betöltött a
  program); repülésnél kb. 1,4 s a próbaoldalon (korábban 4,6 s).
- Töredékes keresés: szavak szókezdetre is illeszkednek, ékezet nélkül; egyforma találatnál a panel jelez.
- Színek: `settings.flImport.colors` típusonként (opcionális, formátumváltás nélkül), a csomagban
  `color`; a szkript a kitöltőszín-választó hex mezőjébe írja.
- Űrlap: „Tervezéshez” rész kiemelve, „FlightLoggerbe – nem hat a tervre” rész összecsukva (típus,
  osztály, program, tárgy, Session, komment); az igény kommentje (`note`) a foglalás kommentje, ha a
  tervezeten nincs külön komment.

### F7a – Az előnézet helye (szkript 1.2.1), 2026-11-22

- Hiba: újrarajzoláskor a szkript a felső oktatói sor kivétele előtt mért képernyő-koordinátákkal
  helyezett el, így az előnézet a felső sor magasságával (1–2 sorral) lejjebb, akár másik gép sorába
  került; a `z-index` miatt a FlightLogger blokkjai mögé is.
- Javítás: soronként egy saját réteg; vízszintesen az óracellák százalékában (a nézet a cellák `start`
  attribútumából), függőlegesen a FlightLogger sávjai szerint (1px, 29px …). Mérés egy pillanatban, a
  saját változtatások előtt; az elemek helyben frissülnek, nem törlődnek újra.
- A FlightLogger meglévő foglalásával átfedő előnézet a következő szabad sávba kerül, a sor ehhez
  megnyúlik (`min-height`, a végén visszaáll). A felvitt tétel előnézete eltűnik (a FlightLogger maga
  mutatja). Rejtett vagy még ki nem rajzolt sornál nincs rajz, a következő körben pótlódik.

### F7b – Visszaállított kitöltés (szkript 1.3.0), 2026-11-22

- A felhasználó kérésére a kitöltés újra az 1.1.0-s módszerrel megy (fix várakozások, a régi
  szövegpontozás), mert élesben az működött; az 1.2.0 gyorsított, feltételre váró kitöltése és új
  töredékpontozása kikerült. Megmaradt: a kitöltőszín (a régi kitöltés után, külön lépésben) és az
  F7a előnézet.

### F8 – Áthelyezés importja (FLI-14, szkript 1.5.0), 2026-11-24

- Felvétel: `Update booking` ablak a blokkra kattintva; gombok Update, Update & reuse, Delete, Cancel;
  a dátum egy sorban átírva a többire is átmegy. A napléptetés: `Navigate to previous/next day`.
- Csomag 2-es változat: a tétel `update` mezője (FlightLogger-foglalás azonosítója, régi nap és idő);
  a régebbi szkript az ilyen csomagot elutasítja, így nem vesz fel újat a meglévő helyett.
- `openImportEntries`: az áthelyezendő tétel (`change.kind = move`, ismert régi hellyel) átírásként jön;
  ha a foglalás már nincs meg, új foglalásként. A több növendékes extra elmélet és a vegyes csapat kimarad.
- Visszaigazolás: az áthelyezendő igénynél `completeMove` (új helyén rögzített, azonosító megmarad).
- Lemondott foglalás: elsősorban a FlightLogger adata (a blokk React-tulajdonságai között a foglalás `status`-a);
  ha nem érhető el, a halványpiros (rózsaszín) sáv (rgb 232,127,127), amely csak a
  „Hide all cancellations” (lemondások mutatva) állásban látszik.

### F9 – Lemondás, vegyes csapat, kijelölés (FLI-14–16, szkript 1.6.0), 2026-11-24

- Importtételek: új foglalás, átírás (`update`, `full`: típus és növendékek is), lemondás (`cancel`).
  Egy meglévő foglalást időrendben az első tétel ír át; a többi újat kap; az a foglalás, amelynek
  minden igénye máshová került, lemondásra kerül. Extra elméletnél a növendékenkénti foglalások a
  pillanatképből (ugyanott, ugyanakkor, a növendék résztvevő).
- Lemondás: a szkript a Cancel gombot emeli ki, megvárja a FlightLogger ablakainak bezárulását, és
  akkor kész, ha a blokk eltűnt vagy lemondott; különben megáll. A visszaigazolás `cancel: true` →
  `markCancelled` (csak tervbe tett lemondásnál).
- A visszaigazolás az eredmény foglalását is hozza (`bookingId`): átírásnál a meglévőt, új
  foglalásnál ha a szkript látta; `completeMove` ezt jegyzi meg.
- Felső sor: kattintásra a lenti foglalás (minden sorában) narancs keretet kap, odagörget; Esc törli.

### F5 – Útmutató a beállításokban (FLI-09)

- Új fül: „FlightLogger-import”: telepítés (Tampermonkey, a szkript másolása), használat lépésről
  lépésre, mit nem tölt ki, adatvédelem.

## Ellenőrzés

- Egységtesztek: importtételek típusonként (egy- és többnövendékes, csapat, szimulátor, az
  elmélet három típusa), a csomag és a visszaigazolás sémája, a visszaigazolás alkalmazása.
- A szkript FlightLogger-szerű próbaoldalon (a felvételek szerkezetével), böngészőben.
- `npm run typecheck`, `npm run lint`, `npm test`.
- Élesben (az oktató): egy tesztfoglalás végigvitele, majd törlése a FlightLoggerben.
