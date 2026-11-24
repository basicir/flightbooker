# Plusz igények és igény-elsőbbség – megvalósítási terv

Állapot (2026-11-17): a terv **jóváhagyva** (súly helyett szabállyal). **A P1–P6 elkészült**,
a P6 ellenőrzésre vár; az eltérések a „Megvalósítás a P1-ben … P6-ban” részekben. A követelmények (ELS, KIT) a
koncepciódokumentum 5.9 részében vannak (Claude Docs és `docs/koncepcio.md`).

## Cél

Az oktató a heti idő kihasználtságát akarja növelni. A kész terv mellett (akár rögzített
foglalásokkal is) a rendszer megmondja, melyik növendék melyik feladata fér még be a héten, és az
oktató ebből plusz igényeket vehet fel. A plusz igény rendes igény: időpont nélkül kerül be,
a motor helyezi el, és az adatok változásával ugyanúgy mozoghat, mint bármelyik másik. A plusz
igény nem szoríthatja ki azt az igényt, amelyet az oktató előre, kézzel vett fel.

## Eldöntött kérdések (2026-11-17)

| Kérdés | Döntés |
|---|---|
| Megközelítés | Nem térkép és kattintás, hanem lista: növendék, azon belül feladat legördülővel |
| A létrejövő igény | Rendes igény, időpont nélkül, ugyanazzal a függvénnyel, mint a kézi felvétel; a motor helyezi el |
| Belépési pontok | „A” összeállítás: a hét közbeni figyelés magától, a következő 2 napra, és a „Van még hely?” gomb kérésre, az egész hétre |
| Ellenőrzés | Gyors lista a mostani tervhez képest, a kiválasztottra teljes próbaszámolás (korábbi „1. javaslat”) |
| Oktatói limitek | A szokásos módon érvényesek (a kikapcsolásukra vonatkozó korábbi kérés visszavonva) |
| Igény-elsőbbség | Igényenként 1–5, az 1 a legfontosabb. Alapból 1, a plusz (kitöltő) igényé 3 |
| Az elsőbbség célja | A kitöltő igény ne szoríthassa ki a kézzel előre felvett igényt |

## Követelmények (javasolt azonosítók)

| ID | Követelmény |
|---|---|
| ELS-01 | Igényenként 1–5 elsőbbség adható, az 1 a legfontosabb. Alapból 1, a plusz igényé 3; mindkét alapérték a beállításokban állítható. |
| ELS-02 | A motor elsőbbségi sorrendben helyez el. Alacsonyabb elsőbbségű igény nem veheti el egy magasabb elsőbbségű helyét, és nem változtat a helyén. Kivétel: az oktató döntése, a fix időpont és a FlightLoggerben lévő foglalás. |
| ELS-03 | Verseny-dilemma csak azonos elsőbbségű igények között keletkezik. Cserét a „nincs hely” dilemma csak azonos vagy alacsonyabb elsőbbségű igény helyére ajánl. |
| ELS-04 | A közös briefing csapat elsőbbsége a legfontosabb tagjáé. |
| ELS-05 | Az automatikus feladatkiosztás a növendék igényeinek elsőbbsége, azon belül a lista sorrendje szerint ad egymást követő feladatokat, és a motor időben is ebben a sorrendben helyezi el őket. |
| KIT-01 | „Van még hely?” gomb: a motor a mostani terv mellett megkeresi, melyik növendék melyik feladata fér még be a héten tiszta, repülésnél repülhető idejű, legalább 2 óra múlva kezdődő helyre. |
| KIT-02 | A lista növendék, azon belül feladat szerint választható. Alapból az automatikus következő feladat; a növendék más igénye által tartott, a FlightLoggerben lefoglalt és a halasztott feladat nem választható. |
| KIT-03 | Akinek halasztott igénye van, annál új igény helyett a halasztott visszahozása szerepel. |
| KIT-04 | Kiválasztáskor próbaszámolás mutatja, hová kerülne az igény, és ki mozdulna vagy szorulna ki. Amit csak dilemmával vagy kiszorítással lehetne felvenni, azt a rendszer nem ajánlja. |
| KIT-05 | A felvett igény rendes igény időpont nélkül, a kitöltő elsőbbséggel. A felvétel visszavonható. |
| KIT-06 | Nyitott dilemmák mellett a keresés előbb a dilemmákhoz küld, mert a szabad hely a döntéseken múlik. |
| KIT-07 | A hét közbeni figyelés a visszahozható halasztott igények után, azokat visszahozottnak véve, a következő 2 napra is keres, és egyetlen összefoglaló tétellel jelez. A jelzés napra szólóan elutasítható. |
| KIT-08 | A halasztott igény visszahozása és a plusz igény ugyanazzal a próbaszámolással dönt. |

