/**
 * A program súgója – a felhasználói útmutató (docs/Foglalastervezo-utmutato.pdf) tartalma a
 * programon belül, képernyőnként megnyitható szakaszokra bontva.
 *
 * Szövegközi jelölések (lásd `helpText.ts`):
 *   **Gomb**            – a felület egy felirata (gomb, fül, mező)
 *   [szöveg](#azonosító) – hivatkozás a súgó másik szakaszára
 *   [[Enter]]           – billentyű
 *
 * Tiszta adat (nincs benne JSX és állapot), hogy a tesztek Node alatt is ellenőrizhessék.
 */

/** A képernyők azonosítói; a `state.tsx` `ScreenId` típusával egyezik (a HelpPanel ezt mindkét irányban ellenőrzi). */
export type HelpScreen = 'dashboard' | 'requests' | 'theories' | 'dilemmas' | 'draft' | 'recording' | 'warnings' | 'settings'

export type HelpBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'steps'; readonly items: readonly string[] }
  | { readonly kind: 'note'; readonly tone: 'tip' | 'important' | 'info'; readonly text: string }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }
  | { readonly kind: 'h'; readonly text: string }

/** A szakaszhoz tartozó képernyő: a súgóból egy kattintással oda lehet lépni. */
export interface HelpTarget {
  readonly screen: HelpScreen
  readonly settingsTab?: string
}

export interface HelpSection {
  readonly id: string
  readonly title: string
  readonly blocks: readonly HelpBlock[]
  readonly open?: HelpTarget
}

export interface HelpChapter {
  readonly number: number
  readonly title: string
  readonly sections: readonly HelpSection[]
}

const p = (text: string): HelpBlock => ({ kind: 'p', text })
const list = (...items: string[]): HelpBlock => ({ kind: 'list', items })
const steps = (...items: string[]): HelpBlock => ({ kind: 'steps', items })
const tip = (text: string): HelpBlock => ({ kind: 'note', tone: 'tip', text })
const important = (text: string): HelpBlock => ({ kind: 'note', tone: 'important', text })
const info = (text: string): HelpBlock => ({ kind: 'note', tone: 'info', text })
const h = (text: string): HelpBlock => ({ kind: 'h', text })
const table = (head: string[], ...rows: string[][]): HelpBlock => ({ kind: 'table', head, rows })

