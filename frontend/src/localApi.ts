import { excludedL0Ids, hasRestrictedQueues, mondayOf, QUEUES, restrictedConsecutiveEdsIds, shiftDate } from './allocator'
import { allocate, chooseSprt } from '../../assets/allocation.js'
import { assignSecondary, MAIL } from './secondaryDuties.mjs'
import type { Queue } from './allocator'

type Level = 'L0' | 'L1'
type Employee = {
  id: number
  name: string
  level: Level
  eds_access: boolean
  active: boolean
  restrictions: string
  eds_rotation_employee_id?: number
}
type Member = Pick<Employee, 'id' | 'name' | 'level'> & { sprt: string }
type Assignee = Omit<Member, 'sprt'>
type Duty = 'EDS' | 'MSM' | typeof MAIL
const hoQueues = ['EDS', 'MSM'] as const
const duties = [...hoQueues, MAIL] as const
const dutyLabel = (duty: Duty) => duty === MAIL ? MAIL : `${duty} HO screenshare`
type Generation = {
  id: number
  number: number
  status: 'draft' | 'finalized' | 'superseded'
  warnings: string[]
  queues: Record<Queue, Member[]>
  created_at: string
  secondary?: Record<Duty, Assignee | null>
}
type Swap = {
  id: number
  original_employee_id: number
  substitute_employee_id: number
  substitute_name: string
  source_team: string
  level: Level
  eds_access: boolean
}
type Status = 'not_started' | 'attendance_entered' | 'tdl_generated' | 'finalized'
type Day = {
  status: Status
  attendance: Record<number, boolean>
  swaps: Swap[]
  generations: Generation[]
  current_generation_id: number | null
  audit: { event_type: string; created_at: string; details: unknown }[]
  exclusions?: Partial<Record<'ho' | 'mail', number[]>>
}
type State = { nextId: number; employees: Employee[]; days: Record<string, Day> }

const restricted = 'EDS and Backlogs only'
const temporary = 'Temporary substitute'
const seedLevels: Level[] = ['L1', 'L1', 'L1', 'L0', 'L0', 'L0', 'L1', 'L1', 'L1', 'L0', 'L0', 'L0', 'L0', 'L0']
const seedAccess = new Set([1, 2, 3, 5, 8, 9, 10])
const seedNames = ['Harshitha', 'Gajendran Ettikuppam', 'Yaswanth Sudagani', 'Lavanya Sai K',
  'Poojitha Boinasetty', 'Chandrasekhar Chevula', 'Bhavana Bobburi', 'Vani Rayasam', 'Karthik Vadla',
  'Abhilash.V', 'Inamdar Shrish', 'Pranav Patil', 'Om Shiv Tiwari', 'Sai Jayanth Koyya']
const fresh = (): State => ({
  nextId: 15,
  days: {},
  employees: seedLevels.map((level, index) => ({
    id: index + 1,
    name: seedNames[index],
    level,
    eds_access: seedAccess.has(index + 1),
    active: true,
    restrictions: index === 8 ? restricted : '',
  })),
})

let connection: Promise<IDBDatabase> | undefined

function database() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tdl-local-workspace', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('workspace')
      request.onerror = () => reject(new Error('Could not open local workspace storage.'))
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); connection = undefined }
        resolve(db)
      }
    }).catch((error) => { connection = undefined; throw error })
  }
  return connection
}

async function transact<T>(write: boolean, operation: (state: State) => T): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', write ? 'readwrite' : 'readonly')
    const store = tx.objectStore('workspace')
    const request = store.get('state')
    let result: T
    let operationError: unknown
    request.onsuccess = () => {
      const state: State = request.result ?? fresh()
      try {
        result = operation(state)
        if (write) store.put(state, 'state')
      } catch (error) {
        operationError = error
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(operationError ?? new Error('Could not save or read the local workspace.'))
  })
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(+time) && time.toISOString().slice(0, 10) === value
}