## Igény-elsőbbség

### Miért szabály, és miért nem súly

A kérés az volt, hogy az elsőbbség a többi feltételhez hasonlóan súlyt kapjon. Ezt megvizsgáltam,
és súllyal a cél nem érhető el:

- **Az elsőbbség nem dönti el, hová kerül egy igény.** Igényenként állandó: az igény minden
  jelölt helyén ugyanannyi, ezért csak két igény összevetésében számít.
- **A kiszorítás nem pont szerint történik.** A mohó elhelyezés a legkevesebb helyű igénnyel
  kezd (`plan.ts`, „A legnehezebben elhelyezhető igény”). Egy kevés helyű kitöltő igény ezért
  előbb kerül sorra, és elviheti egy kézi igény legjobb helyét. Ha a kézi igénynek máshol is van
  helye, dilemma sem lesz: egyszerűen rosszabb helyre kerül. Ebbe a súly nem szól bele.
- **Versenyben is gyenge.** A részpont 1-es és 3-as elsőbbség között 0,5. Még 100%-os súllyal
  is csak 50 egység előny, a repülés többi feltétele együtt viszont 520 súlyegységet ad, és
  például 0,6-nyi időjárási különbség (90%-os súly) már 54 egység.

Ezért az elsőbbség **szabály**: a motor rétegenként helyez el. Mellette a súly hatástalan
lenne, mert azonos elsőbbségű igények között a részpont is azonos. **Súly nem kerül a
beállításokba**, helyette a két alapérték (normál igény: 1, plusz igény: 3).

### A motor rétegei (`src/core/engine/plan.ts`)

1. FlightLoggerben lévő igények, oktatói döntések, fix időpontok – változatlanul, elsőbbségtől
   függetlenül. Ezek az oktató kifejezett döntései vagy a valóság.
2. Elsőbbségenként 1-től 5-ig, rétegenként:
   - a réteg közös briefing csapatai (a csapat rétege a legfontosabb tagjáé, ELS-04);
   - a réteg mohó elhelyezése a mostani szabályokkal (szűkösség, pont), verseny-dilemmával
     csak a rétegen belül;
   - a réteg helyi javítása és ismétlő köre.
3. Vállalt figyelmeztetéses döntések, standby elméletek, javaslatok – a mostani sorrendben.

A helyi javítás rétegenként fut, különben egy későbbi réteg elvenné a korábbi javítási
lehetőségét, és a garancia sérülne. Így **egy alacsonyabb elsőbbségű igény felvétele a
magasabbak helyét nem változtatja meg**. Ezt tulajdonságteszt ellenőrzi. Figyelmeztetésük
(például limit-közelítés) változhat, mert a plusz repülés is beleszámít az oktató napi idejébe.
Limitet túllépni viszont nem tud, mert az ilyen hely a plusz igénynek nem tiszta.

Visszafelé kompatibilis: mezőhiány esetén az elsőbbség 1, tehát ma minden igény egy rétegben van,
és a terv ugyanaz marad.

### Adatmodell és felület

- `BookingRequest.priority?: 1 | 2 | 3 | 4 | 5` (hiányában 1), a tervezet sémájában is.
- `settings.defaults.requestPriority` (1) és `settings.defaults.fillRequestPriority` (3).
- Heti igények és Elméletek: az igénysorban kis választó, „Elsőbbség: 1 (legfontosabb) … 5”.
  A tervezeten és a rögzítési listán csak az 1-estől eltérő elsőbbség látszik, jelvényként.
- **Elnevezés:** a növendék meglévő foglalási prioritásánál (NOV-12) az 5 a legfontosabb, az
  újnál az 1. A keveredés elkerülésére az új mező neve a felületen „Elsőbbség (1 = először)”, a
  régié „Foglalási prioritás (5 = legfontosabb)”. A növendéki prioritás marad súly (65%), és
  azonos elsőbbségű igények között hat.

### Megvalósítás a P1-ben (2026-11-17)

- **Modell és beállítás.** `BookingRequest.priority` (1–5, hiányában a
  `defaults.requestPriority`). A beállítási fájl 8-as formátumú; a 7 → 8 migráció a két új
  alapértéket (1 és 3) teszi bele, a többi érték marad. A közös feloldás:
  `requestPriorityOf` (`src/core/config/operations.ts`).