export const HELP: readonly HelpChapter[] = [
  {
    number: 1,
    title: 'Mire való a program?',
    sections: [
      {
        id: 'alapelvek',
        title: 'Alapelvek',
        blocks: [
          p(
            'A Foglalástervező a saját gépeden futó alkalmazás. A FlightLogger adataiból (gépek, foglalások, növendékek, termek) és az időjárás-előrejelzésből heti foglalási tervezetet készít az oktatónak – a kész tervet te viszed fel kézzel a FlightLoggerbe.',
          ),
          list(
            '**Csak olvas.** A program a FlightLoggerbe soha nem ír: nem hoz létre, nem módosít és nem töröl foglalást. Ezt technikai zár garantálja, nem csak szokás.',
            '**Nem dönt helyetted.** Ahol két hasonló fontosságú igény ütközik, vagy egy foglalás csak figyelmeztetéssel fér be, ott dilemmát mutat érvekkel és ajánlással – a döntés a tiéd.',
            '**Mindent megindokol.** Minden javaslatnál megnézheted, miért oda került: szempontonként látszik a súly és a pontszám, így megbízhatsz benne, vagy felülírhatod.',
          ),
          h('Amit a program figyelembe vesz'),
          list(
            'a gépek, szimulátorok és termek meglévő FlightLogger-foglalásait,',
            'a növendékek haladását és soron következő feladatát, engedélyezett és preferált gépeit,',
            'az időjárás-előrejelzést az iskolai (vagy növendékenkénti) minimumhoz mérve,',
            'a repülési, szolgálati és pihenőidő-limiteket (növendék és oktató),',
            'a gépek karbantartásig kirepülhető idejét, a munkaidődet és a repülőtér nyitvatartását.',
          ),
          h('Amire nem való'),
          list(
            'Nem helyettesíti a METAR/TAF alapú repülés előtti időjárási felkészülést.',
            'Nem hatósági nyilvántartás, és nem váltja ki a FlightLogger saját figyelmeztetéseit.',
            'Nem hangol össze több oktatót: egy oktató heti tervét készíti.',
            'Nem küld értesítést a növendékeknek, és nem kezel számlázást.',
          ),
        ],
      },
      {
        id: 'munkafolyamat',
        title: 'A heti munkafolyamat',
        blocks: [
          p(
            'Az oldalsáv öt számozott lépése pontosan ezt a sorrendet követi. Bármikor visszaléphetsz egy korábbi lépésre; a terv minden változtatás után azonnal újraszámolódik.',
          ),
          table(
            ['Lépés', 'Mit csinálsz?'],
            ['1. [Heti igények](#igenyek)', 'Kivel és milyen feladatot repülnél a héten? Egy kattintás növendékenként.'],
            ['2. [Elméletek](#elmeletek)', 'Elméleti órák résztvevőkkel, hosszal, teremmel – jellemzően rossz időre.'],
            ['3. [Dilemmák](#dilemmak)', 'Az ütközések és figyelmeztetések egyenkénti eldöntése, ajánlással.'],
            ['4. [Tervezet](#tervezet)', 'Idővonal a hétre; húzással mozgatható, majd elfogadod.'],
            ['5. [Rögzítési lista](#rogzites)', 'Másolható mezők a FlightLogger űrlapjának sorrendjében.'],
          ),
          h('Ha csak öt perced van'),
          steps(
            'Indítsd el a programot, és végezd el az [Első beállítást](#beallitas-attekintes).',
            'A **Heti igények** képernyőn kattints a növendékekre, akikkel a héten dolgoznál.',
            'Döntsd el a **Dilemmákat** – vagy bízd a rendszerre a maradékot.',
            'Nézd át a **Tervezetet**, húzással igazíts rajta, majd fogadd el.',
            'A **Rögzítési lista** mezőit másold át a FlightLoggerbe, és jelöld rögzítettnek.',
          ),
        ],
      },
    ],
  },
  {
    number: 2,
    title: 'Első indítás és beállítás',
    sections: [
      {
        id: 'beallitas-attekintes',
        title: 'A beállító varázsló',
        blocks: [
          p(
            'Az első indításkor egy hétlépéses varázsló fogad. A lépések a fejléc gombjaival tetszőleges sorrendben is bejárhatók; minden itt megadott érték később a [Beállítások](#beallitasok) képernyőn módosítható.',
          ),
          table(
            ['Lépés', 'Mit adsz meg?'],
            ['1. [Adatforrás](#beallitas-adatforras)', 'API-kulcs vagy bemutató mód'],
            ['2. [Repülőtér](#beallitas-repuloter)', 'ICAO-kód, koordináta, pályairányok, nyitvatartás'],
            ['3. [Limitek és időjárás](#beallitas-limitek)', 'Iskolai időjárási minimum, repülési/szolgálati limitek'],
            ['4. [Gépek](#beallitas-gepek)', 'Besorolás, motorpróba, fordulóidő, puffer'],
            ['5. [Termek](#beallitas-termek)', 'Férőhely és preferencia'],
            ['6. [Növendékek](#beallitas-novendekek)', 'Saját növendékeid, gépeik, feladatsoruk, prioritásuk'],
            ['7. [Munkaidő](#beallitas-munkaido)', 'Heti munkaidő-ablak, tiltott időszakok'],
          ),
          tip(
            'Nem kell elsőre mindent tökéletesre állítani. A terv minősége viszont közvetlenül a helyi beállítások minőségén múlik – az első egy-két hét után érdemes finomítani.',
          ),
        ],
      },
      {
        id: 'beallitas-adatforras',
        title: '1. lépés – Adatforrás',
        blocks: [
          h('Élő adatok: FlightLogger API-kulcs'),
          steps(
            'Írd be a kulcsot a **FlightLogger API-kulcs** mezőbe, majd **Mentés és próba**.',
            'Sikeres próba után megjelenik a **Tovább élő adatokkal** gomb, és betöltődnek a gépek, termek és felhasználók.',
          ),
          important(
            'A kulcsot csak ebbe a mezőbe írd be. A program a rendszer titoktárolójába menti (macOS Kulcskarika, Windows DPAPI) – a beállítási fájlba, naplóba vagy jelentésbe soha nem kerül.',
          ),
          h('Kipróbálás: bemutató mód'),
          p(
            'A **Bemutató mód szintetikus adattal** gomb kitalált növendékekkel, gépekkel és időjárással tölti fel a programot, hálózat nélkül. Kockázat nélkül kipróbálható benne a teljes heti folyamat.',
          ),
          tip('Bemutató módból később a [Beállítások → Adatforrás](#b-adatforras) fülön válthatsz élő adatokra.'),
        ],
      },
      {
        id: 'beallitas-repuloter',
        title: '2. lépés – Repülőtér',
        open: { screen: 'settings', settingsTab: 'Repülőtér' },
        blocks: [
          list(
            '**ICAO-kód.** Négy betű beírásakor a koordináta és a pályák a programba épített repülőtér-listából maguktól kitöltődnek.',
            '**Pályairányok.** Az oldalszél számításához kellenek. Egy irányt elég megadni, az ellentétes (pl. 04 → 22) magától kitöltődik. Valós (földrajzi) irányt adj meg, mert az előrejelzés széliránya is valós.',
            '**Nyitvatartás.** Naponként állítható. A motor csak a nyitvatartás és a te munkaidőd közös részébe tesz foglalást.',
          ),
          tip(
            'Az időjárás-előrejelzés a repülőtér koordinátájára érkezik – a harmadik fél felé kizárólag ez a koordináta, az időablak és a modell neve megy ki.',
          ),
        ],
      },
      {
        id: 'beallitas-limitek',
        title: '3. lépés – Limitek és időjárás',
        open: { screen: 'settings', settingsTab: 'Limitek' },
        blocks: [
          list(
            '**Iskolai időjárási minimum.** Legnagyobb szél, széllökés, oldalszél; legkisebb látás és felhőalap; csapadék. Ez a „rossz idő” általános küszöbe. A következő 0–2 napra kizáró feltétel, távolabb pontlevonás (mert addig az előrejelzés még bizonytalan).',
            '**Limitek.** A Training Manual szerinti növendéki, illetve az Operations Manual szerinti oktatói repülési, szolgálati és pihenőidő-szabályok. Mindegyik ki-be kapcsolható, a határérték és a jelzési százalék átírható.',
          ),
          important(
            'A limit túllépése nem tiltja a foglalást: a program dilemmaként a jóváhagyásodat kéri. Az oktatói limitek kiinduló minták – az iskolád Operations Manualjának értékeivel írd felül őket.',
          ),
        ],
      },
      {
        id: 'beallitas-gepek',
        title: '4. lépés – Gépek',
        open: { screen: 'settings', settingsTab: 'Gépek' },
        blocks: [
          list(
            '**Sorrend.** A sorok a fogantyúval vagy a nyilakkal rendezhetők; a tervezet ebben a sorrendben mutatja a gépeket.',
            '**Besorolás.** A program javaslatot ad (repülőgép vagy szimulátor), de te döntöd el. Szimulátorra az időjárás és a motorpróba nem vonatkozik.',
            '**Motorpróba, fordulóidő, biztonsági puffer.** Gépenként felülírható értékek. A motorpróba a nap első repülése előtt számít; a fordulóidő két repülés között; a puffer a karbantartás előtti tartalék (órában).',
            '**Karbantartás.** A lap alján a következő karbantartás fajtájához megadható a túlrepülhető idő és a karbantartás hossza (részletek: [Beállítások → Gépek](#b-gepek)).',
          ),
        ],
      },
      {
        id: 'beallitas-termek',
        title: '5. lépés – Termek',
        open: { screen: 'settings', settingsTab: 'Termek' },
        blocks: [
          p(
            'Itt a termek férőhelyét és preferenciáját adod meg (1 = legjobb). A férőhelyet a program a terem nevében lévő számból előre kitölti.',
          ),
        ],
      },
      {
        id: 'beallitas-novendekek',
        title: '6. lépés – Növendékek',
        open: { screen: 'settings', settingsTab: 'Növendékek' },
        blocks: [
          list(
            '**Keresés.** Legalább két betűvel kereshetsz a FlightLogger felhasználói között. A beállítási fájlba csak az azonosító kerül, a név nem.',
            '**Gépek.** Kattints egy lajstromra: nincs → engedélyezett (✓) → preferált (★). Géptípusra egyszerre is állítható.',
            '**Feladatsor / revízió.** Itt választod ki, melyik program-revízió szerint halad a növendék; ebből tudja a program a soron következő feladatot és annak idejét.',
            '**Egyéni értékek.** Prioritás (1–5), „régen repült” küszöb, képzési fázis, és ha kell, szigorúbb egyéni időjárási minimum.',
          ),
          tip('Ha egy növendéknél a „Nincs feladatsor: válassz revíziót” jelzést látod, itt rendelj hozzá revíziót.'),
        ],
      },
      {
        id: 'beallitas-munkaido',
        title: '7. lépés – Munkaidő',
        open: { screen: 'settings', settingsTab: 'Munkaidő' },
        blocks: [
          list(
            '**Heti munkaidő-ablak.** Naponként megadod, mettől meddig tervezhet a program. Amelyik napot kikapcsolod, arra nem kerül foglalás.',
            '**Tiltott időszakok.** Amikor nem érsz rá. Ismétlődő (egyszerre több napra, egész napra vagy idősávra, érvényességi dátumokkal) vagy eseti (egy vagy több nap, egész nap vagy idősáv). A motor ide soha nem tesz foglalást; ha kézzel húzol ide valamit, figyelmeztet. Az elmúlt időszakok maguktól törlődnek.',
          ),
          p('A **Beállítás befejezése** gomb elmenti a beállításokat, letölti a hét adatait, és megnyitja az Indítópultot.'),
        ],
      },
    ],
  },
  {
    number: 3,
    title: 'A felület felépítése',
    sections: [
      {
        id: 'felulet',
        title: 'Oldalsáv, hétjelző, adatfrissítés',
        blocks: [
          p(
            'Minden képernyő ugyanarra a vázra épül: bal oldalt az oldalsáv, fent a képernyő címe a hétjelzővel, jobbra fent a következő lépés gombja.',
          ),
          list(
            '**Heti tervezés.** Az öt lépés sorrendben. A lépés melletti szám a teendőket jelzi (például a nyitott dilemmák számát).',
            '**Egyéb.** A Figyelmeztetések gyűjtőoldala (számlálóval), a Beállítások és ez a Súgó.',
            '**Hétjelző.** A ‹ › nyilakkal bármelyik képernyőről válthatsz hetet; zárójelben látod, hogy ez a hét vagy a jövő hét. Minden hétnek saját terve van.',
            '**Fizetett idő.** A héten tervezett fizetett időd (repült idő, szimulátor és elmélet, briefing nélkül). Kattintásra tételes részletezést ad.',
            '**Tovább gomb.** Mindig a munkafolyamat következő lépésére visz.',
            '**Adatok frissessége.** Az oldalsáv alján mutatja, milyen régi a letöltött adat; az **Adatok frissítése** gomb friss foglalásokat és előrejelzést kér. Frissítés közben megszakítható.',
          ),
          tip('Bemutató módban az oldalsáv tetején „bemutató” címke látszik – így mindig tudod, hogy nem éles adattal dolgozol.'),
          info('A súgót bármelyik képernyőről megnyithatod az oldalsáv **Súgó** gombjával vagy az [[F1]] billentyűvel; mindig az épp nyitott képernyőhöz tartozó részt mutatja.'),
        ],
      },
    ],
  },
  {
    number: 4,
    title: 'Indítópult',
    sections: [
      {
        id: 'indito',
        title: 'Az Indítópult kártyái',
        open: { screen: 'dashboard' },
        blocks: [
          p(
            'Ez a nyitóképernyő: egy pillantással látod, friss-e az adat, hol tart a heti tervezés, milyen idő várható, és mennyit repülhetnek még a gépek.',
          ),
          list(
            '**Adatok.** A forrás (élő vagy bemutató), az utolsó frissítés ideje, valamint a betöltött erőforrások, foglalások és előrejelzett órák száma. Ha a frissítés közben hiba történt, itt jelenik meg.',
            '**Tervezés állapota.** Négy szám: igények, javaslatok, nyitott dilemmák, foglalatlanul maradt igények. Alatta egyetlen fő gomb mindig a soron következő teendőre visz: igények felvétele → dilemmák eldöntése → tervezet átnézése → rögzítési lista.',
            '**Hét közbeni figyelés.** A már megtervezett héten ez a kártya foglalja össze, ha a friss adatok alapján változtatás javasolt (lásd [Hét közben](#het-kozben)).',
            '**Változott a gépek vagy termek listája** – ha a FlightLoggerben új erőforrás jelent meg vagy egy eltűnt; a **Tudomásul vettem** gombbal nyugtázod.',
            '**Új erőforrás** – besorolásra váró gép; a **Besorolás** gomb a Beállítások → Gépek fülre visz.',
            '**Mérőszámok a héten** – helyben, név nélkül gyűjtött számok: legtöbb dilemma, kézi mozgatások, változatlanul hagyott javaslatok, tervezési idő.',
            '**Régen repült növendékek** – akik a beállított küszöbnél régebben repültek.',
          ),
          p('Az időjárásról: [meteogram](#meteogram), [napi összesítés](#napi-osszesites), [modellsúlyok](#modellsulyok). A gépek óraszámáról: [kirepülhető idő](#kirepulheto-ido).'),
        ],
      },
      {
        id: 'meteogram',
        title: 'Időjárás-előrejelzés: a meteogram',
        open: { screen: 'dashboard' },
        blocks: [
          p('Több előrejelzési modell egymás mellett, óránként.'),
          list(
            '**Források.** A címkékre kattintva egy-egy modell elrejthető. A „Tervezés” sor a modellek súlyozott együttese – a terv ebből számol.',
            '**Napi összkép.** A napok fölött: a nappali órákra hány forrás szerint jó, vegyes vagy rossz az idő (pl. „jó 6/8”).',
            '**Minősítés.** Óránként, forrásonként: repülhető, bizonytalan, nem repülhető az iskolai minimum szerint. A szürke sávok az éjszakát jelzik.',
            '**Korlátozó mennyiségek.** Szél, széllökés, oldalszél, felhőalap, látás, csapadék, hőmérséklet. A szaggatott piros vonal az iskolai minimum, a halvány piros sáv a minimumon kívüli tartomány.',
          ),
          p('Az egeret egy óra fölé víve az adott óra összes értéke látszik. A **Modellek frissítése** gomb újra letölti a modellenkénti előrejelzést.'),
          important('Ez tervezési segédlet. A repülés végrehajtásáról mindig az aktuális METAR/TAF és a saját felkészülésed alapján dönts.'),
        ],
      },
      {
        id: 'napi-osszesites',
        title: 'Napi összesítés: mennyire értenek egyet a modellek?',
        open: { screen: 'dashboard' },
        blocks: [
          p('A meteogram alatti **Napi összesítés táblázatban** sorra kattintva nyílik meg.'),
          list(
            '**Összkép.** Naponként: hány forrás szerint jó, vegyes vagy rossz a nappali időszak.',
            '**Modellsorok.** A sáv a nappali órák aránya (repülhető, bizonytalan, nem repülhető); alatta a legerősebb korlátozó érték, például a széllökés.',
            '**Részletek.** Egy napra kattintva alul modellenként látszik a hőmérséklet, szél/lökés, oldalszél, látás, felhőalap, csapadék és zivatar.',
          ),
          tip(
            'Ha egy napra „jó 2/3” áll, vagy nagy a szórás, az a nap bizonytalan – oda érdemes elméletet vagy szimulátort tartalékolni. A „nincs adat” azt jelenti, hogy a modell olyan messzire nem lát előre.',
          ),
        ],
      },
      {
        id: 'modellsulyok',
        title: 'Modellsúlyok a tervezésben (METAR-mérés)',
        open: { screen: 'dashboard' },
        blocks: [
          p(
            'A program a letöltött előrejelzéseket eltárolja, és az elmúlt órákat a bázisrepülőtér METAR-jával veti össze. Amelyik modell pontosabb volt, nagyobb súlyt kap a tervezésben.',
          ),
          list(
            '**Felső táblázat.** A modellek súlya időtávonként (0–1 nap … 5+ nap).',
            '**Találati arány.** Az utolsó 7 nap METAR-jaihoz mérve: a tűrésen belüli órák aránya szélre, lökésre, látásra, plafonra, hőmérsékletre.',
            '**A mérés METAR-jai.** Óránként a mért érték és a modellek előrejelzése; pirossal a tűrésen kívüli érték.',
          ),
          p('Mérés nélkül induló súlyokkal számol: az első két napon a nagy felbontású modellek, távolabb az ECMWF kap többet.'),
        ],
      },
      {
        id: 'kirepulheto-ido',
        title: 'Kirepülhető idő és a karbantartási táblázat fotója',
        open: { screen: 'dashboard' },
        blocks: [
          p(
            'A **Kirepülhető idő ma** kártyán gépenként megadod, hány óra van még a következő karbantartásig (**Mai érték (óra a karbantartásig)**). A program ebből, a héten már meglévő foglalásokból és a [Beállítások → Gépek](#b-gepek) fülön megadott túlrepülhető időből számolja, meddig foglalható a gép – így marad tartalék a karbantartás előtt.',
          ),
          h('Beolvasás fotóról'),
          steps(
            'Kattints az Indítópult jobb felső sarkában a **Karbantartási táblázat beolvasása fotóról** gombra, vagy húzd a karbantartási táblázat fotóját a kártyára (vágólapról be is illesztheted).',
            'A program néhány másodperc alatt felismeri a táblázatot, és a lajstromokat a flottádhoz illeszti.',
            'Nézd át a felismert értékeket – a bizonytalan sorokat kiemeli –, javíts, ha kell, majd mentsd.',
          ),
          info(
            'A szövegfelismerés helyben fut, a programmal szállított nyelvi modellel. A fotó nem hagyja el a gépet, és nem kerül mentésre – csak a beolvasott óraszámok.',
          ),
          important(
            'Mentés előtt mindig vesd össze a felismert számokat a fotóval; a program ezt minden beolvasásnál külön kéri. Ha a táblázaton lévő dátum nem a mai, az értékek azzal a dátummal mentődnek, és a mai értéket a program továbbra is kéri.',
          ),
          p(
            'Ha minden repülőgépnél megvan a mai érték, a kártya ezt jelzi. A fotóbeolvasás csak az asztali programban érhető el; a böngészős bemutatóban a gomb nem aktív.',
          ),
        ],
      },
    ],
  },
  {
    number: 5,
    title: 'Heti tervezés öt lépésben',
    sections: [
      {
        id: 'igenyek',
        title: '1. lépés – Heti igények',
        open: { screen: 'requests' },
        blocks: [
          list(
            '**Hét és fizetett idő.** Először ellenőrizd, hogy a jó hetet tervezed.',
            '**Összesítő csempék.** Heti repült idő, szimulátor, teljes oktatói idő, növendékek száma.',
            '**Növendékek.** Kattintásra a növendék felkerül a hétre a soron következő feladatával; a pipa jelzi, ki van már fent. A sárga ! figyelmeztetést jelez.',
            '**Igény sora.** Repülés vagy szimulátor, és a feladat: „Automatikus” a soron következő, de a listából bármelyik választható.',
            '**Idők és időpont.** Briefing / repülés / debriefing percben. Az időpont lehet Bármikor, Időablak vagy Fix; a napszak nappali vagy éjszakai; a feladat helyi vagy útvonal.',
            '**Közös briefing.** Az igény csapatba tehető azonos feladatú társsal (lásd [Közös briefing](#kozos-briefing)).',
            '**Elsőbbség.** 1-től 5-ig, az 1 a legfontosabb, ez az alapérték. A fontosabb igény előbb kap helyet, és a kevésbé fontos nem veheti el (lásd [Elsőbbség](#elsobbseg)).',
            '**+ Igény / Levétel.** Ugyanannak a növendéknek több igénye is lehet a héten: az automatikusak egymást követő feladatokat kapnak, és időben is ebben a sorrendben kerülnek a tervbe. A **Levétel** az összeset eltávolítja.',
          ),
          h('Gyors kezdés'),
          p(
            'Üres héten a **Mindenki felvétele** gomb az összes növendékedet egyszerre teszi fel, mindenkit a soron következő feladatával. Utána csak azt kell átírnod, ami eltér a szokásostól.',
          ),
          tip(
            'Az előző hétről halasztott igények maguktól megjelennek a listában, a FlightLoggerben már elkönyvelt feladatok pedig maguktól kikerülnek.',
          ),
        ],
      },
      {
        id: 'igenyek-reszletek',
        title: 'Heti igények – jelek és időpont',
        open: { screen: 'requests' },
        blocks: [
          table(
            ['Jel', 'Jelentés'],
            ['⟳ I./4.', 'Automatikusan választott feladat (a soron következő)'],
            ['☾', 'Éjszakai feladat'],
            ['⧉', 'Közös briefing csapat tagja'],
            ['kék / zöld sáv', 'Repülés / szimulátor'],
          ),
          h('Időpont megadása'),
          list(
            '**Bármikor** – a motor keresi meg a legjobb helyet.',
            '**Időablak** – megadott napokra/órákra szűkíted.',
            '**Fix** – pontos időpont; a motor ezeket helyezi el legelőször.',
          ),
          p('Útvonalrepülésnél (**Útvonal**) megadhatod az érintett repülőtereket ICAO-kóddal; a program azok előrejelzését is figyelembe veszi.'),
        ],
      },
      {
        id: 'elsobbseg',
        title: 'Elsőbbség: melyik igény kap előbb helyet',
        open: { screen: 'requests' },
        blocks: [
          p(
            'Minden igénynek van elsőbbsége 1-től 5-ig; az **1 a legfontosabb**, és alapból minden igény ilyen. A motor elsőbbségenként halad: előbb az összes 1-es igényt helyezi el, utána a 2-eseket, és így tovább. Azonos elsőbbségen belül a megszokott módon a súlyok döntenek.',
          ),
          list(
            '**Nem szorít ki.** Egy kevésbé fontos igény nem veheti el a fontosabb helyét, és a helyén sem változtat. Legfeljebb a motorpróba kerülhet át rá, ha ugyanazon a gépen korábban repül.',
            '**Nincs verseny köztük.** Különböző elsőbbségű igények között nem keletkezik „Melyik kapja a helyet?” dilemma: a fontosabb kapja. Cserét a „nincs hely” dilemma csak azonos vagy kevésbé fontos igény helyére ajánl.',
            '**Kivételek.** A fix időpont, a te döntéseid (dilemma-válasz, áthelyezés a tervezeten) és a FlightLoggerben már lévő foglalás elsőbbségtől függetlenül áll.',
            '**Közös briefing csapat.** A csapat a legfontosabb tagja elsőbbségével kerül sorra.',
            '**Feladatsorrend.** Ha egy növendéknek több automatikus feladatú igénye van a héten, a fontosabb igény kapja a korábbi feladatot, és a motor időben is sorban tartja őket: a későbbi feladat nem kerülhet a korábbi elé. A FlightLoggerben már lefoglalt feladat a helyén számít. A kézzel választott feladatra a sorrend nem vonatkozik.',
          ),
          tip(
            'A növendék **foglalási prioritása** (Beállítások → Növendékek) más: ott az 5 a legfontosabb, és csak súlyként hat azonos elsőbbségű igények között. Az elsőbbség szabály, nem súly.',
          ),
        ],
      },
      {
        id: 'van-meg-hely',
        title: 'Van még hely? – plusz igények',
        open: { screen: 'requests' },
        blocks: [
          p(
            'A **Van még hely?** gomb (Heti igények és Tervezet) megkeresi, melyik növendéked melyik feladata fér még be a héten a mostani terv mellett. Válassz növendéket, azon belül feladatot: alul rögtön látszik, hová kerülne, és mozdulna-e miatta más. A **Felvétel** rendes igényt vesz fel időpont nélkül, ugyanúgy, mintha a növendékre kattintottál volna; a motor helyezi el.',
          ),
          list(
            '**Mi számít helynek.** Csak tiszta hely: kizáró feltétel és jóváhagyást kérő figyelmeztetés nélkül, legalább 2 óra múlva, repülésnél nem repülhetetlen időben. A növendéki és az oktatói limitek a szokásos módon számítanak.',
            '**Nem szorít ki.** A plusz igény a beállított kitöltő elsőbbséggel (alapból 3) kerül be, így a kézzel felvett igényeidet nem mozdíthatja. Amit csak dilemmával vagy más igény kiszorításával lehetne felvenni, azt nem ajánlja.',
            '**Sorrend.** Elöl, aki régebben repült, aztán a magasabb foglalási prioritású; a megadott ráérés nélküliek a végén, jelölve.',
            '**Feladatok.** Elöl az automatikus következő feladat, utána néhány kézzel választható, végül a „feladat nélkül”. A növendék más igénye által tartott, a FlightLoggerben lefoglalt és a teljesített feladat nem szerepel.',
            '**Halasztott igény.** Akinek halasztott igénye van, annál új igény helyett a visszahozása szerepel; ilyenkor csak a halasztás szűnik meg.',
            '**Nyitott dilemmák.** Ha van eldöntetlen dilemma, a gomb előbb oda küld: hogy hol van még hely, a döntéseiden múlik.',
            '**Visszavonás.** A felvétel után a lista újraszámol, és a felvétel visszavonható.',
            '**Hét közbeni figyelés.** A figyelés a következő 2 napra magától is keres helyet, a visszahozható halasztott igényeket már visszahozottnak véve. Ha talál, egyetlen összefoglaló jelzés szól a rögzítési lista tetején és az indítópulton. A **Megnézem** ugyanezt az ablakot nyitja a 2 napra szűkítve, a **Most nem** aznapra elhallgattatja. A megadott ráérés nélküli növendék a jelzésben nem szerepel, mert a motor szabadnak veszi, így mindig „beférne”.',
          ),
        ],
      },
      {
        id: 'kozos-briefing',
        title: 'Közös briefing szervezése',
        open: { screen: 'requests' },
        blocks: [
          p(
            'A **Közös briefing szervezése** gomb feladatonként csoportosítja azokat, akiknek a héten ugyanaz a feladatuk. Húzd a növendékeket egy csapatba (vagy válassz a név melletti ▾ listából). A csapat egyszerre kezd, közös briefinget kap, egymás után repül (azonos gépen párban), a végén közös a debriefing. Feladatonként több csapat is lehet; akit nem teszel csapatba, egyénileg repül.',
          ),
          list(
            '**Feladat.** Csak azok a feladatok jelennek meg, amelyek a héten legalább két növendéknél szerepelnek.',
            '**Csapat.** A tagok egy sorban; a csapat alatt a tervezett közös kezdés látszik, amint a motor elhelyezte.',
            '**Új csapat.** Húzz ide egy növendéket egy további csapat indításához.',
            '**Egyénileg.** Akik nincsenek csapatban. A név melletti ▾ listából is áttehetők.',
          ),
          p('A **Kész** gomb bezárja az ablakot; a terv azonnal újraszámolódik.'),
          important(
            'Ha a csapat egyben nem fér be a hétre, a program dilemmát mutat: figyelmeztetéssel együtt, ezen a héten egyénileg, vagy halasztás mindenkinek.',
          ),
        ],
      },
      {
        id: 'elmeletek',
        title: '2. lépés – Elméletek',
        open: { screen: 'theories' },
        blocks: [
          steps(
            '**+ Elmélet** – új elméleti óra felvétele.',
            'Résztvevők: a saját növendékeid egy kattintással (**mind** gombbal egyszerre), vagy válassz egy osztályt, és **+ Osztály tagjai**. Névre is kereshetsz.',
            'Hossz (perc) és időpont: Bármikor, Időablak vagy Fix.',
            'Preferált terem: a listában a férőhely is látszik.',
          ),
          p('Az „(ideiglenes)” jelzés olyan résztvevőt mutat, aki nem a saját növendéked (például osztálytag).'),
          p(
            '**Hová kerül az elmélet?** Fix időpont vagy időablak nélkül a motor az elméletet a hét repülésre rossz idejű óráira teszi, akkora terembe, amelybe a résztvevők éppen beférnek – a nagyobb termek és a jó idejű órák szabadon maradnak.',
          ),
          tip('Ha a héten nincs elméleted, ezt a lépést egyszerűen ugord át a **Tovább: dilemmák →** gombbal.'),
        ],
      },
      {
        id: 'dilemmak',
        title: '3. lépés – Dilemmák',
        open: { screen: 'dilemmas' },
        blocks: [
          p('Egyszerre egy döntés. Minden döntés után a terv újraszámolódik, ezért a hátralévő dilemmák változhatnak.'),
          list(
            '**Nyitott dilemmák.** A legnagyobb hatásúak vannak elöl, az összefüggők egymás után. A címke a fajtát mutatja.',
            '**Lehetőségek.** Mindegyiknél zöld és piros címkék mutatják, miben jobb vagy rosszabb. Az ajánlott lehetőség kerete kék („ajánlott · Enter”). Kattintással vagy az [[1]]–[[9]] billentyűvel választasz.',
            '**Időpont választása a térképen.** Ha egyik felkínált lehetőség sem tetszik: a „Legjobb helyek” gombjai és a heti térkép celláira kattintva saját időpontot választhatsz, gépenként szűrve.',
            '**Döntések.** A meghozott döntések listája; bármelyik visszavonással újranyitható.',
            '**A többit döntse el a rendszer.** A maradék dilemmáknál elfogadja az ajánlott lehetőséget.',
          ),
          tip('Billentyűzettel a leggyorsabb: [[Enter]] az ajánlott lehetőség, [[1]]–[[9]] egy adott lehetőség, [[H]] halasztás, [[↑]] [[↓]] másik dilemma.'),
          tip('Ha túl sok a dilemma, a [Beállítások → Tervezés](#b-tervezes) fülön a dilemma-küszöb csökkentésével a program több szoros helyzetet dönt el maga.'),
        ],
      },
      {
        id: 'dilemma-fajtak',
        title: 'Dilemmák – fajták, halasztás, térkép',
        open: { screen: 'dilemmas' },
        blocks: [
          table(
            ['Fajta', 'Mit kérdez?'],
            ['Verseny', 'Két igény ugyanarra a helyre pályázik, és a pontkülönbség kicsi. Melyik kapja? A másik a következő legjobb helyre kerül.'],
            ['Csak figyelmeztetéssel', 'Az igény a héten csak szabály megsértésével vagy ütközéssel fér be (pl. limit-túllépés). Vállalod, vagy halasztod a következő hétre?'],
            ['Nincs hely', 'Az igénynek a héten nem maradt elfogadható hely: kézzel választasz időpontot a térképen, vagy halasztod.'],
          ),
          h('Halasztás és megjegyzés'),
          p(
            'A dilemma alján a **Halasztás** gomb (vagy a [[H]] billentyű) az igényt a következő hét igénylistájára teszi. A „megjegyzés a döntéshez” mezőbe rövid indoklást írhatsz magadnak.',
          ),
          h('A térkép színei'),
          list(
            'szabad – minél erősebb a szín, annál jobb a hely,',
            'figyelmeztetéssel,',
            'csak munkaidőn kívül,',
            'szabályt sért vagy ütközik,',
            'szürkület, illetve éjszaka.',
          ),
          p(
            'Egy cellára kattintva alul megjelenik a kiválasztott hely: a repülés ideje, a teljes foglalás (briefinggel, debriefinggel), a pontszám, a kezdés és a gép. A **Foglalás ide** gomb véglegesíti; dupla kattintás a cellán azonnal foglal.',
          ),
        ],
      },
      {
        id: 'tervezet',
        title: '4. lépés – Tervezet (napi nézet)',
        open: { screen: 'draft' },
        blocks: [
          p('Idővonal erőforrásonként.'),
          list(
            '**Nézetváltó.** Heti áttekintés vagy egy-egy nap; a nap mellett a foglalások száma.',
            '**Oktató és időjárás sáv.** Felül a saját napod: a tervezett órák, és minden saját FlightLogger-foglalásod akkor is, ha nem a foglalástervezővel került fel (szaggatott keretű szürke blokk); alatta az időjárás óránként (zöld: repülhető, piros: nem).',
            '**Foglalás.** A blokk húzással mozgatható időben és hasonló erőforrások között; a motor azonnal újraellenőriz. Kijelölve a [[←]] [[→]] 15 perccel, a [[↑]] [[↓]] másik gépre viszi. A szürke blokkok meglévő FlightLogger-foglalások.',
            '**Miért ide?** A kijelölt foglalás indoklása: szempontonként a súly és a részpont (1.00 a legjobb).',
            '**Komment.** A FlightLogger-foglalás megjegyzésébe szánt szöveg. A növendék is látja – mást ne nevezz meg benne.',
            '**Műveletek.** **Áthelyezés…** (bármelyik napra, térképről), **Vissza a javaslatra**, **Halasztás**.',
            '**Terv elfogadása.** Ha rendben van, fogadd el; a figyelmeztetések száma mellette látszik.',
          ),
        ],
      },
      {
        id: 'tervezet-elfogadas',
        title: 'Tervezet – heti áttekintés és elfogadás',
        open: { screen: 'draft' },
        blocks: [
          p('Heti áttekintés: az oktató napjai egymás alatt. Kék: repülés, zöld: szimulátor, lila: elmélet, ⧉: közös briefing csapat.'),
          h('Jelmagyarázat'),
          list(
            'Szürke blokk: FlightLogger-foglalás (már létezik).',
            'Zöld keret: a terv igénye már megvan a FlightLoggerben.',
            'Szaggatott kék keret: dilemma ajánlása (még nem döntöttél).',
            'Piros keret, illetve „!!”: általad jóváhagyott figyelmeztetés; „!”: enyhe figyelmeztetés.',
            'A halvány és sötétebb szürke háttér a polgári szürkületet és az éjszakát jelzi.',
          ),
          p('A heti nézetben kattintással kijelölsz; másik napra az **Áthelyezés…** gombbal teheted át a foglalást.'),
          h('Elfogadás'),
          p(
            'A **Terv elfogadása** gomb rögzíti az elfogadás idejét. Ha utána még változtatsz, a gombbal újra elfogadhatod („újra elfogadom”). Az elfogadás nem zárja le a tervet – a hét közbeni figyelés ehhez az állapothoz viszonyít.',
          ),
          important(
            'Kézi mozgatásnál a program nem akadályoz meg semmit, de azonnal jelzi, ha az új hely szabályt sért vagy ütközik. A jóváhagyott figyelmeztetések a [Figyelmeztetések](#figyelmeztetesek) oldalon is megjelennek.',
          ),
        ],
      },
      {
        id: 'rogzites',
        title: '5. lépés – Rögzítési lista',
        open: { screen: 'recording' },
        blocks: [
          p('Átvitel a FlightLoggerbe.'),
          list(
            '**Oktató.** Minden foglalásnál ugyanaz; egy kattintással vágólapra másolható.',
            '**Haladás.** Hány tételt rögzítettél már a hétből.',
            '**Rögzített tétel.** Összecsukva, „✓ rögzítve” jelzéssel; a **Visszavonás** újranyitja.',
            '**Rögzítettnek jelölöm.** Miután felvitted a foglalást a FlightLoggerbe, ezzel jelzed. A terv ezt a helyet ezután megtartja, újratervezéskor nem mozdítja.',
            '**Másolható mezők.** A FlightLogger űrlapjának sorrendjében: növendék, program, foglalástípus, feladat, kezdés, repülés kezdete és vége, vége, gép vagy terem. A mező melletti ikon vágólapra másolja az értéket.',
          ),
          p('A közös briefing csapat egy többnövendékes foglalásként jelenik meg, a tagok adataival.'),
          h('FlightLogger-import'),
          p(
            'A **FlightLoggerbe** (tételenként) és a **Mind a FlightLoggerbe** gomb importcsomagot másol: a FlightLogger foglalási oldalán az Import panelbe illesztve a szkript egyenként kitölti a FlightLogger saját ablakát, a mentést te nyomod meg. Mentés után ide visszatérve a tételek magától rögzítettek lesznek; a **Visszaigazolás beolvasása** gomb ugyanezt kézzel kéri. A telepítés leírása: Beállítások → FlightLogger-import.',
          ),
          important('A „figyelmeztetés” címkés tételt a FlightLogger elutasíthatja, ha az iskola tiltja a figyelmeztetéses foglalást.'),
        ],
      },
    ],
  },
  {
    number: 6,
    title: 'Hét közben',
    sections: [
      {
        id: 'het-kozben',
        title: 'Frissítés és figyelés',
        open: { screen: 'recording' },
        blocks: [
          p(
            'A terv a kézi rögzítésig – és utána is – elavulhat: más oktatók lefoglalhatják ugyanazt a gépet, változik az előrejelzés, elmarad egy repülés. A program ezt figyeli, de magától semmit nem módosít.',
          ),
          steps(
            'Kattints az **Adatok frissítése** gombra (az oldalsáv alján), vagy indítsd újra a programot – induláskor a legutóbbi adat azonnal látszik, a friss a háttérben töltődik.',
            'A program a friss foglalásokkal és előrejelzéssel újraértékeli a tervet, a FlightLoggerben lévő és a halasztott igényeket.',
            'Ha változtatás indokolt, az Indítópult **Hét közbeni figyelés** kártyája összefoglalja, a részletes javaslatok pedig a Rögzítési lista tetején jelennek meg – a régi és az új hely egymás mellett, a változó rész kiemelve.',
            'Amit elfogadsz, azt te viszed át a FlightLoggerbe, majd jelölöd elvégzettnek.',
          ),
          info('A program a lehető legkevesebb módosítással javasol: egyszerre egy foglalás egy változtatását, nem a teljes hét átrendezését.'),
        ],
      },
      {
        id: 'egyeztetes',
        title: 'Egyeztetés a FlightLoggerrel',
        blocks: [
          p(
            'A rögzítettnek jelölt tételeket a program frissítéskor megkeresi a FlightLoggerben. Ha megtalálja, a tervezeten és a listán „✓ a FlightLoggerben” jelzést kap. Felismeri azt is, ha a foglalást a FlightLoggerben más időpontra tetted, és azt is, ami a FlightLoggerben már megvan, de nem jelölted rögzítettnek – azt nem tervezi újra.',
          ),
          p('Eltérésként jelzi, ha egy rögzítettnek jelölt foglalást a friss adatban nem talál, vagy ha egy halasztott igény a FlightLoggerben még foglalva van.'),
        ],
      },
      {
        id: 'ujratervezes',
        title: 'Újratervezés és halasztás',
        blocks: [
          list(
            'Bármikor visszaléphetsz az igényekhez vagy a dilemmákhoz; a már rögzített foglalások a helyükön maradnak.',
            'A halasztott igény a következő hét listájára kerül. Ha ott már döntöttél róla vagy rögzítetted, a halasztás itt már nem vonható vissza (különben két hétre is bekerülne).',
            'A hétjelzővel a jövő hetet előre is tervezheted; a program a nyitott hét mellett a másikat is figyeli a háttérben.',
          ),
        ],
      },
    ],
  },
  {
    number: 7,
    title: 'Figyelmeztetések',
    sections: [
      {
        id: 'figyelmeztetesek',
        title: 'Minden jelzés egy helyen',
        open: { screen: 'warnings' },
        blocks: [
          p('Az oldalsáv **Figyelmeztetések** sora melletti szám mutatja, hány jelzés van. Csoportok:'),
          list(
            '**Limit-túllépés és jóváhagyott figyelmeztetés** – amit dilemmánál vagy kézi mozgatásnál vállaltál.',
            '**Limit-közelítés** – egy szabály a beállított százalék (alapból 80%) fölött jár.',
            '**Zivatarveszély** az előrejelzésben.',
            '**Hiányzó adat** – például nincs megadva ráérés: a motor ilyenkor szabadnak veszi a növendéket.',
            '**Általános** – például régen repült növendék, akinek a héten nincs repülése.',
          ),
          p('A **Tervezet megnyitása** gomb az érintett foglalásokhoz visz.'),
          important('Ez az oldal nem helyettesíti a FlightLogger saját figyelmeztetéseit.'),
        ],
      },
    ],
  },
  {
    number: 8,
    title: 'Beállítások',
    sections: [
      {
        id: 'beallitasok',
        title: 'A tíz fül áttekintése',
        open: { screen: 'settings' },
        blocks: [
          p(
            'Tíz fül, egy közös elv: a módosítás mentés után azonnal hat, a terv újraszámolódik. Ha a növendékek, a repülőtér vagy az adatforrás változik, az adatok is újratöltődnek.',
          ),
          table(
            ['Fül', 'Mire való?'],
            ['[Növendékek](#b-novendekek)', 'Saját növendékek, engedélyezett/preferált gépek, feladatsor-revízió, prioritás, fázis, egyéni minimum'],
            ['[Gépek](#b-gepek)', 'Sorrend, besorolás, motorpróba, fordulóidő, puffer, karbantartási szabályok'],
            ['[Termek](#beallitas-termek)', 'Férőhely és preferencia (1 = legjobb)'],
            ['[Munkaidő](#b-munkaido)', 'Heti munkaidő-ablak, ismétlődő és eseti tiltott időszakok'],
            ['[Limitek](#b-limitek)', 'Növendéki és oktatói repülési, szolgálati, pihenőidő-szabályok'],
            ['[Időjárás](#b-idojaras)', 'Iskolai időjárási minimum'],
            ['[Repülőtér](#beallitas-repuloter)', 'ICAO-kód, koordináta, pályák, nyitvatartás'],
            ['[Tervezés](#b-tervezes)', 'Dilemma-küszöb, alapidők, feladatválasztás módja'],
            ['[Súlyok](#b-sulyok)', 'A rangsorolási szempontok fontossága'],
            ['[Adatforrás](#b-adatforras)', 'Élő/bemutató váltás, gyorsítótár, alaphelyzet'],
            ['[Frissítés](#b-frissites)', 'Verzió, automatikus frissítés, kézi ellenőrzés'],
          ),
          h('Mentés'),
          p('Módosítás után a képernyő alján mentési sáv jelenik meg („Mentetlen módosítás”); a változtatás a mentéssel lép életbe.'),
          h('Importálás és exportálás'),
          p(
            'A jobb felső **Exportálás…** gomb fájlba menti a beállításokat (például másik gépre költözéshez vagy biztonsági másolatnak), az **Importálás…** visszatölti. Importálás után a program megmutatja, honnan jött az adat – nézd át, és csak utána mentsd.',
          ),
          important('Az API-kulcs nincs a beállítási fájlban, így az exportban sem: új gépen újra be kell írnod.'),
        ],
      },
      {
        id: 'b-novendekek',
        title: 'Beállítások → Növendékek',
        open: { screen: 'settings', settingsTab: 'Növendékek' },
        blocks: [
          list(
            '**Feladatsorok.** A betöltött revíziók listája és a saját mappa megnyitása.',
            '**Gépek.** Lajstromra kattintva: nincs → ✓ engedélyezett → ★ preferált. A motor a preferált gépet előnyben részesíti, de nem kizárólagosan.',
            '**Feladatsor / revízió.** „Automatikus”, ha a program ismert; különben válaszd ki kézzel.',
            '**Sorrend, prioritás, küszöb.** A napon belüli preferált sorrend, az 1–5-ös foglalási prioritás és az egyéni „régen repült” küszöb.',
            '**Képzési fázis és időjárási minimum.** A fázis a napi blokkidő-limitet állítja; az időjárási minimumnál a Training Manual megfelelő sora választható (pl. egyedül repülésre szigorúbb).',
          ),
          h('Feladatsorok'),
          p(
            'A növendékek feladatsorai (program-revíziók) a programmal érkeznek. A **Saját feladatsor-mappa megnyitása** gombbal megnyíló mappába saját feladatsor-fájlokat is tehetsz.',
          ),
        ],
      },
      {
        id: 'b-gepek',
        title: 'Beállítások → Gépek',
        open: { screen: 'settings', settingsTab: 'Gépek' },
        blocks: [
          list(
            '**Gépenkénti sorok.** Sorrend, besorolás, motorpróba (perc), fordulóidő (perc), biztonsági puffer (óra). A sorrend átvehető a FlightLogger foglalási oldaláról is.',
            '**Motorpróba géptípusonként.** Üresen a globális alapérték érvényes; a gépnél megadott érték felülírja.',
            '**Karbantartás.** A globális biztonsági puffer, valamint karbantartás-fajtánként (25, 50, 100, 200 órás) a túlrepülhető idő és a karbantartás hossza.',
          ),
          p(
            '**Működés:** a program a [kirepülhető időhöz](#kirepulheto-ido) hozzáadja a megengedett túlrepülést. Amikor a foglalások alapján a keret (a pufferrel együtt) elfogy, a gép „karbantartásra megy”: addig foglal rá, utána a karbantartás hosszáig nem.',
          ),
          tip('A puffer negatív is lehet, ha tudatosan a keret végéig terveznél.'),
        ],
      },
      {
        id: 'b-munkaido',
        title: 'Beállítások → Munkaidő',
        open: { screen: 'settings', settingsTab: 'Munkaidő' },
        blocks: [
          list(
            '**Heti munkaidő-ablak.** Naponként kapcsolható, kezdettel és véggel. A motor csak a repülőtér nyitvatartása és a munkaidőd metszetébe tesz foglalást.',
            '**Tiltott időszakok.** Ismétlődő (több napra egyszerre, érvényességgel, megjegyzéssel) vagy eseti (naptól napig, egész nap vagy idősáv). A motor ide soha nem tesz foglalást; kézi mozgatásnál figyelmeztet. Az elmúlt időszakok maguktól törlődnek.',
          ),
          tip('Szabadság, vizsganap vagy más elfoglaltság előtt vegyél fel eseti tiltott időszakot – így a terv eleve kikerüli.'),
        ],
      },
      {
        id: 'b-idojaras',
        title: 'Beállítások → Időjárás',
        open: { screen: 'settings', settingsTab: 'Időjárás' },
        blocks: [
          p('Az iskolai időjárási minimum a „rossz idő” általános küszöbe: a következő 0–2 napra kizáró feltétel, távolabb pontlevonás.'),
          list(
            'Legnagyobb szél, széllökés és oldalszél (csomó)',
            'Legkisebb látástávolság (m) és felhőalap (láb)',
            'Legnagyobb alacsony felhőzet (%), csapadék (mm/óra) és csapadék-valószínűség (%)',
          ),
          p(
            'Alapértéke a Training Manual legenyhébb, valódi géppel végzett sora. A szigorúbb gyakorlatokhoz (például egyedül repülés) a növendéknél választható a megfelelő sor; a teljes táblázat a lap alján lenyitható.',
          ),
        ],
      },
      {
        id: 'b-tervezes',
        title: 'Beállítások → Tervezés',
        open: { screen: 'settings', settingsTab: 'Tervezés' },
        blocks: [
          list(
            '**Dilemma-küszöb.** Ekkora pontkülönbség alatt kérdez a program; nagyobb értéknél több a dilemma, kisebbnél több döntést hoz meg maga.',
            '**Feladatválasztás alapból.** Automatikus, kézi vagy feladat nélküli; igényenként felülírható.',
            '**Alapidők.** Motorpróba és körüljárás, briefing, debriefing, fordulóidő, csere közös briefing csapatban.',
            '**„Régen repült” küszöb** (nap) és a növendék **alap foglalási prioritása** (1–5, az 5 a legfontosabb; súly).',
            '**Igény elsőbbsége alapból** (1–5, az 1 a legfontosabb; alapból 1) és a **plusz igény elsőbbsége** (alapból 3), lásd [Elsőbbség](#elsobbseg).',
          ),
          p('A repülés ideje mindig a feladatból jön; a briefing és a debriefing itt megadott alapértéke igényenként átírható.'),
        ],
      },
      {
        id: 'b-limitek',
        title: 'Beállítások → Limitek',
        open: { screen: 'settings', settingsTab: 'Limitek' },
        blocks: [
          p('Repülési, szolgálati és pihenőidő.'),
          list(
            '**Be.** Szabályonként kapcsolható.',
            '**Határérték és jelzés.** A jelzés (%) azt adja meg, a határ hány százalékánál szóljon a program „limit-közelítés” figyelmeztetéssel.',
            '**Szimulátor is.** Beleszámítson-e a szimulátoron töltött idő.',
            '**Forrás.** Honnan származik a szabály (Training Manual, Operations Manual, minta).',
          ),
          p(
            'A túllépés nem tiltja a foglalást: dilemmaként jóváhagyást kér. A képernyő alján a program felsorolja a Training Manual azon előírásait is, amelyeket nem ellenőriz (pl. heti 36 óra pihenő, szolgálatmentes napok) – ezekre neked kell figyelned.',
          ),
          important('A múltbeli szolgálati időt a FlightLogger API nem adja vissza: a szolgálati időbe csak a betöltött foglalások számítanak.'),
        ],
      },
      {
        id: 'b-sulyok',
        title: 'Beállítások → Súlyok',
        open: { screen: 'settings', settingsTab: 'Súlyok' },
        blocks: [
          p(
            'A súlyok azt szabályozzák, hogyan rangsorol a motor az elfogadható helyek között. A kizáró feltételekre (ütközés, zárva tartás, tiltott időszak) soha nem hatnak.',
          ),
          list('0% – a szempont nem számít,', '100% – a legerősebb, de még mindig nem kizáró hatás.'),
          p(
            'A legfontosabb szempontok alapból: időjárás repülésnél, régen repült növendék, szűkösség (hány hely marad az igénynek), rossz idő illesztése (elmélet/szimulátor rossz időre), foglalási prioritás.',
          ),
          p('Az igény [elsőbbsége](#elsobbseg) nem súly: az dönti el, melyik igény kerül előbb sorra, a súlyok pedig azonos elsőbbségen belül rangsorolnak.'),
          tip('Egyszerre egy súlyt változtass, és nézd meg a tervezeten a „Miért ide?” panelt: ott szempontonként látod, hogyan áll össze a pontszám.'),
        ],
      },
      {
        id: 'b-adatforras',
        title: 'Beállítások → Adatforrás',
        open: { screen: 'settings', settingsTab: 'Adatforrás' },
        blocks: [
          list(
            '**Váltás.** Élő FlightLogger és bemutató mód között. Élő módhoz mentett API-kulcs kell.',
            '**Gyorsítótár.** A legutóbb letöltött heti adatok titkosítva a gépen maradnak, hogy indításkor azonnal legyen mit mutatni. Törlés után a következő frissítés mindent újra letölt.',
            '**Alaphelyzet.** Törli a beállítási fájlt, a mentett heti terveket és a gyorsítótárat, majd újraindítja az első beállítást. Választhatsz: a kulcs megtartásával, vagy teljes törlés az API-kulccsal együtt.',
          ),
          important('Az alaphelyzetbe állítás a mentett heti terveket is törli. Előtte érdemes a beállításokat exportálni.'),
        ],
      },
      {
        id: 'b-frissites',
        title: 'Beállítások → Frissítés',
        open: { screen: 'settings', settingsTab: 'Frissítés' },
        blocks: [
          p(
            'A program minden indításkor megnézi a GitHubon, van-e újabb kiadás. Ha nincs, simán megnyílik. Ha van, és be van kapcsolva az automatikus frissítés, letölti, ellenőrzi, telepíti, majd újraindul. Közben a **Kihagyás, indítás most** gombbal a mostani verzió azonnal elindul.',
          ),
          list(
            '**Automatikus frissítés.** Alapból be van kapcsolva. Kikapcsolva a program csak jelzi az új verziót a képernyő tetején, a telepítést te indítod (**Telepítés most**). A beállítás erre a gépre szól.',
            '**Frissítés keresése most.** Kézi ellenőrzés; magától nem telepít.',
            '**Csatorna.** A „Foglalástervező” a fő kiadásokat kapja. A „Foglalástervező DEV” a fejlesztői változat: a következő fő kiadás kipróbálására való, külön ikonnal, külön beállításokkal és külön API-kulccsal.',
          ),
          info(
            'A frissítéshez a program csak a saját GitHub-repójának kiadáslistáját és fájljait kéri le, személyes adat nélkül. Telepítés előtt a kiadás aláírását és a fájl lenyomatát is ellenőrzi; ha bármi nem egyezik, nem telepít.',
          ),
          tip('macOS-en a frissítés csak az Alkalmazások mappából indított programnál működik. Ha máshonnan indítod, a program felajánlja az áthelyezést.'),
        ],
      },
    ],
  },
  {
    number: 9,
    title: 'Adatvédelem és biztonság',
    sections: [
      {
        id: 'adatvedelem',
        title: 'Mi megy ki a gépről, és mi nem',
        blocks: [
          p(
            'A program úgy készült, hogy a növendékek adatai ne kerülhessenek harmadik félhez, és a FlightLoggerben semmi ne változhasson meg a tudtod nélkül.',
          ),
          table(
            ['Hová?', 'Mi megy ki?', 'Mire kell?'],
            ['FlightLogger (api.flightlogger.net)', 'Csak olvasó lekérdezések, a te API-kulcsoddal', 'Gépek, foglalások, növendékek, termek, haladás'],
            ['Open-Meteo (api.open-meteo.com)', 'Csak koordináta, időablak és a modell neve', 'Időjárás-előrejelzés'],
            ['aviationweather.gov', 'Csak a bázis ICAO-kódja és az időablak', 'METAR a modellek pontosságának méréséhez'],
            ['GitHub (api.github.com, github.com)', 'Semmi: csak a program saját kiadásainak listáját és fájljait kéri le', 'A program frissítése'],
          ),
          list(
            '**Csak olvasás.** A FlightLogger felé a program kizárólag előre rögzített, olvasó lekérdezéseket küldhet; írási művelet több, egymástól független ellenőrzésen akadna fenn. Minden foglalást te rögzítesz kézzel.',
            '**API-kulcs.** Mindig te írod be, és csak a rendszer titoktárolójában (macOS Kulcskarika, Windows DPAPI) tárolódik. Nem kerül beállítási fájlba, naplóba, hibaüzenetbe vagy exportba.',
            '**Helyi adatok.** A beállítások, a heti tervek és a titkosított gyorsítótár a saját gépeden vannak. A beállítási fájlban a növendékeknek csak az azonosítója szerepel, név nem. A felület maga nem ér el hálózatot.',
          ),
          info(
            'Név, e-mail-cím vagy foglalási komment az időjárás-szolgáltatókhoz soha nem jut el. A karbantartási táblázat fotója a gépeden marad, és a feldolgozás után nem kerül mentésre.',
          ),
        ],
      },
    ],
  },
  {
    number: 10,
    title: 'Gyors segédlet',
    sections: [
      {
        id: 'billentyuk',
        title: 'Billentyűk',
        blocks: [
          table(
            ['Hol?', 'Billentyű', 'Hatás'],
            ['Bárhol', '[[F1]]', 'A súgó megnyitása az épp nyitott képernyőhöz'],
            ['Súgó', '[[Esc]]', 'A súgó bezárása'],
            ['Dilemmák', '[[Enter]]', 'Az ajánlott lehetőség elfogadása'],
            ['Dilemmák', '[[1]]–[[9]]', 'A megfelelő számú lehetőség'],
            ['Dilemmák', '[[H]]', 'Halasztás a következő hétre'],
            ['Dilemmák', '[[↑]] [[↓]]', 'Másik dilemma'],
            ['Tervezet', '[[←]] [[→]]', 'A kijelölt foglalás 15 perccel korábbra/későbbre'],
            ['Tervezet', '[[↑]] [[↓]]', 'Másik hasonló erőforrásra (gép, terem)'],
          ),
        ],
      },
      {
        id: 'heti-rutin',
        title: 'Heti rutin ellenőrzőlista',
        blocks: [
          steps(
            'Adatok frissítése; a jó hét van kiválasztva?',
            '[Kirepülhető idők](#kirepulheto-ido) megadása (kézzel vagy a karbantartási táblázat fotójáról).',
            'Növendékek és feladatok felvétele, közös briefingek.',
            'Elméletek felvétele.',
            'Dilemmák eldöntése.',
            'Tervezet átnézése, igazítás, elfogadás.',
            'Rögzítés a FlightLoggerben, tételenként „rögzítettnek jelölöm”.',
            'Hét közben: frissítés, a javaslatok átnézése.',
          ),
        ],
      },
      {
        id: 'gyik',
        title: 'Gyakori kérdések',
        blocks: [
          h('„Nincs feladatsor: válassz revíziót” – mit tegyek?'),
          p('[Beállítások → Növendékek](#b-novendekek): a növendéknél válaszd ki a „Feladatsor / revízió” értékét.'),
          h('Miért került a repülés rossz idejű napra?'),
          p(
            'Kattints a foglalásra a tervezeten: a „Miért ide?” panel megmutatja a szempontokat. Két napnál távolabb az időjárás csak pontlevonás, nem kizáró ok; ha fontosabbnak tartod, emeld az „Időjárás repülésnél” [súlyt](#b-sulyok), vagy húzd át a foglalást.',
          ),
          h('Túl sok (vagy túl kevés) a dilemma.'),
          p(
            '[Beállítások → Tervezés](#b-tervezes): a dilemma-küszöb állítja, mekkora pontkülönbség alatt kérdez a program. A maradékot a **A többit döntse el a rendszer** gomb az ajánlások szerint lezárja.',
          ),
          h('Egy igény nem fért be a hétre.'),
          p('A Dilemmák képernyőn „Nincs hely” dilemmaként jelenik meg: válassz időpontot a térképen, vagy halaszd a következő hétre.'),
          h('Valaki közben lefoglalta a gépet.'),
          p('Adatok frissítése után a program jelzi az ütközést, és a Rögzítési lista tetején javasol új helyet.'),
          h('A növendéknél nincs megadva ráérés.'),
          p('A motor szabadnak veszi a hétre, és ezt a Figyelmeztetések oldalon jelzi.'),
          h('Hogyan adom meg gyorsan a gépek óraszámát?'),
          p('Az Indítópulton a **Karbantartási táblázat beolvasása fotóról** gombbal – részletek: [Kirepülhető idő](#kirepulheto-ido).'),
          h('Elölről kezdeném.'),
          p('[Beállítások → Adatforrás](#b-adatforras) → **Alaphelyzetbe állítás**.'),
        ],
      },
    ],
  },
]

