import type { ExistingBooking } from '../model/planning'

/**
 * Az oktató FlightLogger-foglalása-e (U2): ő az oktatója, vagy résztvevőként szerepel rajta
 * (például megbeszélés). Ugyanaz a feltétel, amellyel a motor az oktatót foglaltnak veszi.
 */
export function isInstructorBooking(b: ExistingBooking, instructorId: string): boolean {
  return b.instructorId === instructorId || b.participantIds.includes(instructorId)
}

/**
 * Az oktatói sávon külön mutatott FlightLogger-foglalások (U2): az oktató minden nem lemondott
 * foglalása, akkor is, ha nem a foglalástervezővel került fel (géppel, teremmel vagy anélkül).
 * Kimarad, amit a sáv a terv igényeként már mutat (`linkedIds`), és aminek a régi helyét a terv
 * áthelyezettnek jelölte (`supersededIds`). Kezdés szerint rendezve.
 */
export function instructorOwnBookings(
  bookings: readonly ExistingBooking[],
  instructorId: string,
  linkedIds: ReadonlySet<string>,
  supersededIds: ReadonlySet<string>,
): ExistingBooking[] {
  return bookings
    .filter((b) => b.status !== 'CANCELLED' && !linkedIds.has(b.id) && !supersededIds.has(b.id) && isInstructorBooking(b, instructorId))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