function workingDate(value: string) {
  if (!validDate(value)) throw new Error('Date must use YYYY-MM-DD format.')
  if (![2, 3, 4].includes(new Date(`${value}T00:00:00Z`).getUTCDay())) {
    throw new Error('TDL dates must be Tuesday, Wednesday, or Thursday.')
  }
  return value
}

function getOrCreateDay(state: State, date: string): Day {
  return state.days[date] ??= {
    status: 'not_started', attendance: {}, swaps: [], generations: [], current_generation_id: null, audit: [],
  }
}

function current(day?: Day) {
  return day?.generations.find((generation) => generation.id === day.current_generation_id) ?? null
}

function supersede(day: Day) {
  const generation = current(day)
  if (generation) generation.status = 'superseded'
  day.current_generation_id = null
}

function audit(day: Day, event_type: string, details: unknown) {
  day.audit.push({ event_type, details, created_at: new Date().toISOString() })
}

function regularEmployees(state: State) {
  return state.employees.filter((e) => e.restrictions !== temporary)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function effectiveEmployees(state: State, day?: Day) {
  const swaps = day?.swaps ?? []
  const replaced = new Set(swaps.map((swap) => swap.original_employee_id))
  const employees = regularEmployees(state).filter((employee) => employee.active && !replaced.has(employee.id))
    .map(employee => ({ ...employee, eds_rotation_employee_id: employee.id }))
  for (const swap of swaps) {
    employees.push({
      id: swap.substitute_employee_id, name: swap.substitute_name, level: swap.level,
      eds_access: swap.eds_access, active: true, restrictions: temporary, eds_rotation_employee_id: swap.original_employee_id,
    })
  }
  return employees
}

function sameIds(a: number[], b: number[]) {
  const ids = new Set(a)
  return ids.size === b.length && b.every((id) => ids.has(id))
}

const savedIds = (day: Day) => Object.keys(day.attendance).map(Number)
const presentIds = (day?: Day) => day ? savedIds(day).filter((id) => day.attendance[id]) : []
const attendanceSaved = (day: Day, roster: Employee[]) => sameIds(savedIds(day), roster.map((e) => e.id))

function historyRows(state: State) {
  return Object.entries(state.days).sort(([a], [b]) => b.localeCompare(a)).flatMap(([date, day]) => {
    const generation = current(day)
    if (day.status !== 'finalized' || generation?.status !== 'finalized') return []
    return [...QUEUES].sort().flatMap((queue) => [...generation.queues[queue]]
      .sort((a, b) => a.name.localeCompare(b.name)).map((member) => ({
        date, employee_id: member.id, employee: member.name, level: member.level, queue,
        sprt: member.sprt, status: 'finalized',
        eds_rotation_employee_id: day.swaps.find(swap => swap.substitute_employee_id === member.id)?.original_employee_id ?? member.id,
      })))
  })
}

function priorHistory(state: State, date: string) {
  return historyRows(state).filter((row) => row.date < date).reverse()
    .map(({ date, employee_id, level, queue, sprt, eds_rotation_employee_id }) => ({ date, employee_id, level, queue, sprt, eds_rotation_employee_id }))
}

function eligibleDuty(state: State, day: Day, generation: Generation, duty: Duty) {
  const excluded = new Set(day.exclusions?.[duty === MAIL ? 'mail' : 'ho'])
  if (duty === MAIL) for (const queue of hoQueues) {
    const holder = generation.secondary?.[queue]
    if (holder) excluded.add(holder.id)
  }
  const candidates = duty === MAIL
    ? effectiveEmployees(state, day).filter(employee => employee.level === 'L0')
    : generation.queues[duty]
  return candidates.filter(employee => day.attendance[employee.id] && !excluded.has(employee.id))
}

function assignDuties(state: State, date: string, day: Day, generation: Generation, preserve = false) {
  const history = Object.entries(state.days).flatMap(([date, prior]) => {
    const gen = current(prior)
    if (prior.status !== 'finalized' || gen?.status !== 'finalized') return []
    return duties.flatMap(duty => {
      const assignee = gen.secondary?.[duty]
      return assignee ? [{ date, duty, id: assignee.id }] : []
    })
  })
  const previous = preserve ? generation.secondary : undefined
  generation.secondary = assignSecondary(date, generation.queues,
    effectiveEmployees(state, day).filter(employee => day.attendance[employee.id]),
    day.exclusions ?? {}, history, previous) as NonNullable<Generation['secondary']>
}

function readDay(state: State, date: string) {
  const day = state.days[date]
  const employees = effectiveEmployees(state, day)
  return {
    date, status: day?.status ?? 'not_started', attendance_saved: !!day && attendanceSaved(day, employees),
    present_ids: presentIds(day), employees, generation: current(day), history: priorHistory(state, date),
    exclusions: Object.fromEntries((['ho', 'mail'] as const).map(kind => [
      kind, (day?.exclusions?.[kind] ?? []).filter(id => employees.some(employee => employee.id === id)),
    ])),
    swaps: (day?.swaps ?? []).map((swap) => ({
      ...swap, original_name: state.employees.find((e) => e.id === swap.original_employee_id)?.name ?? '',
    })),
  }
}

function week(state: State, date: string) {
  const monday = mondayOf(date)
  const days = [1, 2, 3].map((offset) => {
    const date = shiftDate(monday, offset)
    const day = state.days[date]
    return { date, status: day?.status ?? 'not_started', present_count: presentIds(day).length, generation: current(day) }
  })
  return { week_start: monday, days }
}

function analytics(state: State) {
  const counts: Record<string, Record<Queue | 'SPRT', number>> = Object.create(null)
  for (const row of historyRows(state)) {
    const count = counts[row.employee] ??= { EDS: 0, Backlogs: 0, MSM: 0, SPRT: 0 }
    count[row.queue]++
    if (row.sprt) count.SPRT++
  }
  return counts
}

function field(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new Error(`${label} must contain 1–120 characters.`)
  }
  return value.trim()
}

