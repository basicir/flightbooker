# Kiadás és frissítés

Állapot (2026-11-25): **elkészült.** A követelmények (FRS-01–FRS-10) a koncepciódokumentum 5.11
részében vannak (`docs/koncepcio.md`); a Claude Docs-beli koncepcióba még át kell vezetni.

## Röviden

| | Foglalástervező | Foglalástervező DEV |
| --- | --- | --- |
| Ág | `main` | `dev` |
| Verzió | `0.1.4` | `0.1.5-dev.12` |
| Címke | `v0.1.4` (kiadás, „Latest”) | `v0.1.5-dev.12` (előzetes kiadás) |
| Azonosító | `local.flightbooker.planner` | `local.flightbooker.planner.dev` |
| Adatmappa | `…/Foglalástervező` | `…/Foglalástervező DEV` |
| Ikon | `build/icon.png` | `build/icon-dev.png` (narancs, „DEV”) |
| Platform | macOS (Apple Silicon, Intel), Windows | csak macOS |
| Ki kapja | minden felhasználó | a fejlesztő |

A két program egymás mellett fut, külön beállításokkal és külön API-kulccsal: egy kísérleti
DEV-verzió nem rontja el a fő verzió adatait.

## A fejlesztő munkamenete

1. Minden feladat végén a változás a `dev` ágra kerül (`git push origin dev`; a szabály a CLAUDE.md
   „Munkamenet” részében). A GitHub Actions („Kiadás”) lefuttatja a típusellenőrzést, a lintet és a
   teszteket, megépíti a macOS-csomagot (Apple Silicon és Intel; a DEV-hez Windows-csomag nem készül), és
   közzéteszi a fejlesztői kiadást. Kb. 5 perc.
2. A **Foglalástervező DEV** a következő indításkor frissül rá.
3. Ha megfelel: a DEV-ben **Beállítások → Frissítés → Kiadás: dev → main**. A gomb pontosan a futó
   DEV-verzió commitját adja ki: a `main`-t arra pörgeti (csak előre, összefésülés nélkül), és fő kiadást
   készít (macOS és Windows). Ugyanez a GitHubon is indítható (**Actions → Kiadás: dev → main → Run
   workflow**, ilyenkor a `dev` ág vége megy ki), és egy dev → main pull request összefésülése is fő
   kiadást indít. Ha a `dev` a `.github/workflows` fájljait is módosítja, a gomb nem küldheti (a
   GitHub-token korlátja), ilyenkor a pull request kell.
4. Minden **Foglalástervező** a következő indításkor frissül.

Csak dokumentációt érintő push (`docs/**`, `*.md`) nem indít kiadást.

**Verziók.** Kézi léptetés nincs. A fő kiadás a legutóbbi fő kiadás javítószáma +1 (az alsó határ
a `package.json` verziója – fő- vagy alverzió-váltáshoz azt kell átírni, pl. `0.2.0`-ra). A
fejlesztői kiadás a következő fő verzió `-dev.N` utótaggal; N folyamatosan nő
(`tools/release/versioning.ts`).

## Hogyan frissül a program

`src/main/update/` (vezérlés: `updaterCore.ts`, Electron nélkül tesztelve).

1. Indításkor a felület (`UpdateGate`) vár, a főfolyamat lekéri a saját repó kiadáslistáját
   (`api.github.com/repos/<repo>/releases`), és kiválasztja a csatorna legújabb, a futónál újabb
   kiadását (`src/core/update/releases.ts`). Hiba, hálózat hiánya vagy 10 másodperc után a program
   a mostani verzióval indul; a „Kihagyás” gomb ugyanezt teszi.
2. Letölti a kiadás `update-manifest.json` leírását, és ellenőrzi az Ed25519-aláírást a beépített
   nyilvános kulccsal (`src/main/update/update-public-keys.json`), valamint a csatornát és a verziót.