- **Motor** (`src/core/engine/plan.ts`). Rétegenként: a réteg csapatai, mohó elhelyezése, helyi
  javítása és ismétlő köre. Az első réteg a fix időpontú igényeket is elhelyezi, elsőbbségtől
  függetlenül, és a csapatok elhelyezése alatt az idejüket lefoglalja (ahogy eddig). Csere
  fontosabb igény helyére nem ajánlott. Ha minden igény azonos elsőbbségű, egy réteg van, és a terv
  a korábbival azonos (a meglévő arany- és tulajdonságtesztek változatlanul zöldek).
- **Eltérés a tervtől: a rossz idő megítélése.** Az elmélet és a szimulátor „rossz idő”
  részpontja (SZB-16) eddig a hét összes repülési igényének növendékeit nézte. Így egy új
  növendék plusz igénye elmozdíthatta volna a kézi elméletet. Most egy igény csak a legalább
  ilyen fontos repülési igények növendékeit nézi (`context.ts`, `flyabilityRaw`).
- **A garancia pontosítása.** A fontosabb igény repülése (gépideje) és gépe nem változik. A
  foglalás kezdete annyiban mozdulhat, hogy ha a plusz igény ugyanazon a gépen aznap korábban
  repül, a motorpróba (SZB-05) átkerül rá. A fontosabb igény figyelmeztetése (például
  limit-közelítés) a plusz repülés miatt megjelenhet.
- **Felület.** Elsőbbség-választó a Heti igények igénysorában és az Elméleteknél (az alapértékkel
  egyező választás az alapértékre állít vissza); jelvény a tervezet „Miért ide?” paneljén és a
  foglalásblokkok buborékában, ha az elsőbbség eltér az alapértéktől; a Beállítások → Tervezés
  fülön a két alapérték, a növendéki prioritás felirata „5 = legfontosabb”; súgó: új „Elsőbbség”
  rész, a Heti igények, a Tervezés és a Súlyok leírása.
- **Tesztek** (`tests/core/engine/priority.test.ts`, 40 eset): visszafelé kompatibilitás,
  kiszorítás azonos és eltérő elsőbbséggel, fix időpont, csere, csapat elsőbbsége, a rossz idő
  megítélése, és 30 magos tulajdonságteszt (a plusz igények felvétele a fontosabb igények helyét,
  kimaradását és dilemmáit nem változtatja). A csere- és a rossz idő tesztjéről ellenőriztem, hogy
  a javítás nélkül elbuknak. Összesen 712 teszt zöld.

### A kiszorított plusz igény

Ha később egy fontosabb igény (vagy adatváltozás) elveszi a plusz igény helyét, és nincs más
helye, rendes „nincs hely” dilemma keletkezik, ajánlásként halasztással. Csendes törlés nincs.
A FlightLoggerbe már rögzített plusz foglalás a valóság: az elsőbbség onnan már nem mozdítja.

### Feladatkiosztás elsőbbség szerint (ELS-05)

Az automatikus kiosztás ma a lista sorrendjében ad egymást követő feladatokat
(`src/core/progress/autoAssign.ts`). Az új sorrend: elsőbbség, azon belül a lista. Így a plusz
igény mindig a kézi igények feladatai utáni feladatot kapja, akkor is, ha a kézi igényt később
vették fel.

Új motorszabály: ugyanannak a növendéknek két automatikus igénye közül a sorrendben későbbi
nem kezdődhet a korábbi vége előtt. Különben a növendék előbb repülné a későbbi feladatot, holott
az automatikus mód éppen azt feltételezi, hogy a korábbi sikerült. A kézzel választott
feladatú igényre a szabály nem vonatkozik.

### Megvalósítás a P2-ben (2026-11-17)

- **Feladatkiosztás** (`src/core/progress/autoAssign.ts`): a növendék automatikus igényei
  elsőbbség, azon belül a lista sorrendjében kapják az egymást követő feladatokat.
- **Eltérés a tervtől: a sor a haladásból jön, nem a listából.** A „következő feladat” a
  legutóbb repült feladattól halad előre, a program végén elölről kezdi, sikertelen feladatnál
  ismétel (`nextLecture`). A FlightLoggerben már lefoglalt igény a foglalása feladatát tartja, így
  a lista és a feladatsorrend eltérhet. A sort ezért a `lectureSequences` a haladás szerint
  állítja össze, ugyanazzal a logikával, mint a kiosztás. Ismeretlen haladásnál, vagy ha egy
  feladat nincs a programban, az elsőbbség, azon belül a lista dönt. A kézzel választott
  feladatú igény nem része a sornak, az egytagú sor kimarad.
