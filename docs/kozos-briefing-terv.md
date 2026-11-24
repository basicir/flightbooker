# Közös briefing csapatok – megvalósítási terv

Állapot (2026-11-16): a terv jóváhagyva, **mind a négy mérföldkő (K1–K4) elkészült**, ellenőrzésre vár.
Az eltérések a tervtől a „Megvalósítás a K2-ben”, a „Megvalósítás a K3-ban” és a „Megvalósítás a
K4-ben” részben vannak. A KBR-követelmények a koncepciódokumentum 5.8 részébe kerültek (Claude Docs és `docs/koncepcio.md`).
A kiválasztott változat az „1. javaslat”: a csapattagság az igényen él, a motor rakja össze a
csapat idejét.

A K1 közben derült ki, és javítva: a tervezési kontextus a növendékek limitjét az első
elhelyezésig a FlightLogger-foglalások és a korábbi repülések nélkül számolta (LIM-03, LIM-06).

## Cél

Bizonyos feladatoknál több növendék egyszerre kezdi a foglalását, és közös briefinget kap. Utána
egymás után repülnek, a végén közös a debriefing. Az oktató nem tart külön briefinget minden
repülés előtt, így nő a fizetett (repült) idő aránya a lefoglalt időn belül.

## Eldöntött kérdések (2026-11-16)

| Kérdés | Döntés |
|---|---|
| Megvalósítás | 1. javaslat: csapatcímke az igényen |
| Observer | Nincs; a foglalások párokban vagy egyénileg készülnek |
| Pár | Egy multi student foglalás; a két növendék egymás után repül egy repülési ablakban |
| Oktatói átfedés a FlightLoggerben | A FlightLogger engedi menteni |
| Páratlan létszám | A maradék egyéni foglalással a csapatban marad |
| Debriefing | A csapat végén, közösen |
| Közös gép | Nem kötelező. Eltérő gépen egyéni foglalás készül, de a kezdés akkor is közös |
| Kézi csapatba szervezés | Az első kattintás új kézi csapatot hoz létre. A következő igényt a legutóbb létrehozott kézi csapatba teszi. Utána új csapat nyitható, vagy a tag áttehető egy másikba |

## Követelmények (javasolt azonosítók)

A koncepciódokumentum 5.8 részében vannak (Claude Docs és `docs/koncepcio.md`), a megvalósult viselkedés szerint pontosítva.

| ID | Követelmény |
|---|---|
| KBR-01 | Közös briefing csapat: a tagok foglalása azonos időben kezdődik. A közös briefing után a tagok egymás után repülnek, a végén közös a debriefing. |
| KBR-02 | Egységek: két, egymás után következő, azonos gépre kerülő tag egy multi student foglalás (pár). A többi tag egyéni foglalást kap, ilyen a páratlan maradék és az eltérő gépen repülő is. |
| KBR-03 | A Heti igények „Közös briefing szervezése” gombja feladatkódonként felismeri az azonos feladatú igényeket. Húzással csapatokba rendezhetők, és feladatonként több csapat is lehet. |
| KBR-04 | Kézi csapatba szervezés az igénysorban. Az első kattintás új kézi csapatot hoz létre, a következő igény a legutóbb létrehozott kézi csapatba kerül. Elérhető még az új csapat, az áthelyezés és a kivétel. A kézi gomb automatikus csapatba magától soha nem tesz senkit. |
| KBR-05 | A tagság az igényhez tartozik. Ami az igénnyel történik (törlés, levétel, halasztás), az a tagságával is megtörténik. Egy tag egyedül nem alkot csapatot. |
| KBR-06 | Ha egy tag feladata megváltozik, vagy a csapat egy főre fogy, azt a rendszer látható jelzéssel és egy kattintásos javítással jelzi, csendes törlés nélkül. |
| KBR-07 | A motor a csapatot egyben helyezi el. Ha így nem fér be, dilemma keletkezik. |
| KBR-08 | A tervezeten a csapat egyben mozog, és a tag menüből vehető ki a csapatból. |
| KBR-09 | A rögzítési listán csapatonként egy blokk szerepel, benne egységenként egy multi student vagy egy egyéni tétel. |
| KBR-10 | Egy FlightLogger multi student foglalás két igényhez tartozhat, növendékenként egyhez. A FlightLoggerben rögzített csapat nem számít kettős foglalásnak. |
| KBR-11 | A hét közbeni figyelés a csapatot egyben javasolja áthelyezni, vagy felajánlja a tag leválasztását. |
| KBR-12 | Beállítható csereidő (alapból 10 perc), a páron belüli és a gépváltásos egységek közötti szünet. |