3. Automatikus frissítésnél letölti a géphez illő fájlt, ellenőrzi a méretét és a SHA-512
   lenyomatát, majd telepít (`install.ts`):
   - **macOS:** a zipet `ditto`-val kibontja, a régi `.app`-ot félreteszi, az újat a helyére teszi,
     hiba esetén visszaállít, majd a program kilépése után az újat indítja. Csak az Alkalmazások
     mappából indított programnál; máshonnan indítva a program felajánlja az áthelyezést.
   - **Windows:** az NSIS-telepítőt `--updated /S --force-run` kapcsolókkal indítja, és kilép.
4. Kikapcsolt automatikus frissítésnél csak sáv jelzi az új verziót („Telepítés most”).

Minden hálózati kérés az `allowedFetch`-en (ALP-02) megy: az `api.github.com` felé csak a
kiadáslista (GET, `per_page`), a `github.com` felé csak a saját repó kiadási fájljai, onnan
egyetlen átirányítás a GitHub fájltárhelyére (`release-assets.githubusercontent.com`,
`objects.githubusercontent.com`). Személyes adat nem megy ki; a GitHub az IP-címet látja.

A gépenkénti beállítás (automatikus frissítés be/ki) a felhasználói adatmappa `frissites.json`
fájljában van, az exportba nem kerül.

## A DEV eszközei

Csak a Foglalástervező DEV-ben, a **Beállítások → Frissítés** fül alján (`src/main/dev/`,
`src/renderer/src/components/devTools.tsx`). A fő változatban a felület nem mutatja őket, és a
főfolyamat a hozzájuk tartozó hívásokat sem kezeli (FRS-09, FRS-10).

- **Beállítások átvétele a Foglalástervezőből.** A fő változat beállítása (a növendékekkel), mentett heti
  tervei, saját feladatsorai és a modellpontosság mérése átkerül a DEV-be; a DEV-é felülíródik, a fő
  változaté nem változik, a DEV gyorsítótára törlődik. Az API-kulcs ezzel nem jön át (lásd lent).
  - **Első indításkor magától:** ha a DEV-nek még nincs beállítása, és a fő változatnak van, induláskor
    (az ablak előtt) átjön, így a DEV nem az első beállítással indul; egy sáv jelzi, mi jött át, és
    hogy az API-kulcs még kell.
  - **Később gombbal:** Beállítások → Frissítés, illetve (ha az automatikus átvétel nem futhatott) az
    első beállítás első lépésén. Utána a program újraindul.
- **API-kulcs átvétele a Foglalástervezőből** (FRS-11, csak macOS). A DEV-sávban (amíg a DEV-ben nincs
  kulcs) és a Beállítások → Adatforrás fülön. A fő változat a kulcsot a safeStorage-dzsal titkosította
  (a Chromium macOS-es „v10” formátuma, a jelszó a Kulcskarika „Foglalástervező Safe Storage” eleme). A
  gomb a `security find-generic-password` paranccsal kéri ezt a jelszót, ezért a macOS egy ablakban
  engedélyt kér: Mac-jelszó, „Engedélyezés” (a „Mindig engedélyez” nem kell). A DEV visszafejti a kulcsot,
  kipróbálja a FlightLoggernél, és a saját titoktárolójába menti; a kulcs csak a memóriában van.
  (`src/main/dev/stableApiKey.ts`; ha egy Electron-frissítés a formátumot megváltoztatja, a gomb hibát
  ad, és a kulcsot kézzel kell beírni.)
- **Kiadás: dev → main.** Első használatkor egy GitHub-token kell:
  1. GitHub → Settings → Developer settings → **Fine-grained tokens → Generate new token**
     (közvetlenül: `https://github.com/settings/personal-access-tokens/new`).
  2. Repository access: **Only select repositories → flightbooker**.
  3. Permissions → Repository permissions → **Actions: Read and write** (más nem kell).
  4. A tokent a DEV-ben a „GitHub-token” mezőbe kell másolni → **Mentés és próba**. A program
     kipróbálja, és a Kulcskarikába menti (külön fájl: `github-kiado-token.secret`, a DEV adatmappájában);
     a token csevegésbe, naplóba, fájlba nem kerül.

  A gomb megerősítés után indítja a `promote.yml`-t a futó csomag commitjával (a csomagba a kiadási
  folyamat írja: `buildCommit`), és 10 másodpercenként mutatja a futás állapotát, linkkel. A hálózati
  kérés külön, csak DEV-csatornán létrehozható belépési ponton megy (`createDevPromoteFetch`): csak a
  `promote.yml` indítása (törzs: a `dev` ág és egy 40 jegyű commit-azonosító) és a futásai engedettek.

