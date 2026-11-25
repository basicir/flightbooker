# Foglalástervező

Helyben futó asztali program (macOS, Windows), amely a FlightLogger adataiból és az Open-Meteo
előrejelzéséből heti foglalási tervezetet készít egy repülőoktatónak. A FlightLoggert csak olvassa:
a foglalásokat mindig az oktató rögzíti.

## Telepítés

A telepítők a [Releases](../../releases) oldalon vannak. A **Latest** jelölésű kiadás a fő
változat; a „Pre-release” jelölésűek a fejlesztői (DEV) változathoz tartoznak (csak Apple Silicon Mac, zip).

**macOS**

1. Töltsd le a `Foglalastervezo-…-mac-arm64.dmg` (Apple Silicon: M1 és újabb) vagy a
   `…-mac-x64.dmg` (Intel) fájlt.
2. Nyisd meg, és húzd a programot az **Alkalmazások** mappába.
3. Első indításkor a macOS jelzi, hogy nem tudja ellenőrizni a fejlesztőt (a program nincs Apple-
   tanúsítvánnyal aláírva). Nyisd meg a **Rendszerbeállítások → Adatvédelem és biztonság** oldalt,
   és kattints a **Megnyitás mindenképp** gombra. Ez csak egyszer kell.
4. A Dockban jobb kattintás → **Beállítások → Megtartás a Dockban**.

**Windows**

1. Töltsd le a `Foglalastervezo-…-win-x64-setup.exe` fájlt, és indítsd el.
2. Ha a SmartScreen figyelmeztet: **További információ → Futtatás mindenképp**.
3. A telepítő rendszergazdai jog nélkül telepít, és asztali, valamint Start menü parancsikont készít.

## Frissítés

A program minden indításkor megnézi, van-e újabb kiadás. Ha van, letölti, ellenőrzi az aláírását,
telepíti és újraindul; ha nincs, simán megnyílik. Az automatikus frissítés a **Beállítások →
Frissítés** fülön kapcsolható ki (alapból be van kapcsolva); kikapcsolva a program csak jelzi az új
verziót.

## Adatvédelem

- A FlightLogger API-kulcs az operációs rendszer titoktárolójában van, a beállítási fájlban nem.
- A program csak a FlightLoggerrel, az Open-Meteóval, az aviationweather.gov METAR-szolgáltatásával
  és – a frissítéshez – a saját GitHub-kiadásaival kommunikál; személyes adat harmadik félhez nem
  jut. A hálózati kérések egyetlen engedélyezési listán mennek át (`src/main/net/allowedFetch.ts`).

## Fejlesztés

```bash
npm ci
npm run dev        # Electron, fejlesztői módban
npm run dev:web    # csak a felület, böngészőben, szintetikus adattal (fejlesztői előnézet)
npm run typecheck && npm run lint && npm test
```

A követelmények a `docs/koncepcio.md`-ben, a kiadás és a frissítés működése a
`docs/kiadas-es-frissites.md`-ben van. A fejlesztés a `dev` ágon folyik: minden push fejlesztői
kiadást készít a **Foglalástervező DEV** programnak (csak Apple Silicon Mac); a fő kiadás a DEV-ben a
**Beállítások → Frissítés → Kiadás: dev → main** gombbal (vagy a GitHub Actions azonos nevű
munkafolyamatával) készül.
