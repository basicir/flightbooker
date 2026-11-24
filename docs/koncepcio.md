# Foglalástervező FlightLoggerhez – koncepció és követelmények

Nov 10, 2026 · @Bendegúz

## 1. Összefoglaló

A Foglalástervező helyben futó alkalmazás, amely a FlightLogger adataiból és az időjárás-előrejelzésből heti foglalási tervezetet készít az oktatónak. A teszt idején csak olvassa a FlightLoggert, a kész tervet az oktató rögzíti kézzel.

A rendszer nem dönt az oktató helyett. Ahol két hasonló fontosságú igény ütközik, ott érvekkel alátámasztott ajánlást ad, és az oktató választ.

A lista feldolgozása és a FlightLogger dokumentációjának átnézése hat megállapítást hozott, ezek alakítják a további munkát:

1. **Az API elég az induláshoz.** A FlightLogger GraphQL API-ja olvashatóan adja a gépeket, foglalásokat, felhasználókat, ráéréseket, termeket és programokat. Feltétele a fizetős API modul az iskola előfizetésében.
2. **A „csak olvas” elvet nekünk kell garantálni.** Az API foglalást is tud létrehozni és törölni, csak olvasható kulcsnak pedig nem találtuk nyomát. Az alkalmazásba technikai zár kell.
3. **A terem férőhelye és több tervezési adat nincs az API-ban.** A csapat jól látta, hogy ezeket az oktatónak kell megadnia. A helyi beállítások minősége közvetlenül a terv minőségét adja.
4. **Az Open-Meteo harmadik fél, és az ingyenes szintje nem kereskedelmi célra szól.** Személyes adat nem jut el hozzá, csak koordináta és IP-cím. A csapat döntése szerint a használat nem kereskedelmi, ezért az ingyenes szint marad.
5. **Egy hétre előre az időjárás-alapú döntés bizonytalan.** A nagy felbontású modellek csak 2–5 napra látnak előre. A rossz időre tett elméletet és szimulátort ezért a hét közben újra kell értékelni.
6. **A tervezet a kézi rögzítésig elavulhat.** Más oktatók közben lefoglalhatják ugyanazt a gépet. Rögzítés előtt és után is össze kell vetni a tervet a FlightLogger aktuális állapotával.

A fejlesztés 2026. november 10-én elindult. A 11.1 rész kérdései eldőltek, a felderítés eredményét a 13.1 rész foglalja össze.

## 2. Probléma, célok és sikerkritériumok

Egy oktató hetente sok foglalást hoz létre a FlightLoggerben, és mindegyiknél egyszerre kell néznie a gépeket, a növendékeket, az időjárást és a limiteket. A hosszú távú cél egy foglalástervező, amely ezt a munkát nagyrészt leveszi róla.

**Célok a teszt idejére**

- Kevesebb idő alatt készül el a heti terv.
- Kevesebb ütközés és limit-túllépés marad észrevétlen.
- A gépek kirepülhető órái jobban oszlanak el, és a gépekben marad tartalék a karbantartás előtt.
- Minden javaslatnál látszik az indok, ezért az oktató meg tud bízni benne vagy felül tudja írni.

**Nem célok a teszt idejére**

- Nem ír a FlightLoggerbe, a foglalást az oktató rögzíti.
- Nem dönt a repülés végrehajtásáról, és nem helyettesíti a METAR/TAF alapú időjárási felkészülést.
- Nem hatósági nyilvántartás, és nem helyettesíti a FlightLogger saját figyelmeztetéseit.
- Nem iskolai szintű tervező, nem hangol össze több oktatót.
- Nem kezel számlázást, és nem küld értesítést a növendékeknek.

**Javasolt sikerkritériumok.** A célértékek kiinduló javaslatok, a csapat véglegesíti őket.

| Mérőszám | Mérés módja | Javasolt cél |
| --- | --- | --- |
| Heti terv elkészítési ideje | Stopper a teszt előtti 2 héten és a teszt alatt | Legalább 50%-kal rövidebb |
| Változtatás nélkül rögzített javaslatok aránya | Tervezet és FlightLogger összevetése | Legalább 70% |
| Figyelmeztetés nélkül maradt ütközés vagy limit-túllépés | Utólagos ellenőrzés | 0 |
| Heti tervenként megjelenő dilemmák száma | Számláló az alkalmazásban | Legfeljebb 10 |
| Oktatói elégedettség | Heti 1–5-ös értékelés | Legalább 4 |

## 3. Rendszerhatárok és adatforrások

A rendszer két külső forrásból dolgozik: a FlightLogger API-t csak olvassa, az Open-Meteótól koordináta alapján kér előrejelzést. Minden más helyi beállításban él.

&#91;embedded content: adatáramlás · 2 külső forrás, 1 helyi alkalmazás\]

A csapat elve szerint az adat nem kerülhet harmadik félhez. Az Open-Meteo harmadik fél, ezért hozzá csak a repülőtér koordinátája és az időablak mehet ki, név vagy foglalási adat nem.

### 3.1 FlightLogger API