function level(value: unknown): Level {
  if (value !== 'L0' && value !== 'L1') throw new Error('Select L0 or L1.')
  return value
}

function saveEmployee(state: State, input: Record<string, unknown>, id?: number) {
  const old = id === undefined ? undefined : regularEmployees(state).find((employee) => employee.id === id)
  if (id !== undefined && !old) throw new Error('Employee not found.')
  const name = field(input.name, 'Employee name')
  if (state.employees.some((e) => e.id !== id && e.name === name)) {
    throw new Error('An employee with this name already exists.')
  }
  const restrictions = typeof input.restrictions === 'string' ? input.restrictions : ''
  const employee: Employee = {
    id: old?.id ?? state.nextId++, name, level: level(input.level),
    eds_access: input.eds_access === true, active: input.active !== false,
    restrictions: old && hasRestrictedQueues(old) ? restricted : restrictions === temporary ? '' : restrictions,
  }
  if (old) Object.assign(old, employee)
  else state.employees.push(employee)
  return employee
}

function requireConfirmation(day: Day | undefined, confirmed: boolean, action: string) {
  if (day?.status === 'finalized' && !confirmed) {
    throw new Error(`This date has a finalized TDL. Confirm replacement before ${action}.`)
  }
}

function transferAttendance(day: Day, from: number, to: number) {
  if (Object.hasOwn(day.attendance, from)) {
    day.attendance[to] = day.attendance[from]
    delete day.attendance[from]
  }
}

function invalidateForSwap(state: State, day: Day) {
  supersede(day)
  day.status = attendanceSaved(day, effectiveEmployees(state, day)) ? 'attendance_entered' : 'not_started'
}