## Időszerkezet

- **Briefing:** a tagok briefingjeinek maximuma. **Debriefing:** a tagok debriefingjeinek maximuma.
- **Sorrend:** napi sorrend (NOV-05), aztán prioritás (NOV-12), végül azonosító.
- **Párképzés:** a sorrendben az első pár nélküli tag párt alkot a következő, vele azonos gépre
  kerülő taggal. Egy egység az első tagja helyén áll a sorban.
- **Gép:** tagonként a meglévő szabályok szerint (engedélyezett gépek, tartalék, preferencia). A
  pár azonos gépe pontot ér, de nem kötelező.
- **Rés az egységek között:**
  - azonos gépen: a csereidő és a gép fordulóideje közül a nagyobb;
  - másik gépen: a csereidő;
  - ha a gép aznap még nem repült: legalább a motorpróba ideje.
- **Rés a páron belül:** a csereidő.
- **Közös kezdés:** az első repülés kezdete, mínusz a briefing, mínusz a motorpróba, ha az első
  egység gépe aznap még nem repült (SZB-05).
- **A tag ideje:** a foglalás a közös kezdéskor indul, és a közös végén zárul (az utolsó repülés
  vége plusz a debriefing). A repülés a tag saját szakasza.
- **FlightLogger-foglalás egységenként:** a kezdete és a vége közös. Párnál a repülési ablak az
  első tag kezdetétől a második tag végéig tart, a cserét is beleértve.

Példa: 4 növendék, I./7 feladat, 60 perc repülés, 45 perc briefing, 30 perc debriefing, 10 perc
csere, 15 perc fordulóidő, egy gép:

```
08:00–08:45  közös briefing: A, B, C, D
08:45–10:55  1. pár (A 08:45–09:45, csere, B 09:55–10:55)
11:10–13:20  2. pár (C 11:10–12:10, csere, D 12:20–13:20)
13:20–13:50  közös debriefing
Mindkét FlightLogger-foglalás: 08:00–13:50; repülés 08:45–10:55, illetve 11:10–13:20
```

Az oktató lefoglalt ideje 540 helyett 350 perc. Ugyanannyi, 240 perc repült idő mellett ez 44%
helyett 69% kihasználtság.

## Adatmodell

- `BookingRequest.briefingTeamId?: string`: a tagság egyetlen forrása.
- `WeekPlan.briefingTeams?: Array<{ id, origin: 'auto' | 'manual', createdAt }>`.
  - A csapat neve a létrehozás sorrendjéből jön („1. csapat”, „2. csapat”).
  - Mentéskor a tag nélküli csapat törlődik.
  - Ha egy igény ismeretlen csapatra hivatkozik, betöltéskor kézi csapatként jön létre.
  - A halasztott igény következő heti másolata nem viszi tovább a tagságot.
- `Decision` `assign`: új, opcionális `team` mező. Csapatelhelyezést jelent: a `slot.start` a közös
  kezdés, a `slot.resourceId` a tag gépe.
- Új döntésfajta, `{ kind: 'teamOff', requestId }`: a tag ezen a héten egyénileg tervezett, a
  tagsága megmarad. Visszavonható, mint minden döntés (TRV-12).
- `DilemmaOption.also?: Decision[]`: egy csapatlehetőség a `decision` mellett a többi tag döntését
  is rögzíti. Ez nem mentett adat, csak a motor és a varázsló használja.
- A beállítások v7-re lépnek, migrációval: `defaults.teamSwapMinutes`, alapból 10.
- `ExistingBooking.lessons?: Array<{ studentId, lectureId?, lectureName? }>`: a multi student
  foglalás feladatai növendékenként. Az observerek is résztvevők.