- **Motor** (`context.ts`): új kizáró feltétel, `order` („megbontaná a növendék feladatainak
  sorrendjét”). A sorban későbbi igény nem kezdődhet a korábbi vége előtt, és fordítva. A
  társ ideje a terv elhelyezése, egy vállalt figyelmeztetéses döntés lefoglalt ideje, vagy a
  FlightLogger-foglalása. Felülbírálás súlya 15 (a munkaidőn kívüli kezdésnél súlyosabb, az
  ütközésnél enyhébb). A „nincs hely” dilemma akadályai között megjelenik, javítási tippel.
- **Bekötés.** A sor a terv bemenetébe kerül (`PlanInput.sequences`, a felület
  `buildPlanInput`-ja számolja). Ugyanezt használja a motor, a hét közbeni figyelés (az
  áthelyezési javaslat sem bonthatja meg) és a dilemma-térkép. A térkép eddig a nyers
  igénylistával számolt; most a terv bemenetével (a feladatkiosztás utáni igényekkel), így
  ugyanazt látja, mint a motor.
- **A hét közbeni figyelés** a FlightLoggerben lévő, egymáshoz képest rossz sorrendű
  foglalásokat nem jelzi új akadályként: azt az oktató tudatosan rögzítette.
- **Tesztek:** a kiosztás és a sor (`tests/core/progress/autoAssign.test.ts`, 6 új eset: elsőbbség,
  visszafordulás a program végén, FlightLoggerben lévő feladat, ismétlés, kézi feladat, ismeretlen
  haladás) és a motor (`tests/core/engine/sequence.test.ts`, 5 eset: fix időpont, „nincs hely” a
  sorrend miatt, kézi feladat, FlightLogger-foglalás és térkép, elsőbbségi rétegek). Összesen 723
  teszt zöld. Bemutató módban: egy növendék két automatikus igényénél a 3-as elsőbbségű a
  későbbi feladatot kapja, és időben a másik után kerül.

## Közös motorfüggvények (`src/core/engine/openings.ts`, új)

### Helykeresés: `findOpenings`

- **Bemenet:** a kiszámolt terv, a pillanatkép, a beállítások, az igények, az időtáv (egész hét
  vagy a következő 2 nap) és a kizárt növendékek.
- **Jelöltek:** a hozzárendelt növendékek közül (a hétre nem kijelöltek is):
  - kimarad, akinek nincs engedélyezett aktív gépe;
  - hátra kerül és megjelölve, akinek nincs megadott ráérése, mert a motor szabadnak veszi;
  - halasztott igényű növendéknél csak a visszahozás jelölt (KIT-03); ha a visszahozást az
    oktató elutasította, a növendék kimarad.
- **Feladatok növendékenként:** először az automatikus (azzal a feladattal és hosszal, amelyet
  az új igény az ELS-05 szerint ténylegesen kapna), aztán a következő legfeljebb 5 feladat, amely
  nem teljesített, nem lefoglalt, és amelyet nem tart más igénye, végül a „feladat nélkül”. A
  szimulátoros feladat szimulátorra kerül, elmélet nincs a listán.
- **Feltétel:** van-e tiszta hely (kizáró sértés és jóváhagyást kérő figyelmeztetés nélkül),
  repülésnél repülhető idővel, legalább 2 óra múlva (a figyelés `WATCH_NOTICE_MINUTES` értéke).
  A növendéki és oktatói limitek a szokásos módon számítanak.
- **Gyorsítás:** egyetlen tervezési kontextus a terv helyeivel (mint a dilemma-térképnél), a
  feladatok alak szerint összevonva (fajta, időtartam, nappali vagy éjszakai, útvonal), és az
  első tiszta helynél kilép.
- **Kimenet:** növendékenként a beférő feladatok és tájékoztatásul a legjobb hely.
- Az elsőbbségi rétegek miatt a plusz igény csak a 3-as és alacsonyabb rétegekkel versenyez,
  ezért a gyors lista a kézi igényekhez képest pontos.

### Próbaszámolás: `trialPlan`

A teljes tervezés a módosított bemenettel (új igény, vagy halasztás nélkül), összevetve a
mostanival. Megadja, hová kerül az igény, tiszta-e, ki mozdul, ki szorul ki, és milyen új
dilemma keletkezik. A hét közbeni figyelés visszahozása ma saját próbát futtat
(`weekWatch.ts`). Ez erre a közös függvényre áll át, így a visszahozásnál is látszik, ki kerül
át, nemcsak az, hogy ki esik ki.

### Megvalósítás a P3-ban (2026-11-17)

