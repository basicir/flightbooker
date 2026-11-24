import type { UpdateChannel } from './version'

/**
 * A két program neve (FRS-05): ez látszik a Finderben, a Dockban és a Start menüben, és az
 * Electron ebből képzi a felhasználói adatmappa nevét is. A fejlesztői változat ebből találja meg
 * a fő változat adatmappáját a beállítások átvételéhez (FRS-10).
 */
export const APP_DISPLAY_NAME: Readonly<Record<UpdateChannel, string>> = {
  stable: 'Foglalástervező',
  dev: 'Foglalástervező DEV',
}