- `PlanResult.teams`: csapatonként a tagok, a közös kezdés és vég, és az egységek (`requestIds`,
  `resourceId`, repülési ablak, foglalásfajta), valamint az állapot. Az állapot lehet `placed`,
  `tentative`, `unplaced` vagy `individual`. `Proposal.teamId?`.

## Motor (`src/core/engine/`)

1. **Csapatok összeállítása.** Tag az az igény, amelyik címkés, és nem halasztott, nem `teamOff`,
   nincs egyénileg a FlightLoggerben, és nincs fix időpontja.
   - Két vagy több tag csapatot alkot. Ha csak egy tag marad, egyéniként tervezett, és `team`
     figyelmeztetést kap (új `WarningKind`).
   - Vegyes feladatú csapatnál ugyanígy figyelmeztetés jár.
2. **Rögzített tagok.** A FlightLoggerben már meglévő egységek a helyükön maradnak, a csapat többi
   része hozzájuk igazodik. Ha emiatt a közös vége eltér, a rögzítési lista jelzi.
3. **Döntések.** Csapatdöntésnél a legutóbbi döntés közös kezdése és a tagok döntésben rögzített
   gépe számít, a csapat erre rakódik ki újra.
   - Ha közben változott a tagság, az új összetétel ugyanerre a kezdésre kerül.
   - Ha így a hely nem tiszta, a döntés megdől (`decisionIssues`, H08), és a csapat újra sorra
     kerül.
   - A vállalt figyelmeztetés úgy működik, mint eddig.
   - Ha egy tagnak korábbi egyéni elhelyező döntése van, az nem alkalmazható, és `decisionIssues`
     jelzi.
4. **Mohó kör.** A `remaining` halmazban a csapat egy tétel (`team:<id>`).
   - Jelöltek: a közös kezdés rácsa, kombinálva a gépkiosztással (tagonként a legjobb egy-két gép,
     a párképzés előnyben).
   - Kiértékelés tagonként a meglévő `evaluate`-tel. A jelölt kizárt, ha bármelyik tag kizáró
     feltételt sért, és figyelmeztetéses, ha bármelyiké az.
   - A pont a tagok súlyozott pontjainak átlaga.
   - A szűkösség és a verseny a csapat teljes idejére számolódik, ahogy egy igénynél.
   - A tag preferált ablakai (TRV-02) a pontozásba számítanak. A kizáró ablakoknak mindegyik tagnál
     teljesülniük kell.
5. **A csapaton belüli átfedés nem ütközés.**
   - A `Placement` új `team` mezőt kap, és az oktatói ütközésvizsgálat (`planned()`) kihagyja
     ugyanannak a csapatnak a tagjait.
   - A FlightLoggerben már rögzített csapattárs foglalása `ignoreRefs`-ként szerepel.
6. **Helyi javítás.** A csapat egyben mozog.
7. **Nincs tiszta hely.** Dilemma: „A csapat nem fér be együtt.” Lehetőségek:
   - figyelmeztetéssel;
   - erőltetés a legközelebbi helyre;
   - „Egyénileg ezen a héten” (`teamOff` minden tagra);
   - halasztás minden tagnak.
8. **A FlightLoggerben rögzített csapat felismerése.** Csapatnak számít: azonos oktató, azonos
   kezdés, legalább két gépes oktatási foglalás, egymást nem átfedő repülési ablakokkal. Ezek
   egymás közt nem kettős foglalások, a figyelés sem jelzi őket.
9. **Rögzített és döntött hely ideje.** Csapattagnál a `timesOfRecorded` és a `timesOfDecision` a
   csapat elrendezéséből számol, nem a briefing + repülés + debriefing képletből.
10. **Limitek.**
    - A tag repült ideje a saját szakasza.
    - A szolgálati ideje a közös kezdéstől a közös végig tart.
    - Az oktató szolgálati ideje a nap első kezdésétől az utolsó végéig számolódik, ezért az átfedés
      nem számít kétszer (ez ma is így van).
11. **Fizetett idő** (`src/core/draft/paidTime.ts`). Az átfedés vizsgálata a repülési ablakok
    szerint történik, nem a teljes foglalás szerint. Különben a 2. pár kiesne, amint az 1. pár
    rögzítve van.

### Megvalósítás a K2-ben (eltérések a fenti tervtől)

