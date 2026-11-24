import { FL_COLOR_TYPES, type FlColorType, type Settings } from '@core/config/schema'
import { useState } from 'react'
import importScript from '../../../../tools/tampermonkey/flightlogger-import.user.js?raw'
import { api } from '../bridge'
import { Button } from './ui'

const COLOR_LABELS: Readonly<Record<FlColorType, string>> = {
  singleStudent: 'Egynövendékes repülés (Single student)',
  multiStudent: 'Többnövendékes repülés (Multi student)',
  groundTraining: 'Csoportos elmélet (Ground training)',
  extraTheory: 'Extra elmélet (Extra theory)',
  meeting: 'Megbeszélés (Meeting)',
}
/** A FlightLogger színválasztójának gyorsszínei. */
const FL_SWATCHES = ['#eb83b5', '#8ab79b', '#95a552', '#26a69a'] as const

/**
 * A FlightLoggerbe felvitt foglalások kitöltőszíne típusonként (FLI-12). „Nincs szín”: a szkript nem
 * nyúl a színhez, a FlightLogger alapja marad. A mentés a Beállítások szokásos Mentés gombjával.
 */
export function FlImportColors(props: { settings: Settings; onChange: (s: Settings) => void }) {
  const colors = props.settings.flImport?.colors ?? {}
  const set = (key: FlColorType, value: string | undefined): void => {
    const next: Partial<Record<FlColorType, string>> = {}
    for (const k of FL_COLOR_TYPES) {
      const v = k === key ? value : colors[k]
      if (v) next[k] = v
    }
    props.onChange({ ...props.settings, flImport: { colors: next } })
  }
  return (
    <div className="stack">
      <h3>A foglalások színe a FlightLoggerben</h3>
      <p className="muted small">Típusonként; a szkript a FlightLogger ablakában a kitöltőszínt (fill) állítja be. „Nincs szín” esetén nem nyúl hozzá.</p>
      <table className="table fl-colors">
        <tbody>
          {FL_COLOR_TYPES.map((key) => {
            const value = colors[key]
            return (
              <tr key={key}>
                <td>{COLOR_LABELS[key]}</td>
                <td>
                  <label className="row">
                    <input type="checkbox" checked={!!value} onChange={(e) => set(key, e.target.checked ? (value ?? FL_SWATCHES[3]) : undefined)} aria-label={`${COLOR_LABELS[key]}: van szín`} />
                    {value ? 'szín:' : 'nincs szín (a FlightLogger alapja)'}
                  </label>
                </td>
                <td>
                  {value && (
                    <div className="row">
                      <input type="color" value={value.toLowerCase()} onChange={(e) => set(key, e.target.value)} aria-label={`${COLOR_LABELS[key]}: szín`} />
                      <code className="small">{value}</code>
                      {FL_SWATCHES.map((sw) => (
                        <button key={sw} type="button" className="swatch" title={`${sw} (a FlightLogger gyorsszíne)`} aria-label={`${sw} választása`} style={{ background: sw }} onClick={() => set(key, sw)} />
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A szkript változata a fejlécéből (`// @version 1.0.0`). */
const SCRIPT_VERSION = /@version\s+(\S+)/.exec(importScript)?.[1] ?? '?'

/**
 * FlightLogger-import (5.10, FLI-09): telepítés és használat. A szkript az alkalmazással érkezik,
 * innen másolható a Tampermonkeyba; hálózat nem kell hozzá.
 */
export function FlImportGuide() {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const copyScript = async (): Promise<void> => {
    try {
      await api.copyText(importScript)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
    setTimeout(() => setCopied(null), 2500)
  }
  return (
    <div className="stack fl-import-guide">
      <p>
        A rögzítési lista foglalásai a FlightLogger saját foglalási ablakában kerülnek fel, pár kattintással. Egy böngészőbővítmény-szkript (Tampermonkey) tölti ki az
        ablakot a vágólapra másolt adatokból; <strong>a mentést (Create) minden foglalásnál te nyomod meg</strong>. A Foglalástervező ettől sem ír a FlightLoggerbe, és
        hálózatot sem használ hozzá.
      </p>

      <h3>Telepítés (egyszer)</h3>
      <ol>
        <li>
          Telepítsd a böngésződbe a <strong>Tampermonkey</strong> bővítményt (Chrome Web Store, Firefox Add-ons vagy Mac App Store), és engedélyezd.
        </li>
        <li>
          <div className="row wrap">
            <Button variant="primary" onClick={() => void copyScript()}>
              {copied === 'ok' ? 'A szkript a vágólapon' : copied === 'failed' ? 'A másolás nem sikerült' : 'Szkript másolása'}
            </Button>
            <span className="muted small">FlightLogger-import {SCRIPT_VERSION}</span>
          </div>
        </li>
        <li>A Tampermonkey menüjében: <em>Új szkript létrehozása</em> → töröld a mintaszöveget → illeszd be → <em>Fájl → Mentés</em>.</li>
        <li>Nyisd meg (vagy töltsd újra) a FlightLogger foglalási áttekintőjét (Bookings → Overview): az eszközsorban a „+” mellett megjelenik az <strong>Import</strong> gomb.</li>
      </ol>
      <p className="muted small">Frissítéskor ugyanígy: másold újra, és a Tampermonkeyban cseréld le a szkript szövegét.</p>

      <h3>Használat</h3>
      <ol>
        <li>
          A <strong>Rögzítési listán</strong> a tétel „FlightLoggerbe” gombja egy foglalást, a fejléc „Mind a FlightLoggerbe” gombja az összes még fel nem vittet másolja.
        </li>
        <li>
          A FlightLoggerben: <strong>Import</strong> → kattints a szövegmezőbe, és illeszd be (Cmd+V / Ctrl+V). A foglalások a listára kerülnek, és a naptárban halványan
          megjelennek a megfelelő sorban (a gépnél a briefingtől a debriefingig, a repülés kiemelve), mindig a látható napon. A naptár tetején egy sor az aznapi összes
          foglalásodat mutatja (beillesztés nélkül is, a lemondottak nélkül), az átfedőket egymás alatt. Ez még csak előnézet.
        </li>
        <li>
          <strong>Foglalás megkezdése</strong>: a szkript megnyitja a FlightLogger ablakát, kiválasztja a típust, és kitölti a mezőket. Ellenőrizd, pótold, amit a panel
          felsorol, majd nyomd meg a <strong>Create</strong> gombot. Mentés után magától nyílik a következő, kitöltve.
        </li>
        <li>
          Ha mentés nélkül zárod be az ablakot, a szkript megáll: „Foglalás megkezdése” után újra ez jön, vagy a panelen hagyd ki. Ha egy foglalást kézzel vittél fel, a panelen
          „Felvittem”.
        </li>
        <li>
          <strong>Áthelyezés</strong>: a FlightLoggerben már meglévő foglalás új helyét (a Rögzítési listán „áthelyezendő a FlightLoggerben”) a szkript nem új
          foglalásként veszi fel, hanem a régi napra lapoz, megnyitja a meglévő foglalást, és átírja benne az időt, a gépet vagy a termet. Ellenőrizd, majd nyomd meg az{' '}
          <strong>Update</strong> gombot. Ha a foglalás összetétele is változik (például két egyéni repülésből közös briefinges pár lett), a típust és a
          növendékeket is átírja, a fölöslegessé vált foglalást pedig lemondásra teszi.
        </li>
        <li>
          <strong>Lemondás</strong>: a lemondandó foglalást a szkript megnyitja, és kiemeli a <strong>Cancel</strong> gombot. A lemondást és amit a FlightLogger
          még kér (például az okát) te végzed; a szkript megvárja, és csak akkor lép tovább, ha a foglalás tényleg lemondott.
        </li>
        <li>A naptár tetején lévő sorban egy foglalásra kattintva lent a naptárban ugyanaz a foglalás keretet kap, és odagörget (Esc: kijelölés vége).</li>
        <li>
          Minden mentés után a <strong>visszaigazolás a vágólapra</strong> kerül. A Foglalástervezőbe visszatérve a Rögzítési lista magától beolvassa, és a létrehozott tételeket
          rögzítettnek jelöli. Ha nem tette meg: a panelen „Visszaigazolás másolása”, itt pedig „Visszaigazolás beolvasása”.
        </li>
      </ol>

      <h3>Amit a szkript nem tölt ki</h3>
      <ul>
        <li>
          Elméletnél azt, amit az igénynél nem adtál meg: Ground trainingnél az osztályt (Class), a programot, a tárgyat (Subject) és a Session mezőt, Extra theorynál a
          programot. Ezek az Elméletek oldalon, az igénynél adhatók meg, a FlightLogger programlistájából.
        </li>
        <li>Ha az osztály választása a FlightLoggerben a teljes osztályt a Students mezőbe teszi, a szkript csak a hiányzókat veszi fel, a fölöslegeseket jelzi: töröld őket.</li>
        <li>
          Amire nem talál egyértelmű opciót (például más a neve a FlightLoggerben): a választó üres marad, és a panel felsorolja. A személyeket a FlightLogger-kódjuk
          (a „KÓD - Név” elején) szerint keresi.
        </li>
        <li>A keretszínt, a dokumentumot, a megfigyelőt, az ismétlést és a „nem közzétett” jelölést nem állítja (a kitöltőszínt igen, ha fent megadtad).</li>
      </ul>

      <h3>Elmélettípusok</h3>
      <p>
        Az Elméletek oldalon minden elméletnél választható: <strong>Meeting</strong> (alapértelmezett; oktató mező nélkül, te is résztvevő vagy), <strong>Ground training</strong>
        (csoportos, osztállyal, programmal, tárggyal, Session type-pal és Session-nel) vagy <strong>Extra theory</strong> (egy növendék, programmal; több résztvevőnél
        növendékenként külön foglalás lesz). A program- és tárgylista a FlightLoggerből jön (csak olvasás, a kulcsoddal); ha a FlightLogger nem adja, a mezőkbe szöveggel írhatsz,
        töredék is elég (például „ground 6” vagy „cross”): a szkript a FlightLogger listájában a legjobban illőt választja, több egyformán jó találatnál szól.
      </p>

      <h3>Adatvédelem</h3>
      <p className="small">
        A csomag (nevek, FlightLogger-kódok, időpontok, komment) csak a vágólapon és a böngésző helyi tárában van a FlightLogger oldalán; hálózaton nem megy sehova. A panel
        „Lista törlése” gombja törli. A szkript nem küld kérést, és nem nyomja meg a mentést.
      </p>
    </div>
  )
}