A [FlightLogger API](https://api.flightlogger.net/) GraphQL alapú, és [Bearer-kulccsal](https://help.flightlogger.net/knowledge/getting-started-with-the-graphql-api) érhető el. Az iskolának a fizetős API modul kell hozzá. Az alábbi mezők a nyilvános referenciából származnak, a 2026. november 10-i felderítés élesben is ellenőrizte őket.

| Tervezési adat | API-elem | Állapot | Megjegyzés |
| --- | --- | --- | --- |
| Gépek, szimulátorok | `aircraft`: `callSign`, `model`, `aircraftClass`, `homeAirport`, `disabled` | Élesben ellenőrizve | Csak aktív erőforrást ad. A szimulátor `aircraftClass` értéke `SIMULATOR`, ezért a besorolás előtölthető. Élesben mind a 30 aktív erőforrás látszik (26 gép, 4 szimulátor). |
| Gép elérhetősége | `Aircraft.availabilities`: `startsAt`, `endsAt` | Élesben ellenőrizve | Az iskola nem használja, élesben 0 esemény jött. A gép kiesését hosszú karbantartási vagy operációs foglalás jelzi (7.2). |
| Foglalások | `bookings`: `from`, `to`, `overlap`, `statuses`, `subtypes`, `all` | Élesben ellenőrizve | Időszerkezete: `startsAt`, `flightStartsAt`, `flightEndsAt`, `endsAt`, továbbá `comment`. Állapota `OPEN`, `COMPLETED`, `PARTIALLY_COMPLETED` vagy `CANCELLED`. Élesben az `all: true` minden oktató foglalását adja (5 hétre 1357-et a 27 saját helyett), a gép-, oktató- és növendékmező mindig kitöltve. A létrehozás adatai (`audit`) üresek. |
| Felhasználók | `users`: `roles` szűrő, `user` | Élesben ellenőrizve | A szerepkör csak szűrőként érhető el, például `STUDENT` vagy `FLIGHT_INSTRUCTOR`. Élesben 453 növendék és 49 repülésoktató látszik, névvel. |
| Ráérés | `User.availabilities`: `startsAt`, `endsAt`, `unavailable` | Élesben ellenőrizve | Elérhető és nem elérhető időszakot is jelöl. Az iskolánál aktív, élesben mind a 9 vizsgált növendék kitöltötte. |
| Program, haladás | `programs`, `userPrograms`, `trainings`, `ProgramPhase.lectures`, `Training.status`, `failedPerformance` | Részben látható | A `Lecture` megadja a briefing, a debriefing és a repülés tervezett percét. Élesben a `programs` és a `userPrograms` üres. A feladat és a percei csak az elvégzett `Training` felől érhetők el, programfázis nélkül (K36). |
| Növendék repült ideje | `flights`: `onBlock`, `offBlock`; `Training.totalSeconds` | Részben látható | Ebből számolható az utolsó repülés is. Élesben a `flights` az `all: true` mellett is csak a kulcs tulajdonosának repüléseit adja, 2026. április 1-jétől (K37). A növendékek repülései a `Training.flights` felől látszanak. |
| Oktató logbookja | `myFlightLogger`: `logbookEntries`, `logbookSummations`, `includeInFtl` | Részben látható | Csak a kulcs tulajdonosáé, viszont minden FlightLogger-fiókját lefedi. Élesben iskolai kulccsal nem kérdezhető. Pótlás: a saját repülések block time-ja ebben a fiókban (8.3). |
| Szolgálati idő | `dutyTimes`: `startsAt`, `endsAt`, `state` | Dokumentált | Az iskolánál nem aktív a [limit-modul](https://help.flightlogger.net/knowledge/getting-started-with-duty-time), ezért ez az adat nem használható. |
| Karbantartás | `Aircraft.nextService`, `worstMaintenanceWarning.timeLeft`, `maintenanceParts` | Élesben ellenőrizve | Élesben a `timeLeft` és a `nextPrimaryService` üres. Az iskola csak dátumalapú karbantartást vezet a FlightLoggerben (ARC, tanúsítvány), óraalapút nem, ezért a kirepülhető idő kézi megadás marad (ERF-04). A `worstMaintenanceWarning` két mezője (`logMeasurementType`, `typeOfTimerMeasurement`) szerverhibát ad. |
| Termek | `classrooms`: `id`, `name` | Élesben ellenőrizve | [Férőhely mező nincs](https://help.flightlogger.net/knowledge/getting-started-with-classrooms), helyben kell megadni. Élesben 14 aktív terem látszik. |
| Osztályok, elméleti foglalások | `classes`: `users`; `classTheories`: `class`, `classroom`, `students`, `instructor` | Élesben ellenőrizve | Egész osztály foglalásához elegendőnek látszik. Élesben 34 osztály látszik, 3–40 fővel. |

**Amit az API nem ad, ezért helyben kell megadni:** a terem férőhelye, a gépkategóriák, az oktató–növendék hozzárendelés, a növendéki preferenciák és az iskolai limitek számai. A FlightLogger limit-követelményeinek nem találtuk API-megfelelőjét.

**Korlátok, amelyekkel számolni kell**

- A [kérések korlátja](https://help.flightlogger.net/knowledge/api-limitations) nincs számszerűsítve. Túllépéskor 429-es válasz és `Retry-After` jön, ezért ütemezett és `changedAfter` szerinti részleges frissítés kell. Élesben 97 kérésből 12 kapott 429-et, legfeljebb 34 másodperc várakozással.
- A lekérdezések mélysége és összetettsége korlátozott, az eredmények [lapozva](https://help.flightlogger.net/knowledge/pagination-of-api-results) érkeznek. Élesben az összetettség felső határa 5000 pont, ezért a beágyazott kapcsolatokat kis lapmérettel kell kérni.
- Az `all: true` csak jogosultság esetén adja vissza a nem a kulcs tulajdonosához kötött adatokat. Élesben az oktatói kulcs minden gépet és minden oktató foglalását látja, a gép-, oktató- és növendékmező mindenhol kitöltve (K02).
- Az API foglalást is létrehoz és töröl (`createSingleStudentBooking`, `deleteBookings`), csak olvasható kulcsról nem ír a dokumentáció. A helyi alkalmazásnak minden `mutation` küldését tiltania kell.
- A [nem publikált foglalások](https://help.flightlogger.net/knowledge/getting-started-with-unpublished-bookings) másoknak láthatatlan vázlatok, és nem foglalják le a helyet. Az API-leírásban nincs rájuk utaló mező vagy állapot, ezért élesben kell megnézni, hogy megjelennek-e.
- Iskolai kulccsal a `myFlightLogger` nem kérdezhető, és a `flights` 2026. április 1. előtti repülést nem ad vissza (K37).
- A gépek állapotjelző mezői közül a `worstMaintenanceWarning.logMeasurementType` és `.typeOfTimerMeasurement` szerverhibát ad, ezért a kliens nem kéri őket.

### 3.2 Open-Meteo

A [Forecast API](https://open-meteo.com/en/docs) a legtöbb tervezési feltételhez ad adatot; felhőalapot közvetlenül nem, de a nyomási szintek felhőzetéből számolható. Az értékek órás bontásúak, a szél csomóban is kérhető.

| Feltétel | Változó | Megjegyzés |
| --- | --- | --- |
| Szél, oldalszél | `wind_speed_10m`, `wind_direction_10m` | Az oldalszelet a pályairányból kell számolni, ez helyi beállítás. |
| Széllökés | `wind_gusts_10m` | Az előző óra maximuma. |
| Felhőzet | `cloud_cover_low`, `cloud_cover` | Százalék, a mennyiséget adja, a magasságot nem. |
| Felhőalap | `cloud_cover_<szint>hPa`, `geopotential_height_<szint>hPa` (1000–700 hPa) | A közvetlen `cloud_base` csak a svájci ICON-CH-ban van. A plafon a legalacsonyabb 50% fölötti réteg alja a modell szintenkénti felhőzetéből, interpolálva (2026-11-15). Ha a `cloud_cover_low` 50% fölött van, de a szintek 800 hPa-ig nem adnak plafont (szintek közé eső vékony stratus), a plafon az alacsony réteg legfelhősebb szintje. A DWD saját ICON-EU `CEILING` mezőjével összevetve (LHNY, 2026-11-18/19) alacsony szinten átlagosan kb. 250 lábbal óvatosabb. A hőmérséklet–harmatpont becslés (400 láb/°C) csak tartalék: stabil, párás levegőben rendszeresen túl alacsony. |
| Látástávolság | `visibility` | A [DWD-modelleknél 2026. november 30-ig](https://open-meteo.com/en/docs/dwd-api) érhető el, más forrás kellhet. Élesben a best\_match 146 óráig ad értéket, november 30. után újra ellenőrizendő. |
| Csapadék | `precipitation`, `precipitation_probability`, `weather_code` | A valószínűség ensemble-ből származik. |
| Zivatar | `cape`, `weather_code` | Konvektív helyzet jelzésére. |
| Jegesedés | `freezing_level_height` | A 0 °C szintje méterben. |
| Nappal, éjszaka | `sunrise`, `sunset` napi értékek | Nappali és éjszakai feladatok szűréséhez. |

**A tervezés előrejelzése: súlyozott modell-együttes (2026-11-15).** A best\_match helyett a tervezés az összes összevetett modell (ICON-D2/EU/global, ECMWF, GFS, UKMO, Météo-France, DMI HARMONIE) pontosság szerint súlyozott együttesét használja. Ok: a best\_match Nyíregyházán a DMI HARMONIE-t választotta, amely egyedül jelzett egész napos párát, és ez a tervből nem látszott.

- Kombinálás: szél, lökés, hőmérséklet, csapadék, CAPE súlyozott átlag; szélirány vektorátlag; látás, felhőalap és időjárás-kód súlyozott medián, hogy egyetlen modell köde ne döntsön, a többség viszont igen.
- Súly: a modell négyzetes hibájának fordítottja a bázis METAR-jához (szél, lökés, látás 10 km-ig, plafon 5000 lábig, hőmérséklet), előrejelzési távolság szerint öt sávban (0–1, 1–2, 2–3, 3–5, 5+ nap), az elmúlt 30 napból.
- A mérés: az alkalmazás eltárolja a letöltött modell-előrejelzéseket (`idojaras-pontossag.json`, személyes adat nincs benne), és az elmúlt órákat az aviationweather.gov METAR-jával veti össze. Múltbeli előrejelzés másként nem érhető el: az Open-Meteo Previous Runs API-ja külön hoszt, és látást, felhőprofilt nem ad.
- Indulás: mérés nélkül irodalmi induló súlyok (a nagy felbontású modellek az első két napon, az ECMWF középtávon többet kap); kb. 72 mért óra után a mérés és az induló súly egyenlő arányban számít.

**Előrejelzési táv.** Az ICON-D2 2 napra, az ICON-EU 5 napra lát előre, ezután durvább modell veszi át a helyet. Élesben az ICON-D2 nem fedi le az LHNY-t. Ott az ICON-EU kb. 112 órára lát előre, a best\_match kb. 146 óráig ad adatot.

**Használati feltételek.** Az ingyenes szint [nem kereskedelmi célra](https://open-meteo.com/en/terms) szól, naponta 10 000 hívásig, és a CC BY 4.0 licenc forrásmegjelölést kér. A csapat döntése szerint ez a használat nem kereskedelmi, ezért az ingyenes szintet használjuk.

### 3.3 Helyi működés és adatvédelem

- A kimenő kapcsolatok engedélyezési listán vannak: csak a FlightLogger API, az Open-Meteo, az aviationweather.gov METAR-szolgáltatása és a program saját GitHub-kiadásai (frissítés, 5.11) érhetők el.
- Az API-kulcs az operációs rendszer titoktárolójába kerül, nem a beállítási fájlba.
- A beállítási fájl embernek olvasható, menthető és más gépre átvihető.
- A helyben tárolt adat lehetőleg csak azonosító és preferencia. A név és a foglalás memóriában vagy törölhető gyorsítótárban marad.
- A növendéki adat az iskola felelőssége alá tartozik, ezért a helyi tárolást az iskolának jóvá kell hagynia.
- Az Open-Meteo a kérés koordinátáját és az IP-címet [90 napig naplózhatja](https://open-meteo.com/en/terms).

## 4. Fogalmak és adatmodell

A tervezés központi egysége a foglalási igény, vagyis egy tétel, amelyet a héten el kell helyezni. A motor az igényekből foglalásjavaslatokat készít, ezek együtt adják a tervezetet.

| Fogalom | Jelentés | Forrás |
| --- | --- | --- |
| Oktató | A tervet készítő felhasználó, az API-kulcs tulajdonosa | FlightLogger, munkaidő-ablaka helyben |
| Növendék | Az oktatóhoz rendelt tanuló, programmal és haladással | FlightLogger, preferenciái helyben |
| Erőforrás | Repülőgép vagy szimulátor, mindkettő `aircraft` a FlightLoggerben | FlightLogger, besorolása helyben |
| Gépkategória | Gépek csoportja, például Piper vagy Cessna | Helyi beállítás |
| Kirepülhető idő | A karbantartásig még repülhető órák száma gépenként | Oktató adja meg a maintenance crew reggeli dokumentuma alapján, később API |
| Terem | Elméleti foglalás helyszíne, férőhellyel | FlightLogger, férőhelye helyben |
| Osztály | Együtt tanuló növendékek csoportja | FlightLogger |
| Feladat | A képzési program egy repülési vagy elméleti egysége | FlightLogger |
| Foglalási igény | Egy elhelyezendő tétel: repülés, szimulátor vagy elmélet, résztvevőkkel és időtartammal | Számolt, az oktató módosíthatja |
| Időjárási ablak | Egy óra minősítése növendékenként: repülhető, bizonytalan vagy nem repülhető | Számolt |
| Limit-szabály | Alany, mérőszám, időablak, határérték, súlyosság és forrásdokumentum | Helyi beállítás |
| Foglalásjavaslat | Igény, erőforrás, időpontok, pontszám és indoklás együtt | Számolt |
| Dilemma | Olyan helyzet, amely oktatói döntést igényel | Számolt |
| Standby foglalás | Tudatosan kettősen foglalt hely, a tartalék kommentben jelölve | Oktató döntése |
| Tervezet | Egy hét foglalásjavaslatai a döntésekkel és kommentekkel | Helyben tárolt |

### Egy foglalás időszerkezete

A FlightLogger foglalásonként négy időpontot tárol. A motor ezekre képezi le a briefinget, a repülést és a debriefinget.

&#91;embedded content: egy repülési foglalás szakaszai és FlightLogger-időpontjai · nem méretarányos\]

A gép első repülését minden elhelyezés után újra meg kell határozni. Ha egy korábbi foglalás kerül ugyanarra a napra és gépre, a 20 perc átkerül arra a foglalásra. A számításban minden FlightLogger-foglalás részt vesz, más oktatóké is, a lemondottak kivételével.

## 5. Követelmények

A csapat 29 pontja és kilenc későbbi kérése 62 követelménnyé bomlott, az elemzés további 19-et javasol. A „Fázis” oszlop javaslat, a csapat átállíthatja. Az eredeti pontok megfeleltetése a 14. fejezetben van. A közös briefing csapatok 12 követelménye (KBR) később, 2026. november 16-án került be, az 5.8 részben. Az igény-elsőbbség 5 (ELS) és a plusz igények 8 követelménye (KIT) 2026. november 17-én, az 5.9 részben. A FlightLogger-import 13 követelménye (FLI) 2026. november 22-én, az 5.10 részben.

### 5.1 Alapelvek

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| ALP-01 | Különálló, helyben futó alkalmazás. | Csapat | MVP |
| ALP-02 | Csak a FlightLoggerrel, az Open-Meteóval, (a modellpontosság méréséhez, csak a bázis ICAO-kódjával) az aviationweather.gov METAR-szolgáltatásával és (a program frissítéséhez, csak a saját kiadásaiért) a GitHubbal kommunikál, személyes adat nem jut harmadik félhez. A fejlesztői (DEV) változat ezen felül a saját repó „Kiadás: dev → main” munkafolyamatát indíthatja a fejlesztő GitHub-tokenjével (FRS-09). A METAR-forrást a felhasználó hagyta jóvá 2026-11-15-én, a GitHubot 2026-11-24-én, a DEV kiadás gombját 2026-11-25-én (5.11). | Csapat | MVP |
| ALP-03 | A FlightLoggert csak olvassa, írási műveletet technikailag sem tud küldeni. | Csapat | MVP |
| ALP-04 | A foglalásokat az oktató rögzíti: kézzel, vagy a FlightLogger-import segítségével (5.10), amely kitölti a FlightLogger ablakát, de a mentést minden foglalásnál az oktató nyomja meg (2026-11-22). | Csapat | MVP |
| ALP-05 | A tartós adatok külön konfigurációs fájlban, a számítógépen tárolódnak. | Csapat | MVP |
| ALP-06 | Az API-kulcs az operációs rendszer titoktárolójában van. | Új | MVP |
| ALP-07 | A beállítások menthetők és másik gépre átvihetők. | Új | Később |
| ALP-08 | A felület mindig mutatja az utolsó adatfrissítés idejét. | Új | MVP |

### 5.2 Adatok és változásfigyelés

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| ADT-01 | Az összes gép és foglalásaik beolvasása az API-ból. | Csapat | MVP |
| ADT-02 | Az oktató és a növendékek foglalásainak és ráéréseinek beolvasása. | Csapat | MVP |
| ADT-03 | A termek és foglalásaik beolvasása. | Csapat | MVP |
| ADT-04 | A növendékek haladásának és következő feladatának beolvasása. | Csapat | MVP |
| ADT-05 | Az oktató logbookjának beolvasása a limitekhez. | Csapat | MVP |
| ADT-06 | Figyelmeztet, ha változik az elérhető gépek vagy termek listája. | Csapat | MVP |
| ADT-07 | Az időjárás beolvasása az Open-Meteóból, a repülőtérre, útvonalas feladatnál az érintett repülőterekre is (SZB-19). | Csapat | MVP |
| ADT-08 | Rögzítés előtt összeveti a tervet a FlightLogger friss állapotával. | Új | MVP |
| ADT-09 | Felismeri a kézzel rögzített foglalásokat, és késznek jelöli őket. | Új | Később |

### 5.3 Erőforrások

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| ERF-01 | A gépek kategóriákba sorolhatók, például Piper vagy Cessna. | Csapat | MVP |
| ERF-02 | A felhasználó kezdetben megjelöli a szimulátorokat, a többi erőforrás repülőgép. A rendszer a FlightLogger gépadataiból előtölti. | Csapat | MVP |
| ERF-03 | Új erőforrás megjelenésekor rákérdez a besorolásra. | Új | MVP |
| ERF-04 | Gépenként megadható a kirepülhető idő az alkalmazás megnyitásakor, a maintenance crew reggeli dokumentuma alapján. | Csapat | MVP |
| ERF-05 | Ha aznap még nem volt megadva, a rendszer megnyitáskor bekéri az adatot. | Csapat | MVP |
| ERF-06 | A bekéréskor előtölti az előző értéket, a közben repült idővel csökkentve. | Új | 2. kör |
| ERF-07 | A termek, férőhelyük és preferenciájuk leírhatók. | Csapat | MVP |
| ERF-08 | A motorpróba és körüljárás ideje állítható, alapból 20 perc. | Csapat | MVP |
| ERF-09 | Megadható a repülőtér, a pályairányai és a nyitvatartása. Egyelőre egy repülőteret kezelünk. | Új | MVP |
| ERF-10 | Gépenként beállítható a két repülés közötti minimális fordulóidő. | Új | MVP |

### 5.4 Növendékek

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| NOV-01 | Az oktató növendékeket választhat ki a listából. | Csapat | MVP |
| NOV-02 | Az oktató–növendék hozzárendelés tartósan tárolódik. | Csapat | MVP |
| NOV-03 | Megadható, hogy a növendék mely gépekkel repülhet, egyedileg vagy kategóriánként. | Csapat | MVP |
| NOV-04 | Növendékenként megadható preferált gép. | Csapat | MVP |
| NOV-05 | A növendékek napon belüli preferált időbeli sorrendbe állíthatók. | Csapat | MVP |
| NOV-06 | Növendékenként időjárási preferenciák és limitek adhatók meg. IFR és VFR között nincs külön szabály, az adott fázisban az oktató a limiteket állítja. | Csapat | MVP |
| NOV-07 | Növendékenként megadható a briefing preferált időtartama. | Csapat | MVP |
| NOV-08 | Figyelmeztet, ha egy növendék régen repült. A küszöb alapból 14 nap, növendékenként állítható. | Csapat | MVP |
| NOV-09 | Elvetve: Növendékenként megadható a heti cél repülés- és szimulátorszám. | Új | Később |
| NOV-10 | Elvetve: Az időjárási minimum függhet a képzési szakasztól és attól, hogy szóló vagy duál a feladat. | Új | Később |
| NOV-11 | Elvetve, az importált ráérés lefedi: Egy növendék egy hétre kihagyható, például vizsga vagy szabadság miatt. | Új | Később |
| NOV-12 | Növendékenként megadható foglalási prioritás 1-től 5-ig, két növendéknek lehet azonos értéke. | Csapat | MVP |

### 5.5 Foglalási szabályok

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| SZB-01 | A repülések elhelyezése figyelembe veszi az időjárást. | Csapat | MVP |
| SZB-02 | Beállítható, hogy a rendszer válasszon-e feladatot, és foglalásonként felülírható. | Csapat | MVP |
| SZB-03 | Figyelembe veszi a növendék és az oktató ráérését és foglalásait. | Csapat | MVP |
| SZB-04 | Kettős foglalást (a gép, az oktató vagy a növendék ütközése) csak végső esetben javasol, figyelmeztetéssel. Kivétel a bizonytalan időjárásra ajánlott standby elmélet (SZB-15). | Csapat | MVP |
| SZB-05 | A gép napi első repülésénél a motorpróba idejével nő a briefing-szakasz. | Csapat | MVP |
| SZB-06 | Úgy választ gépet, hogy a kirepülhető időből tartalék maradjon. A tartalék mennyisége beállítható, alapból 2 óra, és negatív is lehet. | Csapat | MVP |
| SZB-07 | Szimulátor is foglalható, az időjárás nem korlátozza, a rossz idő előnyt jelent. | Csapat | MVP |
| SZB-08 | Elméleti foglalás készíthető teremmel, rossz időre preferálva, férőhely szerint; lehetőleg a legkisebb, létszámban épp megfelelő teremben. | Csapat | MVP |
| SZB-09 | Egész osztály is foglalható, a terem férőhelyének figyelembevételével. 90% részvétel elfogadható, alatta dilemma keletkezik. | Csapat | 2. kör |
| SZB-10 | A feltételek fontossága százalékos skálán állítható. | Csapat | MVP |
| SZB-11 | A beállítható értékek külön oldalon szerkeszthetők. | Csapat | MVP |
| SZB-12 | A nappali feladatok csak napkelte és napnyugta közé kerülnek. | Új | MVP |
| SZB-13 | Megadható az oktató heti munkaidő-ablaka. Naponként megadható az operáció kezdete és vége, ezen belül pedig tiltott időszakok vehetők fel (SZB-14). | Új | MVP |
| SZB-14 | A FlightLogger ráérésein túl a programban is megadhatók időszakok, amelyekre a rendszer semmiképp nem tesz foglalást. Ez az oktató személyes beállítása, a saját ráérését tükrözi. | Csapat | MVP |
| SZB-15 | A hét későbbi, bizonytalan időjárású napjain a rendszer a repülést előnyben tartva standby elméleti foglalást ajánlhat. | Csapat | MVP |
| SZB-16 | A rossz idő küszöbe globálisan beállítható, és rossz időnek számít az az óra is, amelyben a szóba jövő növendékek limitjei alapján senki sem repülhet. | Csapat | MVP |
| SZB-17 | Az adott nap hét közbeni átszervezésekor a METAR/TAF nagyobb súlyt kap, mint a modellből származó időjárás. | Csapat | 2. kör |
| SZB-18 | A foglalásokat lehetőleg olyan gépekre teszi, amelyek aznap már repülnek, hogy kevesebbszer kelljen motorpróba. Súlyozott, nem kizáró feltétel (7.3). | Csapat | MVP |
| SZB-19 | Repülési igénynél kézzel választható, hogy helyi vagy útvonalas feladat. Útvonalnál megadható az indulás (alapból a bázis), az érintett repülőterek sorrendben, és a pontok közötti repült idő. A szakaszidő alapból a légvonalbeli távolságból, 90 csomóval számolt érték, amelyet a rendszer beír, és az oktató saját számolt értékre átírhat (ismeretlen koordinátánál a hátralévő repülési időből kap részt). A rendszer minden érintett repülőtér időjárását abban az időben nézi, amikor a gép ott lehet (érkezés ± 30 perc). | Új | MVP |

### 5.6 Limitek

Minden limit értéke állítható a beállításokban, az oktatói, a növendéki és a pihenőidő-limitek is. Az első beállításkor meg kell adni őket, ehhez ajánlott alapértékek jelennek meg.

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| LIM-01 | Ellenőrzi az oktató repült idejét a napi, heti, havi és éves limitekhez. | Csapat | MVP |
| LIM-02 | Limit-túllépésnél is foglalhat, ha muszáj, de figyelmeztet. | Csapat | MVP |
| LIM-03 | Ellenőrzi a növendékek feladat- és repültidő-limitjeit a training manual alapján. A limiteket az oktató a beállításokban adja meg. | Csapat | MVP |
| LIM-04 | Ellenőrzi a pihenőidőt az oktatónál és a növendéknél. | Csapat | MVP |
| LIM-05 | A limitek szabálytáblázatban, forrásdokumentummal kezelhetők. | Új | MVP |
| LIM-06 | A limitszámítás a már repült idő mellett a tervezett repüléseket is tartalmazza. | Új | MVP |
| LIM-07 | A limit-kihasználtság áttekintő nézetben látszik. | Új | 2. kör |

### 5.7 Tervezés, dilemmák, tervezet

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| TRV-01 | A tervezés az elméletek foglalásával kezdődik, és hetente vagy hét közben is indítható. | Csapat | MVP |
| TRV-02 | Az elmélethez fix vagy preferált időpont adható. | Csapat | MVP |
| TRV-03 | Időpont nélkül az elmélet rossz időre kerül, megfelelő teremmel. Ez a hely az előtervezésben még módosulhat. | Csapat | MVP |
| TRV-04 | A vitás helyzeteket a tervezet előtt egyenként jóváhagyatja. | Csapat | MVP |
| TRV-05 | Minden dilemmához ajánlást és pro-kontra érveket ad. | Csapat | MVP |
| TRV-06 | Választható az egyik, a másik, vagy mindkettő foglalása. Ha csak az egyik kerül be, a rendszer a másiknak új időpontot keres. | Csapat | MVP |
| TRV-07 | A foglaláshoz komment adható, például standby jelzésére. | Csapat | MVP |
| TRV-08 | A dilemmák élőben frissülnek a korábbi döntések alapján. | Csapat | MVP |
| TRV-09 | A tervezeten utólag komment szúrható be. | Csapat | MVP |
| TRV-10 | A tervezeten a foglalások szabadon mozgathatók. | Csapat | MVP |
| TRV-11 | Mozgatáskor azonnal újraellenőrzi a feltételeket. | Új | MVP |
| TRV-12 | A korábbi dilemma-döntés visszavonható. | Új | MVP |
| TRV-13 | Egy foglalás rögzíthető, így újratervezéskor nem mozdul. | Új | 2. kör |
| TRV-14 | Rögzítési listát ad a FlightLogger mezősorrendjében, másolható értékekkel. | Új | MVP |
| TRV-15 | Hét közbeni változásnál a lehető legkevesebb módosítással javasol változtatást, a tervet csak az oktató módosítja. | Új | 2. kör |
| TRV-16 | A dilemmák után foglalatlanul maradt igényekhez a rendszer ajánlott, felülírható időpontot ad, és ezek utólag befoglalhatók. | Csapat | MVP |
| TRV-17 | A foglalatlan igény későbbre halasztható, ilyenkor átkerül a következő heti igények listájába. | Csapat | MVP |
| TRV-18 | Az oktató a hét közben bármikor visszaléphet az előtervezésre, és az újratervezés pillanatánál későbbi foglalásokat az új adatok alapján újratervezheti. | Csapat | MVP |
| TRV-19 | Az elkönyvelt feladatok automatikusan kikerülnek az igénylistából. | Csapat | MVP |
| TRV-20 | Az igénylistához bármikor lehet hozzáadni és elvenni belőle, utána az előtervezés újrafuttatható. | Csapat | MVP |
| TRV-21 | Az igény felvételénél megadható a briefing, a repülés és a debriefing ideje. A mezők alapértékekkel előtöltve jelennek meg. | Csapat | MVP |

### 5.8 Közös briefing csapatok

Bizonyos feladatoknál több növendék egyszerre kezd, közös briefinggel, egymás után repül, és a végén közös a debriefing. Így az oktató lefoglalt idejéből nagyobb rész repült idő: 4 növendéknél egy géppel 540 helyett 350 perc, ugyanannyi, 240 perc repüléssel. A megvalósítás részletei a projekt `docs/kozos-briefing-terv.md` fájljában vannak.

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| KBR-01 | A csapat tagjainak foglalása azonos időben kezdődik és végződik. A közös briefing után a tagok egymás után repülnek, a végén közös a debriefing; a repülési ablak tagonként más. | Csapat | MVP |
| KBR-02 | Két egymás után repülő, azonos gépre kerülő, feladattal rendelkező tag egy multi student foglalás (pár). A többi tag egyéni foglalást kap, a páratlan maradék és a más gépen repülő is. Sorrend: napi sorrend, majd prioritás. | Csapat | MVP |
| KBR-03 | A Heti igények „Közös briefing szervezése” ablaka feladatkódonként mutatja az azonos feladatú igényeket. Húzással vagy választóval csapatokba rendezhetők, feladatonként több csapat is lehet. Magától senkit nem tesz csapatba. | Csapat | MVP |
| KBR-04 | Kézi csapatba szervezés az igénysorban: az első kattintás új kézi csapatot nyit, a következő igény a legutóbb létrehozott kézi csapatba kerül. Új csapat, áthelyezés és kivétel is választható; az ablakban létrehozott csapatba magától nem tesz. | Csapat | MVP |
| KBR-05 | A tagság az igényhez tartozik: törléssel, levétellel és halasztással a csapatból is kikerül. Egy tag egyedül nem csapat. A halasztott igény csapat nélkül megy át a következő hétre. | Új | MVP |
| KBR-06 | Jelzés, ha a csapat egy főre fogyott, vegyes feladatú, vagy a tag nem lehet csapattag (például fix időpontú). Csendes törlés nincs. | Új | MVP |
| KBR-07 | A motor a csapatot egyben helyezi el: a fix időpontok után, a többi igény előtt, a limitet a csapattársakkal együtt nézve. Ha egyben nem fér be, dilemma: figyelmeztetéssel együtt, ezen a héten egyénileg, vagy halasztás mindenkinek. | Új | MVP |
| KBR-08 | A tervezeten a csapat egyben mozog. A gépsoron a tag a saját repülésével látszik, az oktató sávján a csapat egy blokk; a tag kivehető a csapatból. | Új | MVP |
| KBR-09 | A rögzítési lista foglalásonként ad tételt: a pár multi student tétel Student 1 és Student 2 programjával és feladatával. A kezdés és a vég közös, a repülés az egységé. | Új | MVP |
| KBR-10 | Egy multi student foglalás növendékenként egy igényhez tartozik, a saját feladatával és repülési szakaszával. A megfigyelő (observer) foglalt, de nem repül. A FlightLoggerben közös kezdéssel felvett foglalások egymás közt nem kettős foglalások. | Új | MVP |
| KBR-11 | A hét közbeni figyelés a csapatot egy javaslatként helyezi át. Ha egyben sehol nem fér be, a gondban lévő tag kiválva, egyénileg kap javaslatot. | Új | MVP |
| KBR-12 | Beállítható csereidő, alapból 10 perc: a páron belül és a másik gépre váltó egységek között. Azonos gépen a fordulóidő is kitelik. | Csapat | MVP |

### 5.9 Igény-elsőbbség és plusz igények

Az oktató a heti idő kihasználtságát plusz igényekkel növelheti: a kész terv mellett a rendszer megmondja, melyik növendék melyik feladata fér még be, és ebből rendes igény vehető fel. Hogy a plusz igény ne szoríthassa ki a kézzel előre felvettet, az igények 1–5 elsőbbséget kapnak. A megvalósítás részletei a projekt `docs/plusz-igenyek-terv.md` fájljában vannak.

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| ELS-01 | Igényenként 1–5 elsőbbség adható, az 1 a legfontosabb. Alapból 1, a plusz igényé 3; mindkét alapérték a beállításokban állítható. | Csapat | MVP |
| ELS-02 | A motor elsőbbségi sorrendben helyez el. Alacsonyabb elsőbbségű igény nem veheti el egy magasabb elsőbbségű helyét, és nem változtat a helyén. Kivétel az oktató döntése, a fix időpont és a FlightLoggerben lévő foglalás. | Csapat | MVP |
| ELS-03 | Verseny-dilemma csak azonos elsőbbségű igények között keletkezik. Cserét a „nincs hely” dilemma csak azonos vagy alacsonyabb elsőbbségű igény helyére ajánl. | Új | MVP |
| ELS-04 | A közös briefing csapat elsőbbsége a legfontosabb tagjáé. | Új | MVP |
| ELS-05 | Az automatikus feladatkiosztás a növendék igényeinek elsőbbsége, azon belül a lista sorrendje szerint ad egymást követő feladatokat, és a motor időben is ebben a sorrendben helyezi el őket. | Új | MVP |
| KIT-01 | „Van még hely?” gomb a Heti igényeken és a Tervezeten: a motor a mostani terv mellett megkeresi, melyik növendék melyik feladata fér még be a héten tiszta, repülésnél repülhető idejű, legalább 2 óra múlva kezdődő helyre. Az oktatói és növendéki limitek a szokásos módon számítanak. | Csapat | MVP |
| KIT-02 | A lista növendék, azon belül feladat szerint választható. Elöl az automatikus következő feladat, utána legfeljebb 5 kézzel választható, végül a „feladat nélkül”. A növendék más igénye által tartott, a FlightLoggerben lefoglalt és a teljesített feladat nem választható. Elöl, aki régebben repült, aztán a magasabb foglalási prioritású; a ráérés nélküliek a végén, jelölve. | Csapat | MVP |
| KIT-03 | Akinek halasztott igénye van, annál új igény helyett a halasztott visszahozása szerepel; ilyenkor csak a halasztás szűnik meg. Zárolt (H07) vagy elutasított visszahozásnál a növendék kimarad. | Új | MVP |
| KIT-04 | Kiválasztáskor próbaszámolás mutatja, hová kerülne az igény, és ki mozdulna vagy szorulna ki. Amit csak dilemmával vagy kiszorítással lehetne felvenni, azt a rendszer nem ajánlja. | Új | MVP |
| KIT-05 | A felvett igény rendes igény időpont nélkül, a kitöltő elsőbbséggel, ugyanazzal a felvétellel, mint a Heti igényeken. A felvétel visszavonható. | Csapat | MVP |
| KIT-06 | Nyitott dilemmák mellett (a standby-ajánlást nem számítva) a keresés előbb a dilemmákhoz küld, mert a szabad hely a döntéseken múlik. | Új | MVP |
| KIT-07 | A hét közbeni figyelés a visszahozható halasztott igényeket visszahozottnak véve a következő 2 napra is keres, és egyetlen összefoglaló tétellel jelez a rögzítési listán és az indítópulton. A megadott ráérés nélküli növendék nem ad jelzést. A jelzés napra szólóan elutasítható. | Csapat | MVP |
| KIT-08 | A halasztott igény visszahozása és a plusz igény ugyanazzal a próbaszámolással dönt. | Új | MVP |

**Miért szabály, és nem súly.** A motor elsőbbségenként, rétegekben helyez el: előbb az összes 1-es igényt, utána a 2-eseket, és így tovább. Súllyal ez nem garantálható, mert a mohó elhelyezés a szűkösség szerint halad, és egy súly csak a rangsort tolja el. A növendék foglalási prioritása (NOV-12, ott az 5 a legfontosabb) súly marad, és azonos elsőbbségen belül hat. Ha minden igény 1-es, a terv ugyanaz, mint az elsőbbség bevezetése előtt.

**A kiszorult plusz igény.** Ha később egy fontosabb igény vagy adatváltozás elveszi a plusz igény helyét, és nincs más helye, rendes „nincs hely” dilemma keletkezik, ajánlásként halasztással. A FlightLoggerbe már rögzített plusz foglalást az elsőbbség nem mozdítja.

**Ismert korlát.** A gyors lista a mostani tervhez mér, ezért nem találja meg azt a plusz igényt, amely csak egy másik plusz igény átrendezésével férne be. A kézi igényeket ez nem érinti. „Helycsinálás” (fontosabb igény áthelyezése egy plusz igény kedvéért) nincs.

### 5.10 FlightLogger-import

A rögzítési lista foglalásai a FlightLogger saját foglalási ablakában, pár kattintással kerülnek fel. Egy Tampermonkey-szkript tölti ki az ablakot a vágólapra másolt adatokból, a mentést minden foglalásnál az oktató nyomja meg. Az app ettől sem ír a FlightLoggerbe (ALP-03), és hálózatot sem használ hozzá (ALP-02). A felhasználó döntése: 2026. november 22. A megvalósítás részletei a projekt `docs/flightlogger-import-terv.md` fájljában vannak.

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| FLI-01 | Az elméleti igénynek típusa van, a FlightLogger elméleti foglalástípusai szerint: Meeting (alapértelmezett), Ground training vagy Extra theory. Extra theorynál növendékenként külön foglalás készül. | Csapat | MVP |
| FLI-02 | A rögzítési lista tételei a FlightLogger foglalási ablakának szerkezetét követik: foglalástípus, oktató, növendékek programmal és feladattal, résztvevők, gép vagy terem, Briefing, Start, End, Debriefing és komment. | Csapat | MVP |
| FLI-03 | A tételek egyenként és egyben is vágólapra másolhatók importcsomagként. | Csapat | MVP |
| FLI-04 | A szkript a FlightLogger foglalási áttekintőjén Import gombot ad. Ide illeszthetők be a csomagok egy listába; a lista törölhető. | Csapat | MVP |
| FLI-05 | A lista foglalásai a naptár megfelelő sorában (gép, terem, oktató) halványan megjelennek, mindig a látható napon, a briefingtől a debriefingig, a repülési szakasz kiemelve. A FlightLogger meglévő foglalásával átfedő előnézet a következő sávba kerül (a sor megnyúlik), nem mögé. A naptár tetején egy sor az oktató aznapi összes foglalását mutatja (a FlightLoggerben lévőket és a listán lévőket), az átfedőket egymás alatt. Ez csak megjelenítés. | Csapat | MVP |
| FLI-06 | „Foglalás megkezdése”: a szkript a FlightLogger saját ablakát nyitja meg és tölti ki. A mentést mindig az oktató nyomja meg; utána a következő foglalás ablaka magától, kitöltve nyílik. A szkript nem használ API-t, és nem nyomja meg a mentést. | Csapat | MVP |
| FLI-07 | Amit a szkript nem tud egyértelműen kitölteni, azt mentés előtt felsorolja, hogy az oktató pótolja. | Új | MVP |
| FLI-08 | Mentés után a szkript visszaigazolást ad a vágólapon. Az app beolvassa, és a létrehozott tételeket rögzítettnek jelöli. | Csapat | MVP |
| FLI-09 | A telepítés és a használat leírása a beállításokban, külön fülön; a szkript onnan másolható. | Csapat | MVP |
| FLI-10 | A csomag és a lista csak a vágólapon és a böngésző helyi tárában van, hálózaton nem megy sehova. | Új | MVP |
| FLI-12 | A FlightLoggerbe felvitt foglalás kitöltőszíne típusonként a beállításokban adható meg (vagy nincs szín); a szkript ezt állítja be. | Csapat | MVP |
| FLI-13 | Az igény űrlapján a tervezéshez szükséges mezők kiemelve, a csak a FlightLoggerbe kerülők (típus, program, tárgy, komment) külön, összecsukva. A program és a tárgy töredékkel is megadható: a szkript a FlightLogger listájában a legjobban illőt választja, több egyformán jó találatnál nem találgat. | Csapat | MVP |
| FLI-14 | A FlightLoggerben átírandó (áthelyezendő, 9.7) tétel is importálható: a szkript a régi napra lapoz, megnyitja a meglévő foglalást (Update booking), és átírja a helyét (időpontok, gép vagy terem); ha a foglalás összetétele is változik (vegyes vagy szétvált közös briefinges pár), a típust és a növendékeket is. Egy foglalást egy tétel ír át, a többi újat kap; a fölöslegessé vált foglalás lemondásra kerül. Több növendékes extra elméletnél a növendékenkénti foglalásokat írja át. Az Update-et az oktató nyomja meg; a visszaigazolás az áthelyezést lezárja. | Csapat | MVP |
| FLI-15 | A tervbe tett lemondás (9.7) is importálható: a szkript megnyitja a foglalást, és kiemeli a Cancel gombot; a lemondást és amit a FlightLogger még kér, az oktató végzi. Kész, ha a foglalás eltűnt vagy lemondottá vált; különben megáll. A visszaigazolás a lemondást elvégzettnek jelöli. | Csapat | MVP |
| FLI-16 | A naptár tetején lévő oktatói sorban egy foglalásra kattintva a FlightLogger-naptárban lent ugyanaz a foglalás (vagy az importtétel előnézete) keretet kap, és oda görget; újabb kattintás vagy Esc megszünteti. | Csapat | MVP |
| FLI-11 | Az elméleti igénynél megadható, amit a FlightLogger ablaka kér: Ground trainingnél osztály, program, tárgy, Session type és Session, Extra theorynál program. A program- és tárgylista a FlightLogger API-jából jön (csak olvasás, az oktató kulcsával); ha az üres, a mezők szabad szöveggel is kitölthetők. Az import ezeket is kitölti. | Csapat | MVP |

### 5.11 Frissítés és kiadás

A program a GitHubról frissül. Két változat van, egymás mellett telepíthetők: a **Foglalástervező** (fő kiadás, a `main` ágról) és a **Foglalástervező DEV** (fejlesztői kiadás, a `dev` ágról). A fejlesztő a DEV-változaton próbálja ki az újdonságot, és ha megfelel, a DEV-ben egy gombbal fő kiadássá teszi, amelyet minden felhasználó megkap. A DEV csak macOS-re készül. A felhasználó döntése: 2026. november 24. (nyilvános repó: `basicir/flightbooker`); a DEV-re vonatkozó kiegészítések (csak macOS, kiadás gomb, beállítás-átvétel): 2026. november 25. A megvalósítás részletei a projekt `docs/kiadas-es-frissites.md` fájljában vannak.

| ID | Követelmény | Eredet | Fázis |
| --- | --- | --- | --- |
| FRS-01 | A program minden indításkor megnézi, van-e a csatornáján újabb kiadás. Ha nincs (vagy nincs hálózat), simán megnyílik; az ellenőrzés legfeljebb 10 másodpercig tart, és kihagyható. | Csapat | MVP |
| FRS-02 | A frissítés csak a program saját GitHub-repójának kiadáslistáját és kiadási fájljait kéri le, GET-tel, hitelesítés és személyes adat nélkül (ALP-02). | Új | MVP |
| FRS-03 | A kiadási fájl a github.com letöltési címéről jön, legfeljebb egy átirányítással a GitHub fájltárhelyére; más átirányítást a program nem követ. | Új | MVP |
| FRS-04 | Minden kiadáshoz aláírt leírás tartozik (Ed25519): fájlonként a méret és a SHA-512 lenyomat. A program a beépített nyilvános kulccsal ellenőrzi az aláírást, a csatornát, a verziót és a letöltött fájlt; bármilyen eltérésnél nem telepít. | Új | MVP |
| FRS-05 | Két csatorna: a `main` ág fő kiadása (`X.Y.Z`) és a `dev` ág fejlesztői kiadása (`X.Y.Z-dev.N`). A két program külön azonosítójú, nevű, ikonú, parancsikonú és adatmappájú; mindegyik csak a saját csatornáját követi. A fő kiadás macOS-re (Apple Silicon, Intel) és Windowsra készül, a DEV csak macOS-re. A verziót a kiadási folyamat számolja, kézi léptetés nélkül. | Csapat | MVP |
| FRS-06 | „Automatikus frissítés” jelölőnégyzet a beállításokban, alapból bekapcsolva. Kikapcsolva a program csak jelzi az új verziót, és a telepítést a felhasználó indítja. A beállítás gépenkénti, az exportba nem kerül. Kézi ellenőrzés is van. | Csapat | MVP |
| FRS-07 | A telepítés magától történik: macOS-en a program kicseréli a saját alkalmazáscsomagját és újraindul (az Alkalmazások mappából indítva; máshonnan felajánlja az áthelyezést), Windowson a felhasználónkénti telepítő csendben fut, majd elindítja a programot. Az első telepítés DMG-ből, illetve telepítővel történik, asztali (Windows) és Start menü parancsikonnal. | Csapat | MVP |
| FRS-08 | Kiadás: push a `dev` ágra → fejlesztői kiadás; a „Kiadás: dev → main” gomb (a DEV-ben, FRS-09, vagy a GitHub Actions oldalán), illetve egy dev → main pull request összefésülése → fő kiadás. Előtte a típusellenőrzés, a lint és a tesztek lefutnak; ha bármelyik hibás, nincs kiadás. A legutóbbi 10 fejlesztői kiadás marad meg. | Csapat | MVP |
| FRS-09 | A Foglalástervező DEV Beállítások → Frissítés fülén „Kiadás: dev → main” gomb: megerősítés után a futó DEV-csomag commitját adja ki fő kiadásként (akkor is, ha a `dev` ágon azóta újabb változás van), és mutatja a kiadás állapotát. A fejlesztő egyszer megadott GitHub-tokenjével működik (csak a saját repóra, „Actions: írás” joggal), amely az API-kulcshoz hasonlóan a rendszer titoktárolójába kerül, és sehol nem jelenik meg. Csak a DEV-ben létezik: a fő változatban sem a gomb, sem a funkciója (a főfolyamat kezelője, a hálózati kérés) nem érhető el. | Csapat | MVP |
| FRS-10 | A Foglalástervező DEV átveheti a fő változat beállítását (a növendékekkel), mentett heti terveit, saját feladatsorait és a modellpontosság mérését: első indításkor magától (ha a DEV-nek még nincs beállítása), később gombbal (Beállítások → Frissítés, illetve az első beállítás); a DEV-é felülíródik, a fő változaté nem változik, a DEV gyorsítótára törlődik. Az API-kulcs nem jön át (ALP-06): a DEV-ben külön kell megadni. | Csapat | MVP |

**Ismert korlátok.** Apple-fejlesztői tanúsítvány (évi 99 USD) nélkül macOS-en az első indításnál a Rendszerbeállítások → Adatvédelem és biztonság → „Megnyitás mindenképp” kell, Windowson a SmartScreen „További információ → Futtatás mindenképp” lépése; a program saját frissítései ezt már nem kérik. macOS-en frissítés után a Kulcskarika egyszer jelszót kérhet az API-kulcs titkosítókulcsához („Mindig engedélyez”), mert az aláírás nélküli program minden verziója más azonosítójú. Tanúsítvánnyal mindkettő megszűnik; ez külön döntés.

## 6. A heti tervezés folyamata

A tervezés az elméletekkel indul, a dilemmákon át a tervezetig tart, és a kézi rögzítéssel sem ér véget. Az oktató ott dönt, ahol a rendszer nem tud egyértelműen választani. Alapesetben szombat vagy vasárnap körül készül az egész hétre, és hét közben ugyanezekkel az elvekkel módosítható.

&#91;embedded content: heti tervezés · 9 lépés, 3 visszacsatolás\]

**Egyszer: első beállítás.** Az oktató megadja az API-kulcsot, megjelöli a szimulátorokat, kategóriákba sorolja a gépeket, felveszi a termek férőhelyét. Itt rendeli hozzá a növendékeit, és itt ellenőrzi a limit-szabályok ajánlott alapértékeit.

**Megnyitáskor: indítási ellenőrzés.** A rendszer frissít, és jelzi, ha változott a gépek vagy termek listája. Ha aznap még nem volt megadva a kirepülhető idő, bekéri.

**Hetente vagy hét közben: tervezés**

1. **Adatfrissítés.** A rendszer beolvassa a foglalásokat, ráéréseket, haladást, logbookot és az előrejelzést.
2. **Heti igények.** Az oktató kiválasztja a növendékeket. A rendszer a kiválasztott növendékekből és a haladásukból igénylistát ad, amelyet az oktató szerkeszthet. A lista tartalmazza az előző hétről halasztott igényeket is. Az elkönyvelt feladatok automatikusan kikerülnek belőle, és bármikor lehet hozzáadni vagy elvenni. Felvételkor a briefing, a repülés és a debriefing ideje alapértékekkel előtöltve jelenik meg, és átírható. Igényenként elsőbbség adható (1–5, alapból 1): a fontosabb igény előbb kap helyet (ELS-01, ELS-02).
3. **Elméletek.** Az oktató hozzáadja a szükséges elméleteket, fix vagy preferált időponttal. Az időpont nélküliek ideiglenesen rossz időre kerülnek, megfelelő teremmel.
4. **Előtervezés.** A motor elhelyezi az egyértelmű igényeket, és összegyűjti a vitás helyzeteket.
5. **Dilemmák.** Az oktató egyenként dönt, a még hátralévő dilemmák minden döntés után frissülnek. A végén a foglalatlan igények ajánlott időpontot kapnak, vagy a következő hétre halasztódnak.
6. **Tervezet.** Az oktató szabadon mozgathatja a foglalásokat, és kommentet adhat hozzájuk. Minden mozgatásnál azonnal látja a következményeket. A „Van még hely?” gombbal (a Heti igényeken is) megnézheti, kinek fér még be feladata a héten, és plusz igényt vehet fel (KIT-01–06).
7. **Újraellenőrzés.** A rendszer összeveti a tervet a FlightLogger friss állapotával. Ha közben valaki lefoglalta a helyet, az érintett tétel visszakerül a tervezetbe.
8. **Kézi rögzítés.** A rendszer tételenként, a FlightLogger űrlapjának sorrendjében adja a másolható értékeket. Az oktató felviszi a foglalást, a rendszer pedig a következő frissítéskor felismeri.
9. **Hét közbeni figyelés.** Romlik az előrejelzés, lemondanak egy órát vagy kiesik egy gép: a rendszer jelzi, és a lehető legkevesebb módosítással javasol változtatást, de magától nem módosítja a tervet. Az oktató a hét közben bármikor visszaléphet az előtervezésre, ilyenkor az újratervezés pillanatánál későbbi foglalásokat a rendszer az új adatokkal újratervezi. A FlightLoggerben már rögzített foglalások változása a rögzítési listán eltérésként jelenik meg. A következő 2 napra azt is jelzi, hol van még hely plusz igénynek (KIT-07).

**Döntés: az elméletek sorrendje.** A csapat az elméletekkel kezd, ami a kiszámítható időpontoknál helyes. A rossz idő viszont szűkös, és az elmélet meg a szimulátor ugyanazokra az órákra pályázik. A fix és preferált elméletek az első lépésben rögzülnek, az időpont nélküliek ideiglenes helyet kapnak, és az előtervezésben még mozoghatnak.

## 7. A foglalási motor

A motor kizáró feltételekkel szűr, súlyozott pontokkal rangsorol, és csak a valóban vitás helyzeteket viszi az oktató elé. A százalékos súly csak a rangsorra hat, a kizáró feltételekre soha.

### 7.1 Működés

1. **Igények sorba rendezése.** A legnehezebben elhelyezhető igény kerül előre: fix időpont, kevés ráérés, kevés engedélyezett gép.
2. **Jelölt helyek.** Minden igényhez elkészül a lehetséges idő- és erőforrás-párok listája a hét, a napi operációs idő és a munkaidő-ablak alapján.
3. **Szűrés.** A kizáró feltételt sértő jelöltek kiesnek.
4. **Pontozás.** A megmaradt jelöltek feltételenként 0 és 1 közötti részpontot kapnak, ezek súlyozott átlaga a végső pont.
5. **Elhelyezés és dilemma-felismerés.** Az egyértelmű igény a legjobb helyére kerül, a vitás a dilemmák közé (9. fejezet).
6. **Újraszámolás.** Minden elhelyezés után frissül a szabad helyek listája, a gép napi első repülése és a limitek kihasználtsága.

Az oktatónként várható kis elemszám (10–15 növendék, heti nagyjából 20 foglalás) miatt a pontos megoldó helyett elég lehet egy mohó elhelyezés helyi javítással. Ezt a tesztadatokon kell igazolni.

### 7.2 Feltételszintek

| Szint | Példák | Viselkedés |
| --- | --- | --- |
| Kizáró | A gép inaktív vagy karbantartásra foglalt. A növendék nem repülhet vele. Nem marad elég kirepülhető idő. Nappali feladat sötétben. A terem kicsi az osztálynak. Az időpont az operációs időn kívül vagy tiltott időszakra esik. | Nem jelenik meg javaslatként. A tervezeten az oktató kézzel felülbírálhatja, figyelmeztetéssel. |
| Figyelmeztetéssel engedhető | Limit vagy pihenőidő túllépése. Kettős foglalás. Ráérésen kívüli időpont. | Csak dilemmaként jelenik meg, és kifejezett jóváhagyás kell hozzá. |
| Súlyozott | Preferált gép, időbeli sorrend, tartalék, régen repült növendék. | Pontot ad vagy von le, nem kér döntést. |

**A gép kiesése.** Az iskola a gép kiesését nem elérhetőségi eseménnyel, hanem hosszú foglalással jelzi: karbantartási (`MaintenanceBooking`) vagy operációs foglalással, akár több hétre vagy egy évre. Ezek kizáró feltételek, a motor nem szűrheti ki őket kiugró adatként. A több napos megbeszélés (`MeetingBooking`) a résztvevők idejét foglalja.

### 7.3 Súlyok

A súlyok a fő beállításokban állíthatók. A 0% azt jelenti, hogy a feltétel nem számít, a 100% a legerősebb, de nem kizáró hatást. A javasolt értékek kiindulópontok, a teszt során finomítandók. A számítást és a példákat a [súlyozási dokumentum](https://claude.ai/artifact/EULdBSqMNfCfFSDtBZmTzR) tartalmazza.

| Feltétel | Mit mér | Javasolt súly |
| --- | --- | --- |
| Időjárás repülésnél | Mennyire esik az óra a növendék limitjein belülre | 90% |
| Régen repült növendék | Az utolsó repülés óta eltelt napok a küszöbhöz képest, szokatlan gépen csökkentett előnnyel | 80% |
| Szűkösség | Hány elfogadható hely marad az igénynek a héten | 70% |
| Rossz idő illesztése | Mennyire rossz repülésre az óra, elméletnél és szimulátornál | 70% |
| Foglalási prioritás | A növendék 1–5-ös prioritása, ha két növendék verseng | 65% |
| Terv stabilitása | Újratervezéskor mennyire tér el a korábbi tervtől | 50% |
| Gépóra-tartalék | Mennyi idő marad a gépben a heti foglalások után | 50% |
| Preferált gép | A preferált gép vagy kategória jut-e a növendéknek | 35% |
| Kevesebb motorpróba | A foglalás olyan gépre kerül-e, amely aznap már repül; a napi első repülés motorpróbája sok idő (SZB-05, SZB-18) | 40% |
| Időbeli sorrend | Mennyire követi a növendékek preferált sorrendjét | 30% |
| Oktató napi terhelése | Mennyire egyenletes a heti beosztás | 30% |
| Preferált terem | A preferált terem jut-e az elméletnek | 20% |
| Megfelelő teremméret | A legkisebb terem-e, amelybe a résztvevők még beférnek (SZB-08) | 40% |

A végső pont a részpontok súlyozott átlaga, ezért a súlyoknak nem kell 100%-ra összegződniük:

```latex
\text{Pont} = \frac{\sum_i w_i \, s_i}{\sum_i w_i}
```

Itt w a feltétel súlya, s a 0 és 1 közötti részpontja. A rendszer minden javaslatnál megmutatja a legnagyobb hatású feltételeket.

### 7.4 Időjárás

A repülés a jó órákat keresi, a szimulátor és az elmélet a rosszakat. Az órák növendékenként három osztályba kerülnek: repülhető, bizonytalan, nem repülhető. Rossz időnek számít az az óra, amely a globálisan beállított küszöbön kívül esik, vagy amelyben a szóba jövő növendékek limitjei alapján senki sem repülhet.

A minősítés két rétegű. Az iskolai minimum minden növendékre érvényes, a növendéki limit pedig preferencia, ezért csak pontoz. Az [AMC1 ORA.ATO.230(b)](https://www.aerocomsystem.com/e-system/amcgmText/list.html?show_code=ORA.ATO.230&part_code=ORA&limit_date=2017/02/26&amcgm_id=1657) a növendéki minimumokat képzési szakaszonként említi, ezt a teszt idején nem kezeljük.

| Előrejelzés távolsága | Modell szintje | Kezelés |
| --- | --- | --- |
| 0–2 nap | ICON-EU, mert a D2 nem fedi le az LHNY-t | Az iskolai minimumon kívüli óra kizáró, a növendéki limiten kívüli nagy pontlevonás. |
| 3–5 nap | ICON-EU, kb. 4,7 napig | A limiten kívüli óra pontlevonás, a tervezeten bizonytalannak látszik. |
| 6 naptól | best\_match, durvább modell, kb. 6 napig | Csak enyhe pontlevonás, a nap megbízhatatlanként jelölve. |

**Standby elmélet bizonytalan napokra.** Ha a hét későbbi szakaszában nem egyértelmű az időjárás, a repülés marad az elsődleges foglalás, és a rendszer mellé standby elméleti foglalást ajánlhat. Az ajánlás dilemmaként jelenik meg, és az oktató hagyja jóvá. A standby elmélet is termet foglal, ezért a terem szabadságát ugyanúgy ellenőrizni kell.

**METAR/TAF az adott napra.** Ha az oktató az adott napot szervezi át hét közben, az időjárási pontszámban a METAR/TAF nagyobb súlyt kap, mint a modell. A többi napra a modell marad az alap.

### 7.5 Feladatválasztás

Három mód van, amely globálisan beállítható és foglalásonként felülírható: automatikus, kézi, illetve feladat nélküli. Feladat nélküli foglalásnál az időtartam a növendék alapértékéből jön.

Az automatikus mód szabályai:

- A programban az utolsó teljesített feladat után következő feladatot választja.
- Sikertelen teljesítésnél (`failedPerformance`) ugyanazt a feladatot ismétli.
- A már lefoglalt jövőbeni feladatokat átugorja.
- Ha egy héten több feladat követi egymást, a későbbi a korábbi sikerétől függ. A tervezet ezt feltételezésként jelzi.
- Több automatikus igénynél a fontosabb igény kapja a korábbi feladatot, azonos elsőbbségen belül a lista sorrendje dönt. A motor időben is sorban tartja őket: a későbbi feladat nem kerülhet a korábbi elé (ELS-05). A FlightLoggerben lefoglalt feladat a helyén számít, a kézzel választott feladatra a sorrend nem vonatkozik.

**Élő adat (2026. november 10.).** Az iskolai kulccsal a programszerkezet (`programs`, `userPrograms`) üres, ezért a következő feladat nem olvasható ki a programból. A feladat és a tervezett percei csak az elvégzett `Training` felől látszanak: a briefing 45, a debriefing 30, a repülés 30–180 perc. Az automatikus mód forrását a K36 dönti el.

### 7.6 Gépóra-gazdálkodás

A gép akkor választható, ha a tartalék a beállított minimum (alapból 2 óra) felett marad. Több alkalmas gép közül a nagyobb tartalékú kap több pontot. A minimum negatív is lehet. Ez tervezési túlfoglalást jelent, a karbantartási határ a tényleges repülésre továbbra is érvényes. A tartalék arra szolgál, hogy ha közben újabb foglalás érkezik a gépre, ne kelljen feltétlenül lemondani.

```latex
\text{Tartalék} = \text{kirepülhető idő} - \text{már lefoglalt repülések} - \text{tervezett repülések}
```

A számításhoz minden esetben a foglalásban megadott repülési időt használjuk, vagyis a `flightStartsAt` és a `flightEndsAt` közötti időt.

## 8. Limitek és szabályozás

A limiteket szabálytáblázatként kell kezelni, a számokat az iskola jóváhagyott kézikönyvéből kell venni. Az EASA ismert repült idő limitjei légi fuvarozókra szólnak, az oktatókra való alkalmazásuk nem magától értetődő.

### 8.1 Amit a szabályokban találtunk

- Az [ORO.FTL.210](https://legislation.gov.uk/eur/2014/83/annexes/adopted) szolgálati időre 60/110/190 órát ír elő 7/14/28 egymást követő napra. Repült időre 100 órát 28 napra, 900-at naptári évre, 1000-et 12 naptári hónapra.
- Az [ORO.FTL.235](https://legislation.gov.uk/eur/2014/83/annexes/adopted) szerint a pihenőidő a bázison legalább az előző szolgálat hossza, de minimum 12 óra.
- Ezek a pontok a rendelet „Commercial Air Transport Operators” szakaszában vannak. Az ORO.FTL.100 hatálya az üzemeltetőkre és személyzetükre szól, a képzőszervezetet nem említi.
- Az [AMC1 ORA.ATO.230(b)](https://www.aerocomsystem.com/e-system/amcgmText/list.html?show_code=ORA.ATO.230&part_code=ORA&limit_date=2017/02/26&amcgm_id=1657) szerint az ATO üzemeltetési kézikönyve tartalmazza az oktatók és növendékek repült idő, szolgálati és pihenőidő előírásait.
- Ugyanez a pont előírja az oktatói és a képzési szakaszonkénti növendéki időjárási minimumokat, valamint a rossz időben repülő gépek számának korlátozását.
- Az EASA [közösségi fórumán](https://www.easa.europa.eu/community/topics/flight-instructors-fatigue-reports) hozzászólók azt írják, hogy ATO-oktatókra nincs számszerű EASA-limit. Ez nem jogforrás, csak jelzés.

A Part-ORA törzsszövegét és a konszolidált 965/2012 rendeletet nem sikerült elolvasni. A fenti szöveg az eredeti 83/2014 rendeletből és az AMC egy pontos másolatából származik, a hatályos változatot a 11. fejezet első kérdései szerint kell ellenőrizni.

**Következtetés.** A limiteket az első beállításkor kell megadni, ehhez a rendszer ajánlott alapértékeket kínál. Az oktató ezeket az iskola kézikönyve alapján ellenőrzi és átírhatja, mert az ORO.FTL értékei csak minták. A csapat listájában szereplő napi limit az ORO.FTL.210-ben nincs, ott a napi korlátot a szolgálati idő táblázata adja.

### 8.2 A limit-szabályok szerkezete

A szabály öt adatból áll, ugyanazzal a logikával, ahogy a [FlightLogger követelményei](https://help.flightlogger.net/knowledge/setting-up-and-assigning-flight-time-and-duty-time-limitation-requirements) is épülnek. A táblázat az ajánlott alapértékeket mutatja, amelyeket az oktató az első beállításkor ellenőriz, és az iskola kézikönyvei alapján átírhat.

| Alany | Mérőszám | Időablak | Ajánlott alapérték | Forrás |
| --- | --- | --- | --- | --- |
| Oktató | Repült idő | Naptári nap | 8 óra | Javaslat, kézikönyvből ellenőrizendő |
| Oktató | Repült idő | 28 gördülő nap | 100 óra | ORO.FTL.210 minta |
| Oktató | Repült idő | Naptári év | 900 óra | ORO.FTL.210 minta |
| Oktató | Repült idő | 12 naptári hónap | 1000 óra | ORO.FTL.210 minta |
| Oktató | Szolgálati idő | 7 / 14 / 28 gördülő nap | 60 / 110 / 190 óra | ORO.FTL.210 minta |
| Oktató | Pihenőidő | Két szolgálat között | Az előző szolgálat hossza, legalább 12 óra | ORO.FTL.235 minta |
| Növendék | Repült idő | Nap, hét | 4 óra naponta, 20 óra hetente | Javaslat, kézikönyvből ellenőrizendő |
| Növendék | Feladatok száma | Naptári nap | 2 feladat | Javaslat, kézikönyvből ellenőrizendő |
| Növendék | Pihenőidő | Két repülési nap között | 12 óra | Javaslat, kézikönyvből ellenőrizendő |

### 8.3 Számítási szabályok

- **Időalap.** A repült idő block time, ez a FlightLogger szerint az [EASA mozgási idő](https://help.flightlogger.net/knowledge/aircraft-time-tracking-in-flightlogger).
- **Előrevetítés.** A limit a már repült és a tervezett idő összegére nézendő, gördülő ablaknál minden tervezett napra külön.
- **Szolgálati idő.** A foglalás teljes hossza számít a `startsAt` és az `endsAt` között, nem csak a repülés.
- **Más munkahely.** A `myFlightLogger` iskolai kulccsal nem kérdezhető, ezért csak az ebben a fiókban rögzített saját repülések látszanak, és ezekből is csak a 2026. április 1. utániak. A más munkahelyen és a korábban repült időt kézi kezdőértékként kell megadni (K37).
- **Szimulátor.** Szabályonként állítható, hogy a szimulátoridő beleszámít-e, ahogy a FlightLoggerben is.
- **Viszony a FlightLoggerhez.** Az iskolánál nem aktív a limit-modul, ezért a limiteket csak ez a rendszer ellenőrzi.

### 8.4 Figyelmeztetések

A csapat kérése szerint a rendszer szükség esetén limit fölé is foglalhat. Ez csak tudatos döntésként történhet, a motor magától nem választ ilyen helyet.

| Állapot | Javasolt küszöb | Viselkedés |
| --- | --- | --- |
| Rendben | A limit 80%-a alatt | Nincs jelzés. |
| Közelít | A limit 80–100%-a | Sárga jelzés a tervezeten és a foglalásnál. |
| Túllépés | A limit felett | Dilemma, kifejezett jóváhagyás. |

Ha az iskola bekapcsolta a [foglalás tiltását figyelmeztetés esetén](https://help.flightlogger.net/knowledge/blocking-of-booking-creation-in-case-of-warnings), a FlightLogger a kézi rögzítést is megakadályozhatja. A tervezetnek ezt előre jeleznie kell.

## 9. Dilemmák és a tervezet

Dilemma akkor keletkezik, ha a rendszer nem tud felelősen választani. Ilyenkor a tervezet elkészülte előtt egyenként, ajánlással kérdez, és minden válasz után újraszámol.

### 9.1 Mikor keletkezik dilemma?

| Típus | Feltétel | Kérdés az oktatónak |
| --- | --- | --- |
| Verseny | Két azonos elsőbbségű igény ugyanazt a helyet akarja, a súlyozott előny a küszöb alatt van (javaslat: 10 egység, repülésnél kb. 2,2 pont) | Melyik kapja a helyet? |
| Figyelmeztetéses hely | Az igény csak limit-túllépéssel, kettős foglalással vagy ráérésen kívül fér be | Vállalod a figyelmeztetést? |
| Nincs hely | Az igény a héten nem helyezhető el | Mi történjen vele? |
| Fix ütközés | Két fix időpont vagy elmélet ütközik | Melyik mozduljon? |
| Alacsony részvétel | Osztályfoglalásnál a részvétel 90% alá esik | Vállalod a kisebb részvételt? |

Különböző elsőbbségű igények között nincs verseny: a fontosabb kapja a helyet (ELS-02, ELS-03). A „nincs hely” dilemma cserét csak azonos vagy kevésbé fontos igény helyére ajánl. A kiszorult plusz igény rendes „nincs hely” dilemma, ajánlásként halasztással.

### 9.2 Egy dilemma felépítése

A kártyán egy mondat mondja el az ütközést, egy másik az ajánlást, alatta az érvek állnak. A kitöltött példa csak szemléltet.

|  | A növendék kapja a péntek 9:00-t | B növendék kapja a péntek 9:00-t |
| --- | --- | --- |
| Mellette | Régen repült, és ez a preferált gépe. | Az időjárási limitje a héten csak ebben az órában teljesül. |
| Ellene | Csütörtök délután is lenne alkalmas hely. | A másik gépen is elférne, nagyobb tartalékkal. |
| Ha így döntesz | B a következő legjobb helyre kerül. | A a következő legjobb helyre kerül. |

Az oktató választási lehetőségei:

- Az egyik igény kapja az ajánlott helyet, a másik a következő legjobbat.
- Mindkettő bekerül ugyanoda, az egyik standbyként.
- Kézzel ad meg másik időpontot vagy gépet.
- Az igény későbbre halasztódik, és átkerül a következő heti igények listájába.
- Bármelyik mellé megjegyzést ír.

### 9.3 Élő frissítés

Minden döntés után a motor újraszámolja a nyitott dilemmákat. Ha az oktató péntek 9:00-ra már tett egy foglalást, a következő dilemmánál ezt a helyet nem ajánlja.

- A nyitott dilemmák száma látszik, és minden lépésnél változhat. Egyes dilemmák megszűnnek, új is keletkezhet.
- A legnagyobb hatású döntések kerülnek előre, az összefüggők egymás után jönnek.
- Egy korábbi döntés visszavonható. A rendszer megmutatja, mely későbbi döntések dőlnek meg miatta.
- A „a többit döntse el a rendszer” gomb az ajánlásokat alkalmazza. Az így hozott döntéseket a tervezet külön jelöli, a figyelmeztetéses helyeket kivéve.

**Foglalatlan igények.** A dilemmák végén a rendszer összegyűjti a még el nem helyezett igényeket. Mindegyikhez ajánl egy felülírható időpontot, amelyre az oktató utólag befoglalhatja, vagy későbbre halaszthatja. A halasztott igény átkerül a következő heti igények listájába.

### 9.4 Standby foglalás

A FlightLogger súgójában nem találtunk standby funkciót, ezért ez a mi konvenciónk, amely a foglalás `comment` mezőjére épül. A rendszer sablonszöveget ajánl, amelyet az oktató szerkeszthet.

A komment nem nevezheti meg a másik növendéket, mert azt mások is láthatják. A FlightLogger engedi az átfedést, és a növendék látja a kommentet.

### 9.5 Tervezet-nézet

- Idővonal gépek, szimulátorok és termek szerint, napi és heti nézetben. A színek a [FlightLogger színeit](https://help.flightlogger.net/knowledge/understanding-the-booking-page-colors) követik.
- A már meglévő FlightLogger-foglalások halványan látszanak, a tervezettek szerkeszthetők.
- A foglalások szabadon húzhatók és átméretezhetők, és a mozgatás sosem tiltott.
- Mozgatáskor azonnal frissül a gép első repülése, a limit, a tartalék és az időjárási jelzés.
- Kattintásra látszik a „Miért ide?”: a legnagyobb hatású feltételek és a komment.
- A foglalás rögzíthető, ilyenkor újratervezéskor nem mozdul.

### 9.6 Kézi rögzítés

A rögzítési lista időrendben, a [FlightLogger űrlapjának sorrendjében](https://help.flightlogger.net/knowledge/getting-started-with-the-integrated-booking-system) adja az értékeket: oktató, növendék, program, foglalástípus, feladat, időpontok és komment.

A tétel állapota lehet tervezett, ellenőrzött, rögzített vagy eltérő. A rendszer a következő frissítéskor gép, időpont és résztvevők alapján párosítja a FlightLogger-foglalást a tervvel.

**Párosítás (megvalósítás, 2026-11-16).** A rögzítettnek jelölt igényt a rendszer sorrendben keresi: a korábban már párosított foglalás azonosítója szerint (a FlightLoggerben áthelyezett foglalás azonosítója nem változik), a rögzített helyen (időben átfedő foglalás ugyanazon a gépen vagy teremben, az oktatóval vagy a növendékkel), végül – ha máshová tették – repülésnél a növendék és a feladat szerint (az oktató héten belüli foglalása ugyanazzal a feladattal), elméletnél a résztvevők szerint (az oktató héten belüli termes foglalása – vagy oktató nélküli megbeszélés, amelynek ő is résztvevője, mert az elméletet néha így veszik fel –, amelyen az igény minden növendéke vagy az osztálya szerepel), a rögzített időponthoz legközelebbit. A helyükön lévő foglalások párosítása minden rögzített igényre megtörténik, mielőtt a máshová tettek keresése indul. Ha a frissítés régebbi a rögzítésnél, a hely le van zárva, és az áthelyezett foglalás régi helye már nem foglal. A rögzítettnek nem jelölt igényt is felismeri a növendék és a feladat alapján: ami a FlightLoggerben már megvan, azt nem tervezi újra. A lefoglalt igény a foglalás feladatát tartja, az automatikus feladatválasztás nem ugrik tovább. Eltérés: a rögzített, de a frissebb adatban sem található foglalás, és a halasztott, de a FlightLoggerben még foglalt igény. A FlightLoggerben lévő foglalások a tervezeten és a rögzítési listán is látszanak („✓ a FlightLoggerben”).

### 9.7 Hét közbeni figyelés

A rendszer a terv mellett a FlightLoggerben lévő és a halasztott igényeket is újraértékeli a friss adattal (6. fejezet 9. lépés, TRV-15). Magától semmit nem módosít, és a FlightLoggerbe nem ír (ALP-03): egyenként, egy foglalás egy változtatásával javasol, a lehető legkevesebb módosítással. A javaslatok a rögzítési lista tetején vannak; az indítópult összefoglalja őket.

**Foglalási terv, aztán FlightLogger.** Az elfogadott javaslat előbb csak a foglalási tervbe kerül („Foglalási tervbe teszem”); a FlightLoggerben akkor végzi el az oktató, amikor neki alkalmas. Ez nem külön állapot: az igény rendes tervezett tétel lesz, a javasolt hely kézi döntésként kerül be (a hely tisztaságáig áll, H08), és a motor ugyanúgy tervezi tovább, mint a többit. Csak egy **FlightLogger-jelölést** kap: már van foglalása, amelyet át kell írni (nem újat felvinni), illetve halasztásnál le kell mondani. A jelölés nélkül a repülést a növendék és a feladat alapján a régi helyén ismerné fel újra, az elméletnél pedig a régi foglalás idegen foglalásként maradna, és a rögzítési lista újat vetetne fel. A jelölt igény régi FlightLogger-helye nem foglal; a rögzítési listán „áthelyezendő / lemondandó a FlightLoggerben” teendő, a mostani hellyel és az új hely másolható mezőivel. A teendő „Áthelyeztem / Lemondtam a FlightLoggerben” jelzéssel zárul (az áthelyezett igény ettől rögzített), vagy magától, ha a terv szerinti hely a FlightLogger-foglalásé (oda írták át, vagy a terv oda tért vissza; fél óra eltérés belefér), illetve ha a lemondott foglalás eltűnt. „Mégsem”: a foglalás marad, ahol a FlightLoggerben van. A visszahozott halasztott igény jelölés nélküli rendes tervezett tétel; a következő heti másolata a hét megnyitásakor kikerül, és ha csak az hozta oda a növendéket, a kijelöltek közül is. Ha a következő héten a másolatról már döntöttek vagy rögzítették, a halasztás sehol nem vonható vissza (H07), mert két hétre is bekerülne.

**Állapotok.** Tervezett (a motor szabadon tervezi), kézi döntés (a hely tisztaságáig áll), elfogadott (a terv egészének viszonyítási alapja a terv stabilitásához, semmit nem zár le), rögzített (a FlightLoggerben van; a helyét a motor nem mozdítja, csak a hét közbeni figyelés javasol). A FlightLogger-jelölés a tervezett tételek kiegészítője, nem állapot.

| Javaslat | Mikor | Mit tesz az oktató |
| --- | --- | --- |
| Áthelyezés kell | A foglalás helyén azóta új akadály van: az iskolai minimum alatti idő 0–2 napon belül, a gép, az oktató vagy a növendék foglalt, karbantartás, tiltott időszak, kirepülhető keret, vagy jóváhagyást igénylő figyelmeztetés. A legjobb tiszta hely, repülésnél előbb a repülhető idejűek. | Foglalási tervbe teszi, vagy „Marad így”. |
| Áthelyezés javasolt | Repülésnél a foglalás idejére bizonytalan vagy rossz idő várható, máshol repülhető, és az időjárási részpont a távolság szerinti megbízhatósággal legalább 0,3-del jobb. Jó helyen lévő foglalást nem mozdít. | Mint fent. |
| Kockázatos | Új akadály van, de a héten nincs tiszta hely. | Halasztás a foglalási tervbe, vagy „Marad így”. |
| Visszahozható | A halasztott igényt a motor a halasztás nélkül a következő 2 napban tiszta, repülésnél repülhető helyre tenné. Akit ez a tervben máshová tenne vagy kiszorítana, azt megnevezi; a döntés ugyanazzal a próbaszámolással születik, mint a plusz igénynél (KIT-08). | Foglalási tervbe teszi (rendes tervezett tétel lesz), vagy „Marad halasztva”. |
| Eltérés | Rögzített, de nincs a FlightLoggerben; halasztott, de még foglalt. | Újratervezés vagy megtartás; lemondás a FlightLoggerben. |
| Van még hely | A visszahozható halasztott igényeket visszahozottnak véve a következő 2 napban még befér plusz igény tiszta helyre (KIT-07). Egyetlen összefoglaló tétel, nem igényenkénti javaslat. | „Megnézem”: a „Van még hely?” ablak a 2 napra szűkítve; vagy „Most nem”, amely aznapra elhallgattatja. |

A javaslat legalább 2 óra múlva kezdődő helyre szól, és csak a még el nem kezdődött foglalást mozdítja. A javaslatok a mostani állapothoz képest önállóak; egy elfogadása után a többi újraszámolódik. A „marad így” a foglalás helyéhez kötődik: ha a foglalás mozdul, újra mérlegel; a javasolt (nem sürgős) áthelyezés elutasítása után egy új akadályról is szól. A FlightLogger-jelölt igényt a figyelés nem nézi külön: rendes tervezett tételként a motor tervezi. Az „Áthelyeztem” jelzése után a frissítésig az új hely le van zárva, a régi nem foglal.

**Mikor figyel.** A nyitott hét figyelése minden tervszámolás után fut. Az aktuális és a következő naptári hét közül a nem nyitottat a rendszer a háttérben, friss adattal is végigszámolja (a megnyitás után, majd óránként), így az indítópult akkor is szól, ha alapból a következő hét van nyitva (K19). A nyitott hét adata óránként a háttérben frissül, ha az oktató épp nem szerkeszt (indítópult vagy rögzítési lista, vagy az ablak a háttérben van), és az ablak előtérbe kerülésekor is.

## 10. Képernyők

Az alkalmazás kilenc képernyőből áll, ezek közül öt a heti tervezés lépéseit követi. A beállítások a csapat kérésére külön oldalon vannak.

| Képernyő | Mikor jelenik meg | Fő tartalom |
| --- | --- | --- |
| Első beállítás | Első indításkor | API-kulcs, szimulátorok, növendékek, limitek ajánlott alapértékekkel |
| Indítópult | Minden megnyitáskor | Adatok frissessége, listák változása, óraszám-bekérés, régen repült növendékek, újratervezés indítása |
| Beállítások | Bármikor | Súlyok, gépek, termek, növendékek, limitek, repülőtér, operációs idő, tiltott időszakok |
| Heti igények | Tervezés 2. lépése | Növendékek, feladatok, halasztott igények, időtartamok, elsőbbség, „Van még hely?” |
| Elméletek | Tervezés 3. lépése | Elméletek listája, fix vagy preferált időpont, terem, osztály |
| Dilemma-varázsló | Tervezés 5. lépése | Egyszerre egy dilemma, számláló, visszalépés, komment, foglalatlan igények |
| Tervezet-nézet | Tervezés 6. lépése | Idővonal, mozgatás, komment, figyelmeztetések sávja, „Van még hely?” |
| Rögzítési lista | Tervezés 8. lépése | Másolható mezők, tételenkénti állapot, eltérések, hét közbeni javaslatok, „van még hely” jelzés |
| Figyelmeztetések | Bármikor | Limitek, kettős foglalások, elavult adatok egy helyen |

**Javasolt alapértékek a Beállítások oldalra.** A 20 perc és a 2 óra a csapattól származik, a többi kiinduló javaslat.

| Beállítás | Alapérték | Hatókör |
| --- | --- | --- |
| Motorpróba és körüljárás | 20 perc | Gép vagy kategória |
| Preferált briefing | 30 perc | Növendék |
| Repülési idő | 60 perc | Növendék vagy feladat |
| Debriefing | 15 perc | Növendék vagy feladat |
| Minimális tartalék a gépben | 2 óra, negatív is lehet | Gép |
| Fordulóidő két repülés között | 15 perc | Gép |
| „Régen repült” küszöb | 14 nap | Növendék |
| Dilemma-küszöb | 10 súlyozott egység | Globális |
| Limit-közelítés jelzése | 80% | Szabályonként |
| Feladatválasztás módja | Automatikus | Globális, foglalásonként felülírható |
| Foglalási prioritás | 3 (1–5-ös skálán, 5 a legfontosabb) | Növendék |
| Igény elsőbbsége | 1 (1–5-ös skálán, 1 a legfontosabb) | Globális, igényenként felülírható |
| Plusz igény elsőbbsége | 3 | Globális |
| Rossz idő küszöbe | Iskolai repülési minimum | Globális |
| Minimális osztályrészvétel | 90% | Globális |

## 11. Nyitott kérdések

A 11.1 rész kérdései eldőltek, a K02-t a 2026. november 10-i felderítés zárta le. A többire a javasolt alapfeltevéssel is el lehet indulni, és a teszt közben lehet pontosítani.

### 11.1 Fejlesztés előtt eldöntendő

| # | Kérdés | Miért számít | Javasolt alapfeltevés | Állapot |
| --- | --- | --- | --- | --- |
| K01 | Aktív-e az iskolánál a FlightLogger API modul, és kaphat-e a tesztelő oktató saját kulcsot? | Enélkül nincs adatforrás. | Igen, a tesztelő oktató saját kulcsot kaphat. | Eldöntve |
| K02 | Az oktatói kulccsal látható-e minden gép, más oktatók foglalása és a növendékek összes foglalása? | Ha nem, rejtett ütközések keletkeznek. | Igen. A 2026. november 10-i élő próba igazolta: minden gép és minden oktató foglalása látszik, a növendékeké is. | Eldöntve |
| K03 | Melyik kézikönyv melyik fejezete tartalmazza az oktatói és a növendéki limiteket? | A limitek számai innen jönnek. | Az oktató kézzel adja meg a beállításokban. | Eldöntve |
| K04 | Alkalmazza-e az iskola az ORO.FTL számait az oktatókra, vagy saját értékei vannak? | Ez dönti el a mintaértékek használatát. | Irreleváns, az oktató kézzel adja meg az értékeket. | Eldöntve |
| K05 | Aktív-e a FlightLogger limit-modulja, és ha igen, melyik számítás az irányadó? | Két eltérő szám zavart okoz. | Nem aktív, a tervező számítása az irányadó. | Eldöntve |
| K06 | Jóváhagyja-e az iskola a növendékadatok helyi tárolását? | Adatvédelmi feltétel. | Igen, csak azonosító és preferencia, titkosított lemezen. | Eldöntve |
| K07 | Kereskedelmi használatnak minősül-e az Open-Meteo ebben a rendszerben? | Csomagot és költséget határoz meg. | Nem, az ingyenes szintet használjuk. | Eldöntve |
| K08 | Engedi-e a FlightLogger a kettős foglalást, és milyen beállítással? | A standby megoldás ezen múlik. | Igen, gond nélkül engedi. | Eldöntve |

### 11.2 Fogalmak pontosítása

| # | Kérdés | Miért számít | Javasolt alapfeltevés | Állapot |
| --- | --- | --- | --- | --- |
| K09 | A „mennyi óra maradt” a következő karbantartásig kirepülhető időt jelenti? Melyik időalapon? | A tartalékszámítás alapja. | Igen, a maintenance crew reggeli dokumentuma adja meg, a foglalások repülési idejével számolva. | Eldöntve |
| K10 | A „preferált briefing time” időtartam vagy napszak? | Másképp kell tárolni és számolni. | Időtartam, percben. | Eldöntve |
| K11 | A „preferált időbeli sorrend” a napon belüli repülési sorrend, vagy a foglalási prioritás? | Más feltételt jelent. | Napon belüli sorrend, a foglalási prioritás külön beállítás (NOV-12). | Eldöntve |
| K12 | Mennyi tartalék maradjon a gépben, és mire kell? | Kizáró feltétel küszöbe. | 2 óra, gépenként állítható, negatív is lehet. Célja, hogy egy közben érkező foglalás miatt ne kelljen lemondani. | Eldöntve |
| K13 | Mi számít rossz időnek az elméletnél és a szimulátornál? | A rossz időre illesztés alapja. | Globálisan beállítható küszöb. Rossz idő az az óra is, amelyben a szóba jövő növendékek limitjei alapján senki sem repülhet. | Eldöntve |
| K14 | Mekkora a „rég repült” küszöb, és programonként eltér-e? | Figyelmeztetés és súly alapja. | 14 nap, növendékenként állítható. | Eldöntve |
| K15 | A növendéki időjárási limit kizáró vagy preferencia? | Kizár vagy csak pontoz. | Preferencia: pontoz, de nem zár ki. | Eldöntve |
| K16 | A „feladatok maximális limitje” napi feladatszámot jelent? | A limit-szabály típusát adja. | Igen, napi feladatszám. | Eldöntve |
| K17 | A „2 ütköző” az oktató, a növendék és a gép kettős foglalására is vonatkozik? | A kettős foglalás szabálya. | Mindháromra, csak dilemmaként. | Eldöntve |

### 11.3 Tervezési szabályok

| # | Kérdés | Miért számít | Javasolt alapfeltevés | Állapot |
| --- | --- | --- | --- | --- |
| K18 | Hány repülés és szimulátor kell növendékenként hetente, és ki adja meg? | Ebből lesznek az igények. | Nincs rögzített darabszám, a heti igények alapján tervezünk. | Eldöntve |
| K19 | Melyik napon és mennyi időre előre készül a terv? | Az előrejelzés megbízhatósága miatt. | Szombat vagy vasárnap körül az egész hétre, hét közben ugyanezekkel az elvekkel módosítható. | Eldöntve |
| K20 | Hány növendéke van egy oktatónak, és hány foglalás készül hetente? | A motor méretezése, a dilemmák száma. | Nagyjából 10–15 növendék és heti 20 foglalás. | Eldöntve |
| K21 | Az elméleteket ugyanaz az oktató tartja, aki repül? | Kinek az idejét kell nézni. | Igen, egy oktató repülhet is és elméletet is tarthat. | Eldöntve |
| K22 | Mi történik, ha egy osztály néhány tagja nem ér rá? Mi az elfogadható részvétel? | Osztályfoglalás szabálya. | 90% részvétel elfogadható, alatta figyelmeztetés dilemmaként. | Eldöntve |
| K23 | Szóló repülésnél foglalja-e az oktató idejét a felügyelet? | Oktatói kapacitás. | Igen, a szóló repülés foglalja az oktató idejét. | Eldöntve |
| K24 | Kell-e többnövendékes foglalás, vizsga és progress check a tesztben? | Hatókör. | Nem, ezek kézzel maradnak. | Eldöntve |
| K25 | Kötelező-e a feladatok programbeli sorrendje? | Feladatválasztás. | Nem, a programbeli sorrend nem kötelező. | Eldöntve |
| K26 | Honnan jön a feladat tervezett hossza? | Az időtartam alapja. | Az igény felvételénél adható meg a briefing, a repülés és a debriefing ideje, előtöltve a program feladatadataiból, különben helyi alapértékből. | Eldöntve |
| K27 | Csak a bázis időjárása számít, vagy az útvonal és a cél is? | Navigációs feladatoknál eltér. | Helyi feladatnál csak a bázisé. Útvonalas feladatnál (SZB-19) az érintett repülőtereké is, az érkezés idejében; a repülőterek közötti útvonal időjárását nem nézi. (2026-11-12: módosítva, korábban csak a bázis.) | Eldöntve |
| K28 | Kellenek-e éjszakai és IFR feladatok? | Más időjárási szabályok. | Igen, kellenek. IFR és VFR között nincs különbség, legfeljebb az oktató növeli a növendék limitjeit az adott fázisban. | Eldöntve |
| K29 | Mi a repülőtér nyitvatartása és az oktató munkaideje? | Ebből lesznek a jelölt helyek. | Helyi beállítás, naponkénti operációs idővel. | Eldöntve |

### 11.4 Működés

| # | Kérdés | Miért számít | Javasolt alapfeltevés | Állapot |
| --- | --- | --- | --- | --- |
| K30 | Több oktató használja egyszerre? Hogyan előzzük meg, hogy ugyanazt tervezzék? | A helyi tervezetek nem látják egymást. | Nem, az alkalmazás egy oktatóra készül. | Eldöntve |
| K31 | Milyen számítógépeken kell futnia? | Telepítés és titoktárolás módja. | macOS és Windows. | Eldöntve |
| K32 | Mit tegyen a rendszer, ha napokig nem nyitják meg? | Elavult adat és óraszám. | Teljes frissítés, a hiányzó adatok bekérése. | Eldöntve |
| K33 | Kell-e, hogy az iskola lássa a limit-túllépések indoklását? | Felelősség és átláthatóság. | Nem, elég a jóváhagyás. | Eldöntve |
| K34 | Látja-e a növendék a foglalás kommentjét a FlightLoggerben? | A standby jelzés ezen múlik. | Igen, látja. | Eldöntve |
| K35 | Kire vonatkozhat a tiltott időszak, ismétlődhet-e, és tiltsa-e a kézi mozgatást is? | A „semmiképp” hatókörét adja. | Az oktató személyes beállítása, a saját ráérését tükrözi. Eseti vagy ismétlődő lehet. A motor soha nem használja, kézi mozgatásnál figyelmeztet. | Eldöntve |
| K36 | Honnan tudja a rendszer a következő feladatot, ha a programszerkezet nem érhető el az API-ból? | Az automatikus feladatválasztás (SZB-02, 7.5) ezen múlik. | Előbb az iskolától kérünk jogosultságot a programokhoz. Addig az oktató választja a feladatot a növendék eddigi feladatai alapján. | Nyitott |
| K37 | Miért nem ad az API 2026. április 1. előtti repülést, és honnan jön az oktató korábbi és más munkahelyen repült ideje? | A 28 napos, éves és 12 hónapos limitek (LIM-01) előzménye ezen múlik. Iskolai kulccsal a myFlightLogger nem kérdezhető. | Az első beállításkor az oktató kézi kezdőértéket ad meg limitenként, a saját logbookja alapján. | Nyitott |

## 12. A brainstorming folytatása

A legjobb következő ötletek a napi áttekintésre és a bizonytalan időjárás kezelésére irányulnak. A térkép saját becslés, a csapat tapasztalata felülírhatja.

&#91;embedded content: új ötletek érték és ráfordítás szerint · becslés, a csapat módosíthatja\]

| Ötlet | Mit ad |
| --- | --- |
| Reggeli áttekintés | Megnyitáskor a mai nap, a friss időjárás és a terv eltérései egy nézetben. |
| B terv | A standby elmélet (SZB-15) kiterjesztése szimulátorra, előre megjelölt alternatívával. |
| Beállításjavaslat | Ha az oktató rendszeresen ugyanúgy felülír, a rendszer új súlyt vagy preferenciát javasol. |
| METAR/TAF a mai napra | Tényadat a modell mellé. Az adott nap hét közbeni átszervezésekor nagyobb súlya van, mint a modellből származó időjárásnak (SZB-17). Új külső forrást jelent, ezért a 3. fejezet elvei alapján kell dönteni róla. |

## 13. Fázisok, tesztelés és kockázatok

A munka öt fázisra bomlik. A rövid felderítés a legnagyobb bizonytalanságokat zárja le, mielőtt bármi elkészülne.

&#91;embedded content: fázisok és kapuk · nem időarányos\]

### 13.1 A felderítés teendői

- [x] Élő lekérdezés oktatói kulccsal: gépek, más oktatók foglalásai, növendékek foglalásai.
- [x] A `worstMaintenanceWarning.timeLeft` és a `nextService` jelentésének élő ellenőrzése.
- [ ] Annak ellenőrzése, hogy a nem publikált foglalások megjelennek-e az API-ban.
- [ ] A limitek kigyűjtése a kézikönyvekből, a hatályos EASA-szöveg ellenőrzésével.
- [x] Open-Meteo: modellválasztás a repülőtérre, látástávolság forrása november 30. után.
- [ ] Alapmérés: mennyi idő ma egy heti terv elkészítése.

**Eredmény (2026. november 10.).** A kulcs minden gépet és minden oktató foglalását látja (K02). Óraalapú karbantartás nincs a FlightLoggerben, ezért a kirepülhető idő kézi megadás marad. Az ICON-D2 nem fedi le az LHNY-t, a látástávolságot a best\_match adja kb. 146 óráig. A nem publikált foglalások ellenőrzéséhez még egy teszt-foglalás kell. Új nyitott kérdések: K36, K37.

### 13.2 Tesztelés

1. **Múltbeli hetek visszajátszása.** A motor valódi múltbeli adatokra tervez, a tervet az akkor ténylegesen készült beosztással vetjük össze.
2. **Párhuzamos futtatás.** Az oktató továbbra is kézzel tervez, és összeveti a rendszer tervezetével.
3. **Éles használat.** Az oktató a rendszerrel tervez, és kézzel rögzít. A folytatásról a 2. fejezet mérőszámai alapján döntünk.

### 13.3 Kockázatok

| Kockázat | Hatás | Csökkentés |
| --- | --- | --- |
| Az oktatói kulcs nem lát mindent | Rejtett ütközések | Lezárva: a felderítés szerint a kulcs minden gépet és foglalást lát (K02) |
| A ráérések nincsenek kitöltve | Rossz időpontok | A hiányzó ráérés külön jelzése, kézi kiegészítés |
| Elavult kézi óraszám | Téves géptartalék | Bekérés megnyitáskor, előtöltés, látható adatkor |
| Pontatlan előrejelzés | Felesleges átfoglalások | Távolság szerinti kezelés, minimális újratervezés |
| Túl sok dilemma | Az oktató felhagy a használattal | Küszöb hangolása, ajánlások egy kattintásos elfogadása |
| Túlzott bizalom a rendszerben | Elmarad az oktatói ellenőrzés | Látható indoklás, a végső döntés az oktatóé |
| Más oktató közben foglal a FlightLoggerben | Elveszett helyek | Újraellenőrzés rögzítés előtt |
| Az API vagy az időjárási modell változik | Hibás vagy hiányzó adat | Adathiány kezelése, opcionális változók, jelzés a felületen |
| Véletlen írás a FlightLoggerbe | Sérülő foglalások | Minden `mutation` tiltása a kliensben, ennek tesztelése |

## 14. Melléklet: az eredeti lista megfeleltetése

Mind a 29 eredeti pont bekerült a követelmények közé. A bevezető feltételei az ALP-01, ALP-03, ALP-04 és ADT-07 pontokban szerepelnek.

| # | Eredeti pont röviden | Követelmény |
| --- | --- | --- |
| 1 | Lokális futás, adat nem jut harmadik félhez | ALP-01, ALP-02 |
| 2 | Tartós adatok konfigurációs fájlban | ALP-05, NOV-02 |
| 3 | Növendékek kiválasztása | NOV-01 |
| 4 | Időjárás figyelembevétele | SZB-01, ADT-07 |
| 5 | Automatikus feladatválasztás, felülírás | SZB-02, ADT-04 |
| 6 | Napi gépóra megadása és bekérése | ERF-04, ERF-05 |
| 7 | Engedélyezett és preferált gépek | NOV-03, NOV-04 |
| 8 | Gépkategóriák | ERF-01 |
| 9 | Preferált időbeli sorrend | NOV-05 |
| 10 | Időjárási preferenciák és limitek | NOV-06 |
| 11 | Gépek és foglalásaik az API-ból | ADT-01 |
| 12 | Preferált briefing time | NOV-07 |
| 13 | Motorpróba és körüljárás az első repülésnél | SZB-05, ERF-08 |
| 14 | Figyelmeztetés, ha rég repült | NOV-08 |
| 15 | Maradjon idő a gépben | SZB-06 |
| 16 | Százalékos prioritások | SZB-10 |
| 17 | Beállítások külön oldalon | SZB-11 |
| 18 | Elméleti foglalás teremben, rossz időre | SZB-08, ADT-03 |
| 19 | Szimulátor foglalása | SZB-07 |
| 20 | Gép- és teremlista változása | ADT-06 |
| 21 | Preferált termek, férőhely, egész osztály | ERF-07, SZB-09 |
| 22 | Szimulátornál a rossz idő előny | SZB-07 |
| 23 | Oktatói repült idő limitek a logbookból | LIM-01, LIM-02, ADT-05 |
| 24 | Növendéki limitek, pihenőidő | LIM-03, LIM-04 |
| 25 | Szimulátorok kezdeti besorolása | ERF-02 |
| 26 | Ráérés, foglalások, kettős foglalás | SZB-03, SZB-04, ADT-02 |
| 27 | Heti tervezés elméletekkel | TRV-01, TRV-02, TRV-03 |
| 28 | Dilemmák, ajánlások, standby, élő frissítés | TRV-04–TRV-08 |
| 29 | Komment és mozgatás a tervezeten | TRV-09, TRV-10 |

## 15. Források

**FlightLogger**

- [Súgóközpont](https://help.flightlogger.net/knowledge), [API-referencia](https://api.flightlogger.net/), [Az API-ról](https://help.flightlogger.net/knowledge/about-flightloggers-api), [API első lépések](https://help.flightlogger.net/knowledge/getting-started-with-the-graphql-api), [API korlátok](https://help.flightlogger.net/knowledge/api-limitations), [Lapozás](https://help.flightlogger.net/knowledge/pagination-of-api-results)
- [Foglalási rendszer](https://help.flightlogger.net/knowledge/getting-started-with-the-integrated-booking-system), [Nem publikált foglalások](https://help.flightlogger.net/knowledge/getting-started-with-unpublished-bookings), [Foglalás tiltása figyelmeztetéskor](https://help.flightlogger.net/knowledge/blocking-of-booking-creation-in-case-of-warnings), [Foglalási beállítások](https://help.flightlogger.net/knowledge/account-settings-booking), [Foglalási színek](https://help.flightlogger.net/knowledge/understanding-the-booking-page-colors)
- [Ráérések, oktatók](https://help.flightlogger.net/knowledge/getting-started-with-availabilities), [Ráérések, elméleti oktatók](https://help.flightlogger.net/knowledge/getting-started-with-availabilities-0), [Termek](https://help.flightlogger.net/knowledge/getting-started-with-classrooms), [Elméleti képzés](https://help.flightlogger.net/knowledge/getting-started-with-theory-courses-and-ground-school-warnings)
- [Gépek kezelése](https://help.flightlogger.net/knowledge/aircraft-administration), [Gépek aktuális állapota](https://help.flightlogger.net/knowledge/aircraft-administration-0), [Gépidő követése](https://help.flightlogger.net/knowledge/aircraft-time-tracking-in-flightlogger)
- [Szolgálati idő](https://help.flightlogger.net/knowledge/getting-started-with-duty-time), [Limit-követelmények](https://help.flightlogger.net/knowledge/setting-up-and-assigning-flight-time-and-duty-time-limitation-requirements), [Limit-figyelmeztetések](https://help.flightlogger.net/knowledge/getting-an-overview-of-flight-and-duty-time-warnings)

**Open-Meteo**

- [Forecast API](https://open-meteo.com/en/docs), [DWD ICON API](https://open-meteo.com/en/docs/dwd-api), [Ensemble API](https://open-meteo.com/en/docs/ensemble-api), [Feltételek](https://open-meteo.com/en/terms), [Csomagok](https://open-meteo.com/en/pricing)

**EASA**

- [83/2014/EU rendelet, Subpart FTL](https://legislation.gov.uk/eur/2014/83/annexes/adopted), az eredeti elfogadott szöveg
- [AMC1 ORA.ATO.230(b)](https://www.aerocomsystem.com/e-system/amcgmText/list.html?show_code=ORA.ATO.230&part_code=ORA&limit_date=2017/02/26&amcgm_id=1657), az EASA-szöveg harmadik fél általi közlése
- [Easy Access Rules for Aircrew](https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-aircrew-regulation-eu-no-11782011), csak a nyitóoldal volt olvasható
- [EASA közösségi fórum](https://www.easa.europa.eu/community/topics/flight-instructors-fatigue-reports), nem hivatalos álláspont