- **Sorrend:** a csapat nem a mohó kör egy tétele. A fix időpontok után és a többi igény előtt
  kerül helyre, mert ez a legnagyobb tétel. A fix időpontú igények ideje addig le van foglalva.
  Csapat és egyéni igény között ezért nincs versenydilemma: az egyéni igények a csapat köré
  kerülnek.
- **Jelöltek:** közös kezdés, kombinálva a „fő gép” változataival. Minden tag a fő gépre kerül, ha
  repülhet vele, különben az első engedélyezett gépére. A legjobb öt tiszta jelöltből az első kerül
  be, amely a csapattársakkal együtt (limitek) is tiszta marad.
- **Helyi javítás:** a csapatot nem mozdítja, és a „nincs hely” dilemma cseréje sem veheti el egy
  tag helyét.
- **Dilemma:** nincs „erőltetés”. Ha csak a csapattársakkal együtt keletkezik figyelmeztetés (például
  az oktató napi repült ideje), a vállalás lehetőségként megjelenik.
- **Egy tagnál marad a gép:** csapatdöntésnél a választott gép a többi tagé is, ha repülhetnek vele.
- **Rögzített, még le nem hozott pár:** azonosító nélkül az előző taggal egy foglalásnak számít, ha
  ugyanazon a gépen a csere után közvetlenül repül.
- **A K3–K4-re maradt:**
  - a vegyes feladat jelzése (a motor nem ismeri a feladatkatalógust, a felület igen);
  - a FlightLoggerben közvetlenül felvett csapat felismerése;
  - a hét közbeni figyelés csapatszinten;
  - az időpont-térkép csapatnál.

## FlightLogger-oldal (csak olvasás, ALP-03)

- **`BookingsQuery`:**
  - MultiStudentBooking: `observers { id }` és `plannedLessons { student { id } lecture { … } }`;
  - SingleStudentBooking: `observers { id }`.
- **`mapBooking`:** az observerek résztvevők, a feladatok növendékenként kerülnek a `lessons`-be.
- **`linkBookings`:**
  - Egy multi student foglalás legfeljebb annyi igényhez tartozik, ahány növendéke van, és
    növendékenként egyhez.
  - Repülésnél a helyén talált foglalásban szerepelnie kell a növendéknek. Ha csak az oktató
    egyezik, az nem elég, mert a csapat foglalásai mind átfednek az oktatóval.
  - A feladat szerinti keresés a növendék saját feladatával történik.
- **A pár tagjainak saját szakasza:**
  - a rögzítéskori szakasz, ha a foglalás repülési ablaka azóta nem változott;
  - különben a két feladat repülési idejének arányában, Student 1, majd Student 2 sorrendben.
- **Automatikus feladatválasztás** (`bookedLectureIds`): a növendék saját feladata a multi student
  foglalásból.
- **Limit a nem tervből származó multi student foglalásnál:** a repülési ablak a növendékek számával
  osztva. A saját repülések napi listája (`context.ts`) minden növendéket felvesz, nem csak az
  elsőt.

## Felület

**Heti igények**
- „Közös briefing szervezése” gomb a fejlécben. Panelt nyit, feladatkódonként („I./7. Traffic
  patterns I.”):
  - a szóba jövő igények chipként jelennek meg;
  - sávok: a hét meglévő csapatai, „+ Új csapat” és „Egyénileg”;
  - húzással rendezhető, feladatonként több csapat is lehet, és minden módosítás visszavonható;
  - a panel magától senkit nem tesz csapatba.
- Szóba jövő igény: repülés vagy szimulátor, van feladata, nincs fix időpontja, nem halasztott, és
  nincs egyénileg a FlightLoggerben. Útvonalas repülésnél azonos útvonal kell, és a napszaknak is
  egyeznie kell.
- **Igénysor, csapat nélkül:** „Csapatba” gomb. Ha a héten már van kézi csapat, a legutóbb
  létrehozottba teszi az igényt, különben új kézi csapatot hoz létre. A visszajelzésből
  („→ 2. csapat · Új csapat · Áthelyezés”) azonnal javítható.
- **Igénysor, csapattal:** a csapat neve legördülő menüvel: Új csapat, Áthelyezés (a hét csapatai),
  Kivétel.