- **Próbaszámolás** (`src/core/engine/trial.ts`). A `trialPlan(alap, új bemenet, igény)`
  megmondja:
  - hová kerül az igény, és tisztán-e (dilemma és jóváhagyást kérő figyelmeztetés nélkül);
  - ki kerül máshová (`moved`), és ki szorul ki (`displaced`);
  - milyen új dilemma keletkezik (a standby-ajánlás nem számít, az elhagyható);
  - `ok`: mellékhatás nélkül felvehető.

  Két segédfüggvény tartozik hozzá: `withRequests` (új igénylista és feladatsorrend) és
  `withoutDeferral` (a halasztás visszavonása).
- **Helykeresés** (`src/core/engine/openings.ts`, `findOpenings`). A lehetőségek a terv szerint
  készülnek. Az új igény a beállított kitöltő elsőbbséget kapja. Az automatikus feladatot a
  feladatkiosztás adja; ehhez csak a kiosztás fut újra, a meglévő igények idejéhez nem nyúl.
  Minden lehetőség magával viszi a felvétel utáni terv bemenetét (`next`), így a próba és a
  felvétel ugyanazt kapja.
- **Eltérés a tervtől: a visszahozásról teljes próba dönt.** A halasztott igény a saját
  elsőbbségével kerül vissza, ezért átrendezheti a tervet; a gyors lista ezt nem látná. A
  teszt meg is mutatta: a hét közbeni figyelés „visszahozhatónak” mondott egy igényt, amelyet a
  gyors lista kihagyott volna. Halasztott igény kevés van, a teljes próba olcsó, és így a gomb és
  a figyelés ugyanazt mondja. A próba a lehetőséggel együtt jön (`trial`).
- **Az új igény azonosítója egyedi** a meglévő igényekhez képest. A teszt talált rá: a második
  keresés a már felvett plusz igény azonosítójával hozta létre a jelöltet, és a motor a saját
  helyét szabadnak látta.
- **A hét közbeni figyelés visszahozása** most a közös próbát használja. A javaslat azt is
  megnevezi, ki kerülne máshová a tervben, nem csak azt, hogy ki esne ki (a rögzítési listán is
  látszik). A figyelés időjárás-besorolása (`weatherOf`) közös a helykeresővel.
- **Teljesítmény:** valószerű flottán (26 gép, 300 foglalás, 13 növendék, 12 repülés) a lista kb.
  0,3 másodperc, próbaszámolás nélkül.
- **Ismert korlát** (a választott 1. javaslat szerint): a gyors lista a mostani tervhez mér. Egy
  plusz igényt, amely csak egy másik plusz igény átrendezésével férne be, nem talál meg. A kézi
  igényeket ez nem érinti: azokat a plusz igény az elsőbbség miatt amúgy sem mozdíthatja.
- **Tesztek:** `tests/core/engine/openings.test.ts` (12 eset):
  - van hely, a kézi igények nem mozdulnak;
  - sorrend, hiányzó ráérés, kétnapos időtáv;
  - halasztott igény, zárolt vagy elutasított visszahozás;
  - csak rossz idő, oktatói limit;
  - két plusz igény ugyanarra a helyre;
  - feladatok és feladatsorrend (az éjszakai feladat nem fér a munkaidőbe, ezért kimarad);
  - a próba megnevezi, ki kerül máshová;
  - teljesítmény.

  A figyelés tesztjei egy esettel bővültek (a visszahozás áthelyez valakit). Összesen 736 teszt
  zöld. Bemutató módban egy halasztott igény visszahozási javaslata a közös próbával is
  rendben megjelenik.

## „Van még hely?” gomb (egész hét)

- **Helye:** a Heti igények fejléce, a Tervezetről hivatkozással. Nyitott dilemmánál a
  Dilemmákhoz küld (KIT-06).
- **Ablak:**
  - növendék legördülő: a régen repültek és a magasabb foglalási prioritásúak elöl, mellettük a
    beférő feladatok száma;
  - feladat legördülő: első elem „⟳ Automatikus: <feladat>”, utána a kézi választások, végül a
    „feladat nélkül”; halasztott igénynél az első elem „Halasztott igény visszahozása”;
  - a kiválasztás után a próbaszámolás eredménye: „Ide kerülne: kedd 9:00, SEPAB · más nem
    változik”, vagy hogy melyik plusz igény mozdulna. Kiszorításnál vagy dilemmánál a
    felvétel nem ajánlott (KIT-04).
