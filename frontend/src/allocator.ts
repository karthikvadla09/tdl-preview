export const QUEUES = ['EDS', 'Backlogs', 'MSM'] as const
export type Queue = typeof QUEUES[number]

type Employee = {
  id: number
  name: string
  level: string
  eds_access: boolean
  restrictions?: string | null
}

type HistoryRow = { date: string; employee_id: number; queue: string; level: string }

export function shiftDate(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function mondayOf(date: string) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  return shiftDate(date, -((weekday + 6) % 7))
}

export function hasRestrictedQueues(employee: Pick<Employee, 'restrictions'>) {
  return employee.restrictions === 'EDS and Backlogs only'
}

export function excludedL0Ids(date: string, history: HistoryRow[]) {
  const monday = mondayOf(date)
  const priorMonday = shiftDate(monday, -7)
  return new Set(history.filter(row => row.queue === 'Backlogs' && row.level === 'L0'
    && priorMonday <= row.date && row.date < monday).map(row => row.employee_id))
}

export { restrictedConsecutiveEdsIds } from '../../assets/allocation.js'