- **Jelzések az igénysoron:**
  - „csapattárs nélkül”;
  - „más feladat, mint a csapaté”;
  - „ezen a héten egyénileg” (dilemma-döntés, visszavonással);
  - „csapatban az időpontot a csapat adja”: a saját időzítés megmarad, de csapatban nem hat.

**Dilemma-varázsló.** A csapatdilemma kártyáján a tagok és az egységek látszanak. Egy lehetőség
több döntést rögzít. Az időpont-térkép (`explore.ts`) csapatnál a közös kezdéseket mutatja.

**Tervezet-nézet**
- A csapat blokkjai közös keretben jelennek meg, a csapat nevével.
- Bármelyik tagot húzva az egész csapat eltolódik (a közös kezdés változik). Másik gépsorra
  ejtve csak annak a tagnak a gépe változik, és a párok újraképződnek.
- Menüpont: „Kivétel a csapatból”. A „Miért ide?” csapatszinten is elérhető.

**Rögzítési lista**
- Csapatonként egy blokk („Közös briefing 08:00 · 2. csapat”). Alatta egységenként egy tétel:
  - multi student: Student 1 és Student 2, mindkettő programmal és feladattal;
  - vagy single student.
- A foglalás kezdete és vége a közös idő, a repülés az egységé.
- Rögzítettnek egységenként jelölhető, a pár mindkét igénye együtt kapja meg.

**Indítópult és Figyelmeztetések.** Itt jelennek meg a csapat változásai: egy tag feladata
megváltozott, a csapat egy főre fogyott, vagy egy tagot egyénileg foglaltak le a FlightLoggerben.

### Megvalósítás a K3-ban (eltérések a fenti tervtől)

- **„Közös briefing szervezése” ablak:**
  - Csak azokat a feladatokat mutatja, amelyek legalább két növendéknél szerepelnek.
  - A vegyes feladatú kézi csapat ezért csak azokban a csoportokban látszik, ahol van azonos
    feladatú tagja. Egyébként az igénysorból kezelhető.
  - Húzás mellett minden növendéknél ott a választó (▾), így billentyűzettel is használható.
- **A panelben létrehozott csapat „automatikus”,** a kézi gomb sosem tesz bele magától.
- **Feladat nélküli igény:** kézzel csapatba tehető (egyéni foglalásként repül a csapattal), a
  panelben nem, mert nincs feladatkódja.
- **Tervezet:**
  - A gépsoron a tag csak a saját repülésével látszik, az oktatói sávon a csapat egy blokk.
  - A részben rögzített csapat nem húzható, mert a kezdése kötött.
  - Az „Áthelyezés…” a csapattagnál az egész csapatot tolja.
- **Dilemma-varázsló:** a csapatdilemmánál nincs egy tagra szóló időpont-térkép és tagonkénti
  halasztás.
- **Rögzítési lista:** a csapat foglalásai a repülés sorrendjében jelennek meg („1/3. foglalás”). A
  számláló igényenként számol, egy pár tehát két tételnek számít.

## Hét közbeni figyelés

A figyelés egy csapat tagjait együtt nézi.
- Ha egy tag helyén új akadály van, a javaslat a csapat áthelyezése, egyetlen javaslatként, minden
  taggal.
- Ha a csapat egyben sehol nem fér be, a javaslat a tag leválasztása és egyéni áthelyezése.
- Elfogadáskor minden érintett foglalás FlightLogger-jelölést (`flChanges`) kap.

### Megvalósítás a K4-ben

- **A FlightLoggerben közös kezdéssel felvett foglalások felismerése** (`flightLoggerTeams`): ugyanannak
  az oktatónak az azonos kezdésű, gépes oktatási foglalásai, egymást nem átfedő repülési ablakkal.
  Az egyedüli multi student foglalás is ilyen csoport, mert a két növendék egymás után repül.
- **A figyelés ütközésvizsgálata:** a figyelés a terv csapatait és ezeket a csoportokat egyaránt
  csapatként kezeli, így a tagok egymással nem ütköznek. Ez egy K1 óta meglévő hibát is javít: a
  multi student foglalás két igénye addig „az oktató foglalt” miatt fölösleges áthelyezési
  javaslatot kapott.