- **Felvétel:** a Heti igények meglévő felvétele (`newRequestFor`) közös függvénybe kerül, és
  ezt használja: időpont nélkül, a kitöltő elsőbbséggel, a növendéket kijelölve.
  Visszahozásnál csak a halasztás törlődik, elhelyező döntés nem kerül mellé. A H07 szabálya
  érvényes: ha a következő héten a másolatról már döntöttek, a visszahozás nem ajánlható.
- **Utána:** értesítés („Bekerült: kedd 9:00, SEPAB”), visszavonással. A lista újraszámol, mert
  a következő lehetőség helye a felvétel után már más lehet.

### Megvalósítás a P4-ben (2026-11-17)

- **Gomb:** „Van még hely?” a Heti igények és a Tervezet fejlécében. A terv szerinti
  „hivatkozás a Tervezetről” helyett ott is ugyanaz az ablak nyílik, mert így a felvétel hatása
  rögtön látszik az idővonalon.
- **Nyitott dilemmánál (KIT-06)** az ablak a Dilemmákhoz küld. A standby-ajánlás nem számít,
  mert az elhagyható, és nem múlik rajta a szabad hely.
- **Ablak:** növendék legördülő („Demó Csilla – 6 lehetőség”, a ráérés nélküliek jelölve), azon
  belül feladat legördülő a legjobb hely idejével („⟳ Automatikus: I./6. … (péntek 11.20. 14:05)”).
  Halasztott igénynél „Halasztott igény visszahozása”. Alatta a próbaszámolás: „Ide kerülne:
  péntek 11.20. 13:20–16:05 · HA-DCB (gépidő kezdete: 14:05) · más nem változik”, vagy ki kerülne
  máshová, ki szorulna ki, milyen dilemma keletkezne.
- **Felvétel:** csak akkor engedett, ha a próba szerint mellékhatás nélkül befér (nincs
  kiszorítás, nincs új dilemma). Ha mégis kell, a Heti igényeken kézzel felvehető.
- **Közös felvétel** (`newFlightRequest`, `takenLectureIds` az `autoAssign.ts`-ben): a Heti
  igények „+ Igény” gombja és a helykereső ugyanezzel hozza létre az igényt. A tervezetbe
  `addExtraRequest` teszi (a növendék felkerül a hétre). Visszahozásnál `undeferRequest` csak a
  halasztást törli, elhelyező döntés nem kerül mellé.
- **Háttérszál:** a keresés és a próba a tervező szálon fut (`openingsSession.ts`). A
  lehetőségek teljes bemenete (`next`) a szálon marad, a felület csak a megjelenítéshez
  szükséges részt kapja. A próbát a lehetőség kulcsával kéri; régebbi keresésre a szál nem
  számol, a lista újraszámol. A keresés csak a mostani bemenet kész tervéhez fut, így a lista
  és a próba ugyanazt a tervet látja.
- **Visszavonás:** felvétel után az ablakban jelzés („Bekerült: …”, Visszavonás), és a lista
  az új tervvel újraszámol. Bezárás után 10 másodpercig értesítés marad a visszavonással.
  A visszavonás a plusz igényt és döntéseit törli, és leveszi a növendéket a hétről, ha csak
  emiatt került fel. Visszahozásnál a halasztás jön vissza.
- **Akinek a visszahozását elutasítottad** („Marad halasztva”), az a listán sem szerepel
  (KIT-03). A H07 szerint zárolt halasztás szintén kimarad.
- **Mellékes javítás:** a képernyőfejlécben a bevezető szöveg legalább 380 px széles marad, a
  gombok inkább több sorba törnek (eddig a sok gomb keskeny oszlopba nyomta a szöveget).
- **Súgó:** új „Van még hely? – plusz igények” szakasz.
- **Tesztek:** `tests/renderer/openingsSession.test.ts` (8 eset):
  - a közös felvétel azonos a Heti igényekével;
  - a foglalt feladatok átugrása, a kitöltő elsőbbség;
  - a felvétel, a visszavonás és a növendék kijelölése;
  - a visszahozás csak a halasztást törli;
  - a szál csak a megjelenítéshez szükséges részt adja vissza;
  - a felvett igény oda kerül, ahová a próba mondta;
  - régebbi keresés próbája hibát ad.

  Összesen 744 teszt zöld. Bemutató módban végigpróbálva:
  - felvétel és visszavonás az ablakban, a lista mindkétszer újraszámol;
  - értesítés bezárás után;
  - ugyanaz az ablak a Tervezeten;
  - hat nyitott dilemmánál az ablak a Dilemmákhoz küld.

## Hét közbeni figyelés (következő 2 nap)