/** Az egyes képernyőkhöz tartozó súgószakasz (F1 és az oldalsáv Súgó gombja ide nyit). */
export const SCREEN_HELP: Readonly<Record<HelpScreen, string>> = {
  dashboard: 'indito',
  requests: 'igenyek',
  theories: 'elmeletek',
  dilemmas: 'dilemmak',
  draft: 'tervezet',
  recording: 'rogzites',
  warnings: 'figyelmeztetesek',
  settings: 'beallitasok',
}

/** A Beállítások fülei → súgószakasz. */
export const SETTINGS_TAB_HELP: Readonly<Record<string, string>> = {
  Növendékek: 'b-novendekek',
  Gépek: 'b-gepek',
  Termek: 'beallitas-termek',
  Munkaidő: 'b-munkaido',
  Limitek: 'b-limitek',
  Időjárás: 'b-idojaras',
  Repülőtér: 'beallitas-repuloter',
  Tervezés: 'b-tervezes',
  Súlyok: 'b-sulyok',
  Adatforrás: 'b-adatforras',
  'FlightLogger-import': 'rogzites',
  Frissítés: 'b-frissites',
}

/** Az első beállítás lépései (0-tól) → súgószakasz. */
export const SETUP_STEP_HELP: readonly string[] = [
  'beallitas-adatforras',
  'beallitas-repuloter',
  'beallitas-limitek',
  'beallitas-gepek',
  'beallitas-termek',
  'beallitas-novendekek',
  'beallitas-munkaido',
]
