# Kiadás és frissítés

Állapot (2026-11-24): **elkészült.** A követelmények (FRS-01–FRS-08) a koncepciódokumentum 5.11
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
| Ki kapja | minden felhasználó | a fejlesztő |

A két program egymás mellett fut, külön beállításokkal és külön API-kulccsal: egy kísérleti
DEV-verzió nem rontja el a fő verzió adatait.

## A fejlesztő munkamenete

1. A változás a `dev` ágra kerül (`git push origin dev`). A GitHub Actions („Kiadás”) lefuttatja a
   típusellenőrzést, a lintet és a teszteket, megépíti a macOS- (Apple Silicon és Intel) és a
   Windows-csomagot, és közzéteszi a fejlesztői kiadást. Kb. 10–15 perc.
2. A **Foglalástervező DEV** a következő indításkor frissül rá.
3. Ha megfelel: GitHub → **Actions** → **Kiadás: dev → main** → **Run workflow**. Ez a `main`-t a
   `dev`-re pörgeti (csak előre, összefésülés nélkül), és fő kiadást készít. Ugyanezt egy
   dev → main pull request összefésülése is elindítja. Ha a `dev` a `.github/workflows` fájljait is
   módosítja, a gomb nem küldheti (a GitHub-token korlátja), ilyenkor a pull request kell.
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

## A kiadási folyamat

`.github/workflows/`:

- `release.yml` – push a `main`/`dev` ágra → `build-release.yml` a megfelelő csatornával.
- `promote.yml` – „Kiadás: dev → main” gomb.
- `build-release.yml` – közös: ellenőrzés és verzió (`tools/release/next-version.ts`, egyben
  ellenőrzi, hogy a programba épített repónév egyezik a GitHub-repóval) → csomagolás
  (`tools/release/package.ts`, három gépen párhuzamosan) → aláírt leírás
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