function addSwap(state: State, day: Day, input: Record<string, unknown>) {
  const roster = regularEmployees(state).filter((e) => e.active)
  const original = roster.find((e) => e.id === input.original_employee_id)
  if (!original) throw new Error('Choose an active team member to replace.')
  if (day.swaps.some((swap) => swap.original_employee_id === original.id)) {
    throw new Error('This team member already has a temporary substitute for this date.')
  }
  const name = field(input.substitute_name, 'Substitute name')
  if (name.toLowerCase() === original.name.toLowerCase()) throw new Error('The substitute must be a different person.')
  const names = [...roster.map((employee) => employee.name), ...day.swaps.map((swap) => swap.substitute_name)]
  if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
    throw new Error('That name is already in use by this team or another substitute for the date.')
  }
  const swap = {
    id: state.nextId++, original_employee_id: original.id, substitute_employee_id: state.nextId++,
    substitute_name: name, source_team: field(input.source_team, 'Source team'),
    level: level(input.level), eds_access: input.eds_access === true,
  }
  state.employees.push({
    id: swap.substitute_employee_id, name, level: swap.level, eds_access: swap.eds_access,
    active: false, restrictions: temporary,
  })
  day.swaps.push(swap)
  transferAttendance(day, original.id, swap.substitute_employee_id)
  invalidateForSwap(state, day)
  audit(day, 'temporary_swap_added', swap)
  return { ok: true, swap_id: swap.id, status: day.status }
}

function removeSwap(state: State, day: Day | undefined, id: number, confirmed: boolean) {
  const swap = day?.swaps.find((swap) => swap.id === id)
  if (!day || !swap) throw new Error('Temporary swap not found for this date.')
  requireConfirmation(day, confirmed, 'changing its temporary swaps')
  transferAttendance(day, swap.substitute_employee_id, swap.original_employee_id)
  day.swaps = day.swaps.filter((entry) => entry.id !== id)
  invalidateForSwap(state, day)
  audit(day, 'temporary_swap_removed', { original_employee_id: swap.original_employee_id })
  return { ok: true, status: day.status }
}

function saveAttendance(state: State, day: Day, ids: unknown) {
  const roster = effectiveEmployees(state, day)
  const rosterIds = new Set(roster.map((e) => e.id))
  if (!Array.isArray(ids) || !ids.every((id) => rosterIds.has(id))) {
    throw new Error('Attendance contains an inactive or unknown employee.')
  }
  const selected = new Set(ids)
  day.attendance = Object.fromEntries(roster.map((e) => [e.id, selected.has(e.id)]))
  supersede(day)
  day.status = 'attendance_entered'
  audit(day, 'attendance_updated', { present_ids: ids })
  return { ok: true, status: day.status }
}

function generate(state: State, date: string, day: Day | undefined) {
  const roster = effectiveEmployees(state, day)
  if (!day || !attendanceSaved(day, roster)) throw new Error('Save attendance for every active employee before generating this day.')
  const present = roster.filter((employee) => day.attendance[employee.id])
  if (!present.length) throw new Error('At least one employee must be present to generate a TDL.')
  const [allocation, warnings] = allocate(date, present, priorHistory(state, date))
  const queues = { EDS: [], Backlogs: [], MSM: [] } as Generation['queues']
  for (const queue of QUEUES) {
    queues[queue] = allocation[queue].map(({ id, name, level, sprt }) => ({ id, name, level: level as Level, sprt: sprt ?? '' }))
  }
  supersede(day)
  const generation: Generation = {
    id: state.nextId++, number: (day.generations.at(-1)?.number ?? 0) + 1,
    status: 'draft', warnings, queues, created_at: new Date().toISOString(),
  }
  assignDuties(state, date, day, generation)
  generation.warnings = validate(state, date, day, generation).warnings
  day.generations.push(generation)
  day.current_generation_id = generation.id
  day.status = 'tdl_generated'
  audit(day, 'tdl_generated', { generation: generation.number })
  return generation
}

function eligibility(state: State, date: string) {
  const history = priorHistory(state, date)
  const excluded = excludedL0Ids(date, history)
  const recent = restrictedConsecutiveEdsIds(date, effectiveEmployees(state, state.days[date]), history)
  return (employee: Employee, queue: Queue): string | undefined => {
    if (queue === 'EDS' && !employee.eds_access) return `${employee.name} lacks EDS access.`
    if (queue === 'MSM' && hasRestrictedQueues(employee)) return `${employee.name} cannot be assigned to MSM.`
    if (queue === 'Backlogs' && employee.level === 'L0' && excluded.has(employee.id)) {
      return `L0 Backlogs one-week exclusion violation for ${employee.name}.`
    }
    if (queue === 'EDS' && recent.has(employee.id)) return `Consecutive-day EDS violation for ${employee.name}.`
  }
}

