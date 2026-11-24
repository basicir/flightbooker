import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { HelpProvider } from './help/HelpPanel'
import { AppProvider } from './state'
import { UpdateGate } from './update/UpdateGate'
import './styles.css'

// Az ablakra ejtett fájl ne nyíljon meg a program helyén; a fotót csak a kijelölt helyen
// (Indítópult, kirepülhető idő) lehet beolvasni.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

const root = document.getElementById('root')
if (!root) throw new Error('Hiányzik a #root elem.')

// A frissítés indítási ellenőrzése (FRS-01) az adatok betöltése előtt fut.
createRoot(root).render(
  <StrictMode>
    <UpdateGate>
      <AppProvider>
        <HelpProvider>
          <App />
        </HelpProvider>
      </AppProvider>
    </UpdateGate>
  </StrictMode>,
)