- **Sorrend (KIT-07):** a visszahozási javaslatok változatlanul, egymástól függetlenül
  készülnek. Utána egy tervezés, amelyben minden visszahozható igény a javasolt helyén van,
  és erre fut a helykeresés a következő 2 napra. Ha egy visszahozást elutasítanak („Marad
  halasztva”), a figyelés ma is újrafut, és a felszabadult hely megjelenik.
- **Megjelenés:** egyetlen összefoglaló tétel a rögzítési lista tetején és az indítópulton
  („Holnapig még 3 növendék férne be”). Erre kattintva ugyanaz az ablak nyílik, a 2 napra
  szűkítve. „Most nem”: napra szóló elutasítás a meglévő `watchDismissals` listában (új fajta:
  `capacity`).
- **Felvétel:** ugyanaz, mint a gombnál: időpont nélküli rendes igény, a kitöltő elsőbbséggel.
  A korábbi elemzésben a figyelésből felvett plusz igényt helyhez kötöttem volna, mint a
  visszahozást. Ezt elvetem: az elhelyező döntés minden elsőbbség előtt érvényesül, így
  megkerülné az ELS-02-t. Az elsőbbségi rétegek miatt a plusz igény amúgy is csak akkor mozdul,
  ha fontosabb igény vagy adatváltozás kívánja. A FlightLoggerbe rögzítés után pedig fix.
- **Futás:** a figyelés mostani alkalmaival (minden tervszámolás után, ha van mit figyelni, és
  a háttérben figyelt másik héten óránként). Csak a gyors keresés és egy plusz tervezés fut
  benne. Próbaszámolás csak kattintásra, hogy a háttérszál ne lassítsa a szerkesztést.
- A hétvégi tervezésnél a figyelés jellemzően nem fut (nincs mit figyelni): ott a gomb a belépés.

### Megvalósítás a P5-ben (2026-11-17)

- **Motor** (`watchWithCapacity`, `watchCapacity` az `openings.ts`-ben):
  - Előbb a megszokott figyelés fut, a visszahozási javaslatok egymástól függetlenül.
  - Ha van visszahozható igény, egy tervezés következik, amelyben mindegyik a javasolt helyén
    van (mintha elfogadtad volna). Erre fut a gyors helykeresés a következő 2 napra
    (`WATCH_RESTORE_DAYS`).
  - Akinek továbbra is halasztott igénye van (elutasított vagy nem visszahozható), az kimarad:
    nála a visszahozás a kérdés, és a figyelés nem futtat teljes próbát.
- **Eltérés a tervtől: a ráérés nélküli növendék nem ad jelzést.** A motor szabadnak veszi,
  ezért mindig „beférne”, és élesben a jelzés minden nap szólna. A gombbal megnyitott listán
  jelölve továbbra is szerepel.
- **Megjelenés:**
  - A rögzítési lista tetején egy sor: „Van még hely: a következő 2 napban még 1
    növendékednek férne be repülés vagy szimulátor (Demó Csilla).”, mellette **Megnézem** és
    **Most nem**.
  - Az indítópult figyelési kártyáján „van még hely” címke és egy összefoglaló sor. A háttérben
    figyelt másik hétnél is megjelenik, onnan a hét megnyitásával érhető el.
- **Megnézem:** ugyanaz az ablak, „Van még hely a következő 2 napban?” címmel, a 2 napra
  szűkítve. A mostani terven keres, ezért a még el nem fogadott visszahozásnál a halasztott
  igényű növendéknél a visszahozás szerepel.
- **Most nem:** új elutasítási fajta (`capacity`) a meglévő `watchDismissals` listában, a mai
  nap kezdetével; másnap a jelzés újra szólhat. A tervezet sémája ezzel bővült (visszafelé
  kompatibilis).
- **Futás:** a figyeléssel együtt, a tervező szálon; a háttérhétnél is. A haladást a felület
  adja át (`progressMap`), mert a szál nem éri el a hét adatát. A figyelés továbbra is csak
  akkor fut, ha van mit figyelni (FlightLoggerben lévő, rögzített vagy halasztott igény).
- **Tesztek:**
  - `tests/core/engine/openings.test.ts` (+4):
    - összefoglaló, 2 napos táv, ráérés nélküli kimarad;
    - napi elutasítás;
    - a visszahozás elveszi az egyetlen helyet;
    - elutasított visszahozásnál a hely szabad marad.
  - `tests/renderer/openingsSession.test.ts` (+1): az elutasítás tárolása és sémája.

  Összesen 749 teszt zöld. Egy teljes futásban egyszer egy időmérő teszt elbukott terhelés
  alatt, négy újrafuttatásban nem jött elő.