function validate(state: State, date: string, day: Day, generation: Generation) {
  const present = presentIds(day)
  const seen = new Set<number>()
  const employees = new Map(effectiveEmployees(state, day).map((employee) => [employee.id, employee]))
  const check = eligibility(state, date)
  const hard: string[] = []
  const warnings = generation.warnings.filter((warning) =>
    !/duplicate|absent|lacks|cannot|Invalid|exactly one|more than one|violation/.test(warning) &&
    !duties.some(duty => warning.startsWith(dutyLabel(duty))))
  for (const queue of QUEUES) {
    const members = generation.queues[queue]
    let sprt = 0
    for (const member of members) {
      const employee = employees.get(member.id)
      if (seen.has(member.id)) hard.push(`${member.name} has duplicate primary queue assignments.`)
      seen.add(member.id)
      if (!present.includes(member.id)) hard.push(`${member.name} is absent from saved attendance.`)
      const violation = employee && check(employee, queue)
      if (violation) hard.push(violation)
      if (member.sprt) {
        if (member.level !== 'L0' || queue === 'Backlogs' || member.sprt !== `${queue} SPRT`) {
          hard.push(`Invalid SPRT assignment for ${member.name}.`)
        }
        sprt++
      }
    }
    if (queue !== 'Backlogs') {
      if (sprt > 1) hard.push(`${queue} SPRT has more than one employee assigned.`)
      if (sprt === 0) warnings.push(`${queue} SPRT is unfilled; no eligible L0 employee is available in that queue.`)
    }
    if (queue === 'MSM') continue
    const count = members.length
    if (count < 2) warnings.push(`${queue} minimum staffing (2) is not met.`)
    else if (count === 2) warnings.push(`${queue} is at minimum staffing (2); preferred staffing is 3.`)
    else if (count > 3) warnings.push(`${queue} has ${count} employees; preferred staffing is 3.`)
    if (members.filter((e) => e.level === 'L1').length < Math.min(2, count)) {
      warnings.push(`${queue} L1 pairing preference has been relaxed.`)
    }
  }
  if (!sameIds([...seen], present)) hard.push('Every present employee must have exactly one primary queue.')
  for (const duty of duties) {
    const label = dutyLabel(duty)
    if (!generation.secondary) {
      warnings.push(`${label} was not recorded for this earlier generation. Regenerate to allocate it.`)
      continue
    }
    const candidates = eligibleDuty(state, day, generation, duty)
    const holder = generation.secondary[duty]
    if (holder && !candidates.some(employee => employee.id === holder.id && employee.level === holder.level)) {
      hard.push(duty === MAIL ? 'Invalid TDL mail sender: choose a present, non-excluded L0 teammate who is not an HO screenshare holder.' : `Invalid ${label} assignment.`)
    } else if (!holder && candidates.length) {
      hard.push(`Invalid ${label} assignment: an eligible assignee is missing.`)
    } else if (!holder) {
      warnings.push(duty === MAIL ? 'TDL mail sender is unfilled; no present, non-excluded L0 teammate remains after HO screenshare assignments.' : `${label} is unfilled because no eligible teammate is available.`)
    }
  }
  return { hard, warnings: [...new Set([...warnings, ...hard])] }
}