## A kiadási folyamat

`.github/workflows/`:

- `release.yml` – push a `main`/`dev` ágra → `build-release.yml` a megfelelő csatornával.
- `promote.yml` – „Kiadás: dev → main”: a DEV gombja (a kipróbált commit, `commit` bemenet) vagy az
  Actions oldala (a `dev` ág vége) indítja; ha a `main` már tartalmazza, nem ad ki újra.
- `build-release.yml` – közös: ellenőrzés és verzió (`tools/release/next-version.ts`, egyben
  ellenőrzi, hogy a programba épített repónév egyezik a GitHub-repóval, és kiadja a csatorna
  csomagolási mátrixát a `tools/release/channels.ts` `RELEASE_TARGETS`-éből) → csomagolás
  (`tools/release/package.ts`, párhuzamosan; fő kiadás: macOS arm64, x64 és Windows, DEV: macOS arm64
  és x64) → aláírt leírás
  (`tools/release/manifest.ts`) → vázlatként feltöltött, a végén közzétett GitHub-kiadás → a
  10-nél régebbi fejlesztői kiadások törlése.
- `ci.yml` – pull requestnél csak ellenőrzés.

Csatornánként egyszerre egy kiadás fut; a várakozók közül csak a legújabb indul el.

## Az aláírókulcs

- A titkos kulcs (Ed25519) a GitHub-repó `UPDATE_SIGNING_KEY` titkában van; a kiadási folyamat
  csak a leírás aláírásához használja, és aláírás után a beépített nyilvános kulccsal vissza is
  ellenőrzi (ha a kettő nem pár, nincs kiadás).
- Biztonsági másolat a fejlesztő gépén: `~/.config/flightbooker/frissites-alairo-kulcs.pem`
  (csak a tulajdonos olvashatja). Érdemes jelszókezelőbe tenni, és onnan törölni a fájlt.
- Ha a titkos kulcs elveszik, új kulcspár kell; a régi programok az új kulccsal aláírt kiadást nem
  fogadják el, ezért náluk egyszer kézzel kell telepíteni. Kulcscserénél a régi és az új nyilvános
  kulcs egy átmeneti kiadásban együtt is szerepelhet a `update-public-keys.json`-ban.
- Csomagolás helyben, kipróbáláshoz: `npm run build && npx tsx tools/release/package.ts --channel dev --platform mac --arch arm64 --version 0.0.0-dev.0`.
  A legalacsonyabb verzió miatt a próbapéldány a következő kiadásra frissül. A kész próbacsomagot
  ne hagyd a `release/` mappában: a macOS azonosító szerinti indításnál (`open -b`) a nagyobb
  verziójú példányt választja, akárhol van.

## Ismert korlátok

- **Apple-tanúsítvány nélkül** (évi 99 USD) a macOS az első indításnál nem engedi megnyitni a
  programot: Rendszerbeállítások → Adatvédelem és biztonság → „Megnyitás mindenképp”. Windowson a
  SmartScreen: „További információ → Futtatás mindenképp”. A program saját frissítései ezt már nem
  kérik (a program által letöltött fájl nem kap karantén-jelölést).
- macOS-en frissítés után a **Kulcskarika** egyszer jelszót kérhet az API-kulcs titkosítókulcsához
  („Mindig engedélyez”), mert az ad-hoc aláírású program minden verziója más azonosítójú.
- Tanúsítvánnyal mindkettő megszűnik, és a csomagolásba aláírás és hitelesítés kerülne; ez külön
  döntés.
- A régi, frissítő nélküli példányokat egyszer kézzel kell lecserélni az első kiadásra. A korábbi
  „asszisztált” Windows-telepítővel a „Program Files” alá telepített példányt érdemes eltávolítani.
