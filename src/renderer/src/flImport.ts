import type { Settings } from '@core/config/schema'
import type { DataBundle } from '@core/model/dataBundle'
import { FL_COLOR_KEY, type ImportContext } from '@core/flImport/importBookings'
import { studentProgress, syllabusLabel } from './progress'

/**
 * A FlightLogger-import (5.10) nevei és címkéi a névjegyzékből. A program a FlightLogger saját
 * elnevezése szerint („IR Transition Plan for ATP(A) Rev 4”), ha az adat hozza, mert a szkript a
 * FlightLogger listájában ezzel ellenőriz; különben a feladatsor felirata.
 */
export function importContext(bundle: DataBundle, settings: Settings | null, timezone: string): ImportContext {
  const people = bundle.directory.people
  const person = (id: string) => {
    const p = people[id]
    return p ? { name: p.name, ...(p.callSign ? { callSign: p.callSign } : {}) } : { name: id }
  }
  const instructorId = bundle.snapshot.instructorId
  return {
    timezone,
    ...(instructorId && people[instructorId] ? { instructor: person(instructorId) } : {}),
    person,
    program: (studentId) => {
      const progress = studentProgress(bundle, settings, studentId)
      const fromFlightLogger = [progress?.programName, progress?.revisionName].filter(Boolean).join(' ')
      return fromFlightLogger || syllabusLabel(bundle, progress?.syllabusId) || undefined
    },
    lesson: (lectureId) => bundle.directory.lectures[lectureId]?.name,
    aircraft: (resourceId) => {
      const a = bundle.snapshot.fleet.find((x) => x.id === resourceId)
      return a ? { id: a.id, callSign: a.callSign, model: a.model } : undefined
    },
    className: (classId) => bundle.directory.classes[classId]?.name,
    color: (type) => settings?.flImport?.colors[FL_COLOR_KEY[type]],
    classroom: (classroomId) => {
      const name = bundle.directory.classrooms[classroomId]
      return name ? { id: classroomId, name } : undefined
    },
  }
}