function adjust(state: State, date: string, day: Day, generation: Generation, input: unknown) {
  if (generation.status !== 'draft') throw new Error('Generate a draft TDL before adjusting assignments.')
  if (!Array.isArray(input) || input.some((a) => !a || !QUEUES.includes(a.queue))) throw new Error('Choose a valid queue for each employee.')
  const ids = input.map((a) => a.employee_id)
  if (ids.length !== new Set(ids).size || !sameIds(ids, presentIds(day))) {
    throw new Error('Assignments must include each present employee exactly once.')
  }
  const employees = new Map(effectiveEmployees(state, day).map((e) => [e.id, e]))
  const queues: Generation['queues'] = { EDS: [], Backlogs: [], MSM: [] }
  const check = eligibility(state, date)
  for (const { employee_id, queue } of input as { employee_id: number; queue: Queue }[]) {
    const employee = employees.get(employee_id)
    if (!employee) throw new Error('Save updated attendance before adjusting assignments.')
    const violation = check(employee, queue)
    if (violation) throw new Error(violation)
    const { id, name, level } = employee
    queues[queue].push({ id, name, level, sprt: '' })
  }
  for (const queue of ['EDS', 'MSM'] as const) {
    const eligible = queues[queue].filter((e) => e.level === 'L0')
    const old = generation.queues[queue].find((e) => e.sprt === `${queue} SPRT`)
    const chosen = eligible.find((e) => e.id === old?.id) ?? chooseSprt(date, queue, eligible, priorHistory(state, date))
    if (chosen) chosen.sprt = `${queue} SPRT`
  }
  generation.queues = queues
  generation.warnings = ['Manual assignment adjustment applied.']
  assignDuties(state, date, day, generation, true)
  generation.warnings = validate(state, date, day, generation).warnings
  audit(day, 'manual_assignment_adjustment', { assignments: input })
  return generation
}

function adjustSecondary(state: State, date: string, day: Day | undefined, input: Record<string, unknown>) {
  const generation = current(day)
  if (!day || !generation || generation.status !== 'draft' || day.status === 'finalized') {
    throw new Error('Generate a draft TDL before editing HO or mail assignments.')
  }
  if (generation.id !== input.generation_id) throw new Error('This TDL changed. Refresh before saving assignments.')
  const fields = ['eds_ho_id', 'msm_ho_id', 'mail_sender_id'] as const
  for (const field of fields) {
    const value = input[field]
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error('Supply a positive employee ID or null for every duty.')
    }
  }
  const selected = { EDS: input.eds_ho_id, MSM: input.msm_ho_id, [MAIL]: input.mail_sender_id }
  const roster = effectiveEmployees(state, day).filter(employee => day.attendance[employee.id])
  const hoIds = new Set([selected.EDS, selected.MSM].filter(id => id !== null))
  if (hoIds.size !== [selected.EDS, selected.MSM].filter(id => id !== null).length) {
    throw new Error('EDS and MSM HO screenshare must be assigned to different people.')
  }
  const next = {} as NonNullable<Generation['secondary']>
  for (const duty of duties) {
    const candidates = duty === MAIL
      ? roster.filter(employee => employee.level === 'L0' && !day.exclusions?.mail?.includes(employee.id) && !hoIds.has(employee.id))
      : eligibleDuty(state, day, generation, duty)
    const id = selected[duty]
    const person = candidates.find(employee => employee.id === id)
    if (id === null && candidates.length) throw new Error(`Choose an eligible ${dutyLabel(duty)} assignee.`)
    if (id !== null && !person) throw new Error(duty === MAIL
      ? 'TDL mail sender must be a present, non-excluded L0 teammate different from both HO holders.'
      : `${duty} HO screenshare must be a present, non-excluded member of ${duty}.`)
    next[duty] = person ? { id: person.id, name: person.name, level: person.level } : null
  }
  const before = generation.secondary
  generation.secondary = next
  generation.warnings = validate(state, date, day, generation).warnings
  audit(day, 'secondary_assignments_updated', { generation_id: generation.id, before, after: input })
  return generation
}

