export const MAIL = 'TDL mail sender'

function priority(date, duty, id) {
  let hash = 2166136261
  for (const char of `tdl-secondary:${date}:${duty}:${id}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

export function chooseDuty(date, duty, candidates, history, previous) {
  const retained = candidates.find(candidate => candidate.id === previous?.id)
  if (retained) return snapshot(retained)
  const counts = new Map()
  for (const row of history) {
    if (row.date < date && row.duty === duty) {
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
    }
  }
  const chosen = [...candidates].sort((a, b) =>
    (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) ||
    priority(date, duty, a.id) - priority(date, duty, b.id) || a.id - b.id
  )[0]
  return chosen ? snapshot(chosen) : null
}

function snapshot({ id, name, level }) {
  return { id, name, level }
}

// Assign HO first, then a distinct mail sender. Move an HO holder only when
// its queue can retain a valid replacement, preserving all filled HO duties.
export function assignSecondary(date, queues, roster, exclusions, history, previous) {
  const hoQueues = ['EDS', 'MSM']
  const hoCandidates = queue => queues[queue].filter(e => !exclusions.ho?.includes(e.id))
  const secondary = Object.fromEntries(hoQueues.map(queue => [queue,
    chooseDuty(date, queue, hoCandidates(queue), history, previous?.[queue])]))
  const mailCandidates = roster.filter(e => e.level === 'L0' && !exclusions.mail?.includes(e.id))
  const occupied = employee => hoQueues.filter(queue => secondary[queue]?.id === employee.id)
  secondary[MAIL] = chooseDuty(date, MAIL, mailCandidates.filter(e => !occupied(e).length), history, previous?.[MAIL])
  if (!secondary[MAIL]) {
    const alternatives = mailCandidates.filter(e => occupied(e).length &&
      occupied(e).every(queue => hoCandidates(queue).some(other => other.id !== e.id)))
    const reserved = chooseDuty(date, MAIL, alternatives, history)
    if (reserved) {
      for (const queue of hoQueues) secondary[queue] = chooseDuty(date, queue,
        hoCandidates(queue).filter(e => e.id !== reserved.id), history, secondary[queue])
      secondary[MAIL] = reserved
    }
  }
  return secondary
}
