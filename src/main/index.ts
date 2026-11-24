import { join } from 'node:path'
import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { IPC } from '../shared/api'
import { createElectronConfigStore } from './configStore'
import { registerIpc } from './ipc'
import { createElectronPlanStore } from './planStore'
import { isRendererRequestAllowed } from './rendererNetworkPolicy'
import { createElectronSecretStore } from './secrets'
import { readUpdateChannel } from './update/buildInfo'
import { createAppUpdater } from './update/updater'

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
/** Az alkalmazás saját fájljai (a renderer csak ezek közül tölthet be, B2). */
const appFileRoot = join(__dirname, '..')

/**
 * A renderer hálózati zárja (ALP-02). A felület csak a saját fájljait töltheti be;
 * minden más kérést a session szintjén megszakítunk. A FlightLogger és az
 * Open-Meteo hívásai kizárólag a főfolyamat allowedFetch-én keresztül mennek.
 */
function lockDownSession(): void {
  const ses = session.defaultSession
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isRendererRequestAllowed(details.url, devServerUrl, appFileRoot) })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    // A fejlesztői változat neve „Foglalástervező DEV” (a csomag package.json-jából).
    title: app.getName(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  // Az ablak címe a program neve marad (a DEV-változat így megkülönböztethető).
  win.on('page-title-updated', (event) => event.preventDefault())

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('web-contents-created', (_event, contents) => {
  // Új ablak nem nyílhat; a külső hivatkozás a rendszerböngészőben nyílik meg, csak https.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isRendererRequestAllowed(url, devServerUrl, appFileRoot)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

/**
 * macOS: a frissítés csak az Alkalmazások mappából indított programnál működik (a lemezképről
 * vagy a Letöltések mappából futó példány csomagja nem cserélhető). Ilyenkor felajánljuk az
 * áthelyezést; sikerkor a program onnan újraindul. Igaz, ha a program épp újraindul.
 */
async function offerMoveToApplications(): Promise<boolean> {
  if (process.platform !== 'darwin' || !app.isPackaged || readUpdateChannel() === null || app.isInApplicationsFolder()) return false
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Áthelyezés', 'Most nem'],
    defaultId: 0,
    cancelId: 1,
    message: 'Áthelyezzem a programot az Alkalmazások mappába?',
    detail:
      'Az automatikus frissítés csak az Alkalmazások mappából indított programnál működik. Onnan a Launchpadből és a Spotlightból is elérhető, és a Dockban is tarthatod.',
  })
  if (response !== 0) return false
  try {
    return app.moveToApplicationsFolder()
  } catch (error) {
    dialog.showErrorBox('Az áthelyezés nem sikerült', error instanceof Error ? error.message : String(error))
    return false
  }
}

void app.whenReady().then(async () => {
  lockDownSession()
  if (await offerMoveToApplications()) return
  const updater = createAppUpdater()
  // Az állapotot minden ablak megkapja (a felület ebből mutatja a frissítést).
  updater.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.updateState, state)
  })
  registerIpc({
    configStore: createElectronConfigStore(),
    secretStore: createElectronSecretStore(),
    planStore: createElectronPlanStore(),
    // Csak a saját ablakunk keretéből érkező IPC-hívás számít (B3).
    isTrustedSender: (url) => isRendererRequestAllowed(url, devServerUrl, appFileRoot),
    updater,
  })
  createWindow()
  // Minden indításkor (FRS-01); a felület az ellenőrzés végéig nem tölt be adatot.
  void updater.runStartupCheck()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