export async function localApi(path: string, init: RequestInit = {}): Promise<any> {
  const url = new URL(path, 'https://local.invalid')
  const [resource, id, action, item] = url.pathname.slice(1).split('/')
  const method = init.method ?? 'GET'
  const input: Record<string, unknown> = typeof init.body === 'string' ? JSON.parse(init.body) : {}
  const confirmed = url.searchParams.get('confirmed') === 'true'
  return transact(method !== 'GET', (state) => {
    if (resource === 'health' && method === 'GET') return { ok: true }
    if (resource === 'employees') {
      if (method === 'GET' && !id) return regularEmployees(state)
      if (method === 'POST' && !id) return saveEmployee(state, input)
      if (method === 'PUT' && id) return saveEmployee(state, input, Number(id))
    }
    if (resource === 'analytics' && method === 'GET') return analytics(state)
    if (resource === 'history' && method === 'GET') {
      const filters = url.searchParams
      return historyRows(state).filter((row) =>
        (!filters.get('employee_id') || row.employee_id === Number(filters.get('employee_id'))) &&
        (!filters.get('queue') || row.queue === filters.get('queue')) &&
        (!filters.get('level') || row.level === filters.get('level')) &&
        (!filters.get('date_from') || row.date >= filters.get('date_from')!) &&
        (!filters.get('date_to') || row.date <= filters.get('date_to')!))
    }
    if (resource === 'week' && method === 'GET') return week(state, workingDate(id))
    if (resource !== 'day') throw new Error('Local workspace action not found.')

    const date = workingDate(id)
    const day = state.days[date]
    if (method === 'GET' && !action) return readDay(state, date)
    if (method === 'POST' && action === 'swaps') {
      requireConfirmation(day, confirmed, 'changing its temporary swaps')
      return addSwap(state, getOrCreateDay(state, date), input)
    }
    if (method === 'DELETE' && action === 'swaps') return removeSwap(state, day, Number(item), confirmed)
    if (method === 'PUT' && (action === 'ho-exclusions' || action === 'mail-exclusions')) {
      const kind = action === 'ho-exclusions' ? 'ho' : 'mail'
      const rosterIds = new Set(effectiveEmployees(state, day).map(employee => employee.id))
      const ids = input.excluded_ids
      if (!Array.isArray(ids) || ids.some(id => !rosterIds.has(id))) {
        throw new Error('Choose exclusions from the effective roster for this date.')
      }
      const previous = day?.exclusions?.[kind] ?? []
      const next = [...new Set([...ids, ...previous.filter(id => !rosterIds.has(id))])].sort((a, b) => a - b)
      if (sameIds(previous, next)) return readDay(state, date)
      requireConfirmation(day, confirmed, 'changing duty exclusions')
      const savedDay = getOrCreateDay(state, date)
      savedDay.exclusions = { ...savedDay.exclusions, [kind]: next }
      invalidateForSwap(state, savedDay)
      audit(savedDay, `${kind}_exclusions_updated`, { excluded_ids: next })
      return readDay(state, date)
    }
    if (method === 'PUT' && action === 'attendance') {
      requireConfirmation(day, confirmed, 'changing attendance')
      return saveAttendance(state, getOrCreateDay(state, date), input.present_ids)
    }
    if (method === 'POST' && action === 'generate') {
      requireConfirmation(day, confirmed, 'regenerating it')
      return generate(state, date, day)
    }
    if (method === 'PUT' && action === 'secondary-assignments') return adjustSecondary(state, date, day, input)
    const generation = current(day)
    if (method === 'PUT' && action === 'assignments') {
      if (!day || !generation) throw new Error('Generate a draft TDL before adjusting assignments.')
      return adjust(state, date, day, generation, input.assignments)
    }
    if (method === 'POST' && (action === 'validate' || action === 'finalize')) {
      if (!day || !generation) throw new Error(`Generate a TDL before ${action === 'validate' ? 'validating' : 'finalizing'} it.`)
      const { hard, warnings } = validate(state, date, day, generation)
      generation.warnings = warnings
      if (action === 'validate') return { valid: hard.length === 0, warnings }
      if (hard.length) throw new Error(`Resolve validation errors before finalizing. ${hard.join(' ')}`)
      if (generation.status !== 'finalized') {
        generation.status = 'finalized'
        day.status = 'finalized'
        audit(day, 'tdl_finalized', { generation: generation.number })
      }
      return { ok: true, status: day.status }
    }
    throw new Error('Local workspace action not found.')
  })
}