- **Csapatjavaslat:** ha egy tag helyén új akadály van, vagy kockázatos az idő, a javaslat egy
  `move` tétel `team` mezővel. Ebben minden tag szerepel, a még csak tervben lévők is. Az első tag
  adja a javaslat azonosítóját és a „Marad így” elutasítás kulcsát.
- **Elfogadás** (`planTeamMove`):
  - a FlightLoggerben lévő tagok foglalása áthelyezendő jelölést kap;
  - minden tag csapatdöntést kap az új közös kezdéssel;
  - a FlightLoggerben közvetlenül felvett csoportból kézi csapat lesz.
- **Ha a csapat egyben sehol nem fér be:** a gondban lévő FlightLogger-tagok egyenként kapnak
  javaslatot, `leavesTeam` jelöléssel. Elfogadáskor a tag a terv csapatából is kikerül.
- **Kivétel:** ha a csapatnak rögzített, de a FlightLoggerből még le nem hozott tagja van, a csapat
  nem mozdul egyben.
- **Rögzítési lista:** ha egy egység minden tagja áthelyezendő, a FlightLoggerben átírandó foglalás
  egy tételben jelenik meg, a pár közös repülési ablakával.
- **Nincs kipróbálva az alkalmazásban:** a csapatjavaslat felülete. A bemutató adatában nincs
  FlightLogger-foglalás a csapattagokhoz, így a működést tesztek igazolják.

## Életciklus

| Esemény | Mi történik |
|---|---|
| Igény törlése, a növendék levétele, halasztás | Kikerül a csapatból. A halasztott igény csapat nélkül megy át a következő hétre. |
| Csak egy tag marad | Már nem csapat: egyéniként tervezett, és „csapattárs nélkül” jelzést kap. Ha új tag érkezik, a csapat újra él. |
| A tag feladata megváltozik | Jelzés az igénysorban és az indítópulton. Vegyes feladatú csapatként tervezett, amíg ki nem veszed. |
| Húzás a tervezeten | Az egész csapat mozog. A tag a menüben vehető ki a csapatból. |
| A csapat egyben nem fér be | Dilemma: figyelmeztetéssel, erőltetés, egyénileg ezen a héten, vagy halasztás. |
| Egy egység már a FlightLoggerben van | A helyén marad, a többi egység hozzá igazodik. |
| Valaki a FlightLoggerben egyénileg foglalja le a tagot | Jelzéssel kikerül a csapatból. |

## Mérföldkövek

Minden mérföldkő végén: `npm run typecheck`, `npm run lint`, `npm test`, utána a felhasználó
ellenőriz.

- **K1 – FlightLogger-alapok.** Csapat nélkül is javítás, mert a mostani multi student foglalásokat
  is érinti.
  - A lekérdezés, a leképezés és a párosítás (egy foglalás két igényhez).
  - Az automatikus feladatválasztás, a limit és a saját repülések listája.
  - A fizetett idő a repülési ablak szerint.
  - Tesztek szintetikus FlightLogger-adattal.
- **K2 – Adatmodell és motor.**
  - Sémák: igény, heti terv, döntés, és a beállítások v7-es migrációja.
  - A csapatok összeállítása, az időszerkezet, a mohó kör, a helyi javítás, a dilemmák, a
    döntések, a rögzített tagok és a FlightLoggerben rögzített csapat felismerése.
  - Aranytesztek: a fenti 4 fős példa, páratlan létszám, eltérő gép, rossz idő egy későbbi
    tagnál, limit, egy egység rögzítve, halasztás, feladatváltozás.
- **K3 – Felület.** A Heti igények (gomb, panel, kézi csapatba szervezés), a Dilemma-varázsló, a
  Tervezet-nézet, a Rögzítési lista és a jelzések. Kipróbálás demóadattal, az alkalmazásban.
- **K4 – Hét közbeni figyelés csapatszinten**, végső ellenőrzés.

## Feltételezések (megerősítendők)

- Kézi csapatba eltérő feladatú igény is kerülhet, jelzéssel. Az automatikus panel csak azonos
  feladatkódú igényeket csoportosít, revíziótól függetlenül, a kód alapján (I./7.).
- A csereidő alapból 10 perc.
- Fix időpontú igény nem lehet csapattag.
