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