export function exportBackup(): Promise<string> {
  return transact(false, (state) => JSON.stringify({ format: 'tdl-workspace', version: 1, state }, null, 2))
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isLevel(value: unknown) {
  return value === 'L0' || value === 'L1'
}

function string(value: unknown): value is string {
  return typeof value === 'string'
}

function validBackupState(value: unknown): value is State {
  if (!record(value) || !id(value.nextId) || !Array.isArray(value.employees) || !record(value.days)) return false
  const nextId = value.nextId
  const allIds = new Set<number>()
  const uniqueId = (value: unknown): value is number => {
    if (!id(value) || value >= nextId || allIds.has(value)) return false
    allIds.add(value)
    return true
  }
  const employees = new Set<number>()
  for (const employee of value.employees) {
    if (!record(employee) || !uniqueId(employee.id) || !string(employee.name) || !employee.name.trim() ||
      !isLevel(employee.level) || typeof employee.eds_access !== 'boolean' ||
      typeof employee.active !== 'boolean' || !string(employee.restrictions)) return false
    employees.add(employee.id)
  }
  const employeeId = (value: unknown): value is number => id(value) && employees.has(value)
  for (const [date, day] of Object.entries(value.days)) {
    if (!validDate(date) || ![2, 3, 4].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || !record(day) ||
      !['not_started', 'attendance_entered', 'tdl_generated', 'finalized'].includes(day.status as string) ||
      !record(day.attendance) || !Array.isArray(day.swaps) || !Array.isArray(day.generations) || !Array.isArray(day.audit)) return false
    if (!Object.entries(day.attendance).every(([key, present]) =>
      /^[1-9]\d*$/.test(key) && employeeId(Number(key)) && typeof present === 'boolean')) return false
    if (day.exclusions !== undefined && (!record(day.exclusions) ||
      !Object.entries(day.exclusions).every(([kind, ids]) => ['ho', 'mail'].includes(kind) &&
        Array.isArray(ids) && ids.every(employeeId) && new Set(ids).size === ids.length))) return false
    for (const swap of day.swaps) {
      if (!record(swap) || !uniqueId(swap.id) || !employeeId(swap.original_employee_id) ||
        !employeeId(swap.substitute_employee_id) || !string(swap.substitute_name) || !string(swap.source_team) ||
        !isLevel(swap.level) || typeof swap.eds_access !== 'boolean') return false
    }
    let activeGeneration: Record<string, unknown> | undefined
    for (const [index, generation] of day.generations.entries()) {
      if (!record(generation) || !uniqueId(generation.id) || generation.number !== index + 1 ||
        !['draft', 'finalized', 'superseded'].includes(generation.status as string) ||
        !string(generation.created_at) || !Array.isArray(generation.warnings) || !generation.warnings.every(string) ||
        !record(generation.queues)) return false
      if (generation.id === day.current_generation_id) activeGeneration = generation
      else if (generation.status !== 'superseded') return false
      if (generation.secondary !== undefined) {
        if (!record(generation.secondary) || !duties.every(duty => {
          const holder = (generation.secondary as Record<string, unknown>)[duty]
          return holder === null || (record(holder) && employeeId(holder.id) && string(holder.name) &&
            (duty === MAIL ? holder.level === 'L0' : isLevel(holder.level)))
        })) return false
      }
      for (const queue of QUEUES) {
        const members = generation.queues[queue]
        if (!Array.isArray(members) || !members.every((member) => record(member) &&
          employeeId(member.id) && string(member.name) && isLevel(member.level) && string(member.sprt))) return false
      }
    }
    const expectedStatus = day.status === 'finalized' ? 'finalized' : day.status === 'tdl_generated' ? 'draft' : null
    if (expectedStatus ? activeGeneration?.status !== expectedStatus : day.current_generation_id !== null) return false
    if (!day.audit.every((event) => record(event) && string(event.event_type) && string(event.created_at))) return false
  }
  return true
}

export async function restoreBackup(text: string): Promise<void> {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('The selected file is not a valid TDL workspace backup.')
  }
  if (!record(payload) || payload.format !== 'tdl-workspace' || payload.version !== 1 || !validBackupState(payload.state)) {
    throw new Error('The selected file is not a supported TDL workspace backup.')
  }
  const restored = payload.state
  await transact(true, (state) => Object.assign(state, restored))
}
