import type { Workbook } from 'exceljs'

type Member = { name: string; level: string; sprt?: string }
type Generation = { status: string; queues: Record<string, Member[]>; warnings: string[]; secondary?: Record<string, Member | null> }
type DailyExport = {
  date: string; status: string; present_ids: number[]; generation: Generation | null
  employees: Array<{ id: number; name: string }>; exclusions: { ho: number[]; mail: number[]; backlogs?: number[] }
}
type WeeklyExport = {
  week_start: string
  days: Array<{ date: string; status: string; generation: Generation | null; backlogs_exclusions?: string[] }>
}
type Cell = string | number

function dutyName(generation: Generation, duty: string) {
  return generation.secondary ? generation.secondary[duty]?.name ?? 'Unfilled' : 'Not recorded'
}

function screenshareRows(date: string, generation: Generation): Cell[][] {
  return ['EDS', 'MSM'].map(queue => [
    date, queue, dutyName(generation, queue), generation.secondary?.[queue]?.level ?? '',
  ])
}

function allocationRows(generation: Generation): Cell[][] {
  return Object.entries(generation.queues).flatMap(([queue, members]) =>
    members.map(member => [queue, member.name, member.level, member.sprt ?? '']),
  )
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function writeWorkbook(
  filename: string,
  title: string,
  headerRow: number,
  headers: string[],
  prefix: Cell[][],
  rows: Cell[][],
  footer: Cell[][] = [],
  screenshare: Cell[][] = [],
  backlogs: Cell[][] | undefined = undefined,
) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook: Workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: headerRow }] })
  sheet.addRows([...prefix, headers, ...rows, ...footer])
  sheet.getRow(headerRow).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174C43' } }
  })
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow + rows.length, column: headers.length },
  }
  sheet.columns.forEach(column => {
    let width = 14
    column.eachCell?.(cell => {
      width = Math.max(width, String(cell.value ?? '').length + 2)
    })
    column.width = Math.min(44, width)
  })
  const duties = workbook.addWorksheet('HO screenshare', { views: [{ state: 'frozen', ySplit: 1 }] })
  duties.addRows([['Date', 'Queue', 'HO screenshare', 'Level'], ...screenshare])
  duties.getRow(1).font = { bold: true }
  duties.columns.forEach((column, index) => { column.width = index === 2 ? 32 : 14 })
  if (backlogs) {
    const exclusions = workbook.addWorksheet('Backlogs exclusions')
    exclusions.addRows([['Date', 'Backlogs exclusions'], ...backlogs])
    exclusions.getRow(1).font = { bold: true }
    exclusions.columns = [{ width: 16 }, { width: 44 }]
  }
  const buffer = await workbook.xlsx.writeBuffer()
  downloadFile(new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), filename)
}

export function exportDailyWorkbook(day: DailyExport) {
  if (!day.generation) throw new Error('Generate a TDL before exporting.')
  return writeWorkbook(
    `TDL-${day.date}.xlsx`, 'Daily TDL', 5,
    ['Queue', 'Employee', 'Level', 'Secondary responsibility'],
    [['TDL – Task Distribution List', day.date], ['Status', day.status], ['Present', day.present_ids.length], []],
    allocationRows(day.generation),
    [[], ['Validation warnings'], ...day.generation.warnings.map(warning => [warning]), [],
      ['TDL mail sender', dutyName(day.generation, 'TDL mail sender'), day.generation.secondary?.['TDL mail sender']?.level ?? ''],
      ...(['ho', 'mail', 'backlogs'] as const).map(kind => [
        kind === 'ho' ? 'HO screenshare exclusions' : kind === 'mail' ? 'TDL mail exclusions' : 'Backlogs exclusions',
        day.employees.filter(employee => (day.exclusions[kind] ?? []).includes(employee.id)).map(employee => employee.name).join(', '),
      ])],
    screenshareRows(day.date, day.generation),
  )
}

export function exportWeeklyWorkbook(week: WeeklyExport) {
  const finalized = week.days.flatMap(day =>
    day.status === 'finalized' && day.generation?.status === 'finalized' ? [{ date: day.date, generation: day.generation }] : [],
  )
  const rows = finalized.flatMap(({ date, generation }) =>
    allocationRows(generation).map(row => [date, ...row, 'Finalized', dutyName(generation, 'TDL mail sender')]))
  return writeWorkbook(
    `TDL-week-${week.week_start}.xlsx`, 'Finalized week', 3,
    ['Date', 'Queue', 'Employee', 'Level', 'SPRT', 'Status', 'TDL mail sender'],
    [['TDL – Finalized weekly summary', `Week of ${week.week_start}`], []], rows, [],
    finalized.flatMap(({ date, generation }) => screenshareRows(date, generation)),
    week.days.filter(day=>day.status==='finalized'&&day.generation?.status==='finalized').map(day=>[day.date, (day.backlogs_exclusions ?? []).join(', ')]),
  )
}