- **Bemutató módban kipróbálva:** egy igényt rögzítettnek jelöltem, és frissítettem. Utána:
  - az indítópulton és a rögzítési listán megjelent a jelzés (Demó Csilla);
  - a „Megnézem” a kétnapos ablakot nyitotta;
  - a „Most nem” eltüntette a jelzést.

### Megvalósítás a P6-ban (2026-11-17)

A koncepciódokumentum (Claude Docs és `docs/koncepcio.md`) változásai:

- **5. fejezet:** a bevezető megemlíti az új követelményeket. Új **5.9 Igény-elsőbbség és plusz
  igények** rész: ELS-01–05 és KIT-01–08 a megvalósított formában, utána a „Miért szabály, és nem
  súly”, a kiszorult plusz igény és az ismert korlát.
- **6. fejezet:** a 2. lépésben az elsőbbség, a 6. lépésben a „Van még hely?” gomb, a 9. lépésben
  a kétnapos jelzés.
- **7.5:** új pont a feladatsorrendről (ELS-05).
- **9.1:** a verseny csak azonos elsőbbségű igények között; alatta a különböző elsőbbségűek és a
  kiszorult plusz igény szabálya.
- **9.7:** a visszahozás sora megnevezi a közös próbát (KIT-08), új „Van még hely” sor (KIT-07).
  A Claude Docs-változatból a 9.7 eddig hiányzott (csak a helyi másolatban volt meg). Most a
  helyi szöveggel együtt került be.
- **10. fejezet:** a Heti igények, a Tervezet és a Rögzítési lista sora, és két új alapérték
  (igény elsőbbsége 1, plusz igény elsőbbsége 3). A foglalási prioritásnál a felirat jelzi, hogy
  ott az 5 a legfontosabb.

A Claude Docs-változatból továbbra is hiányzik a 9.6 párosításról szóló bekezdése (2026-11-16),
amely csak a helyi másolatban van meg. Ez nem a P6 része.

## Mérföldkövek

Minden mérföldkő végén `npm run typecheck`, `npm run lint`, `npm test`, utána megállok, és te
ellenőrzöd.

**P1 – Igény-elsőbbség** (ELS-01–04). Modell, séma, beállítások, a motor rétegei, verseny és
csere a rétegen belül, igénysor-választó, jelvény, súgó. Tesztek: visszafelé kompatibilitás
(minden igény 1-es: a terv változatlan), tulajdonságteszt (alacsonyabb elsőbbségű igény
felvétele a magasabbak helyét nem változtatja), csapat elsőbbsége.

**P2 – Feladatsorrend** (ELS-05). Kiosztás elsőbbség, majd lista szerint; a motor időrendi
szabálya az automatikus igényekre; a „nincs hely” indoklásában az új akadály.

**P3 – Helykeresés és próbaszámolás** (KIT-01–04, KIT-08). `findOpenings`, `trialPlan`, a
visszahozás átállítása a közös próbára. Szintetikus forgatókönyvek: van hely, csak halasztott,
csak rossz időben, limit miatt nincs, két plusz igény ugyanarra a helyre.

**P4 – „Van még hely?” ablak** (KIT-02–06). Gomb, legördülők, próbaszámolás a háttérszálon,
felvétel közös függvénnyel, értesítés, visszavonás, bemutató módban kipróbálható.

**P5 – Hét közbeni figyelés** (KIT-07). Összefoglaló tétel, elutasítás, indítópult, háttérhét.

**P6 – Dokumentáció.** ELS és KIT a koncepcióba (Claude Docs és `docs/koncepcio.md`: 5.7 vagy
új rész, 6. fejezet folyamata, 9.1 verseny, 9.7 figyelés), súgó.

## Feltételezések (megerősítendők)

1. Az elsőbbség szabály, súly nem kerül a beállításokba (lásd fent). *Jóváhagyva 2026-11-17.*
2. Az új mező neve a felületen „Elsőbbség (1 = először)”; a növendék foglalási prioritása marad
   (5 = legfontosabb) és súly.
3. A halasztott plusz igény a következő hétre is a saját elsőbbségével megy át (átírható).
4. A kiszorult plusz igény rendes „nincs hely” dilemma, ajánlásként halasztással.
5. Növendékenként legfeljebb 5 kézi feladat jelenik meg a listán, és a „feladat nélkül”.
6. Nem része a tervnek a „helycsinálás”, amely egy magasabb elsőbbségű igényt csaknem ugyanolyan
   jó helyre tenne át, hogy egy plusz igény beférjen. Ha a teszt közben sok kimaradó lehetőség
   látszik, külön kérdésként jöhet.
