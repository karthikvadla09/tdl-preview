// Source module for the static preview's allocator. No backend or sign-in required.
const QUEUES = ['EDS', 'Backlogs', 'MSM'];
export function addDays(day, count) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
const monday = day => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const restricted = employee => employee.restrictions === 'EDS and Backlogs only';

// Only consecutive EDS uses the covered roster identity; other duties remain personal.
export function restrictedConsecutiveEdsIds(day, employees, history) {
  const previous = addDays(day, new Date(`${day}T00:00:00Z`).getUTCDay() === 2 ? -5 : -1);
  const recent = new Set(history.filter(row => row.date === previous && row.queue === 'EDS')
    .map(row => row.eds_rotation_employee_id ?? row.employee_id));
  return new Set(employees.filter(employee =>
    recent.has(employee.eds_rotation_employee_id ?? employee.id) &&
    !restricted(employee))
    .map(employee => employee.id));
}

// A stable, synchronous, mixed hash suits this entirely synchronous browser API.
// Identity (not display name/order) and date define ties. Not a security function.
function priority(day, id, task) {
  const key = `tdl-preview-fairness-v1:${day}:${id}:${task}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function chooseSprt(day, queue, members, history) {
  const duty = `${queue} SPRT`;
  const counts = new Map();
  for (const row of history) {
    if (row.date < day && row.sprt === duty) counts.set(row.employee_id, (counts.get(row.employee_id) || 0) + 1);
  }
  return members.filter(employee => employee.level === 'L0').sort((a, b) =>
    (counts.get(a.id) || 0) - (counts.get(b.id) || 0) ||
    priority(day, a.id, duty) - priority(day, b.id, duty) || a.id - b.id
  )[0];
}

// Keep primary staffing/history score and secondary date priority separate.
// A tie can NEVER outweigh even one point of the original objective.
const better = (candidate, current) => !current || candidate.score > current.score ||
  (candidate.score === current.score && candidate.tie > current.tie);

// Cover as many queues as possible before assigning a second L1.
// EDS > MSM > Backlogs breaks coverage ties, then prioritizes second L1s.
export function l1StaffingWarnings(queues) {
  const warnings = [];
  for (const queue of ['EDS', 'MSM', 'Backlogs']) {
    const members = queues[queue] || [];
    const count = members.filter(employee => employee.level === 'L1').length;
    if (members.length && !count) warnings.push(`${queue}: L1 coverage preference was relaxed due to availability or restrictions.`);
    if (count < Math.min(2, members.length)) warnings.push(`${queue}: L1 pairing preference was relaxed due to availability or restrictions.`);
  }
  return warnings;
}

export function allocate(day, input, inputHistory) {
  const employees = input.map(({sprt, ...employee}) => ({...employee})).sort((a, b) => a.id - b.id);
  const history = inputHistory.filter(row => row.date < day).slice().sort((a, b) => a.date.localeCompare(b.date));
  const start = monday(day), previousStart = addDays(start, -7), previousWeekday = addDays(day, -7);
  const excluded = new Set(history.filter(row => row.queue === 'Backlogs' && row.level === 'L0' && previousStart <= row.date && row.date < start).map(row => row.employee_id));
  const consecutive = restrictedConsecutiveEdsIds(day, employees, history);
  const eligible = (employee, queue) => queue === 'EDS' ? employee.eds_access && !consecutive.has(employee.id) :
    queue === 'Backlogs' ? employee.level !== 'L0' || !excluded.has(employee.id) : !restricted(employee);
  const eligibleL0 = Object.fromEntries(['EDS', 'Backlogs'].map(queue => [queue, employees.some(employee => employee.level === 'L0' && eligible(employee, queue))]));
  const byEmployee = new Map();
  for (const row of history) {
    const rows = byEmployee.get(row.employee_id) || [];
    rows.push(row); byEmployee.set(row.employee_id, rows);
  }
  let states = new Map([['0,0,0,0,0', {staffing: [0, 0, 0, 0, 0], score: 0, tie: 0, path: []}]]);
  for (const employee of employees) {
    const rows = byEmployee.get(employee.id) || [];
    const choices = QUEUES.filter(queue => eligible(employee, queue)).map(queue => {
      let score = -5 * rows.filter(row => row.queue === queue).length;
      if (rows.at(-1)?.queue === queue) score -= 8;
      if (queue === 'Backlogs') {
        const backlogs = rows.filter(row => row.queue === queue);
        score -= 35 * backlogs.filter(row => start <= row.date && row.date < day).length;
        if (employee.level === 'L1') {
          score -= 18 * backlogs.filter(row => previousStart <= row.date && row.date < start).length;
          if (backlogs.some(row => row.date === previousWeekday)) score -= 45;
        }
      }
      return {queue, score};
    });
    const next = new Map();
    for (const state of states.values()) for (const choice of choices) {
      const staffing = [...state.staffing], l1 = +(employee.level === 'L1');
      if (choice.queue === 'EDS') {
        staffing[0]++; staffing[2] += l1;
        if (staffing[0] > 3 || (eligibleL0.EDS && staffing[2] > 2)) continue;
      } else if (choice.queue === 'Backlogs') {
        staffing[1]++; staffing[3] += l1;
        if (staffing[1] > 3 || (eligibleL0.Backlogs && staffing[3] > 2)) continue;
      } else staffing[4] = Math.min(2, staffing[4] + l1);
      const key = staffing.join(',');
      const candidate = {staffing, score: state.score + choice.score, tie: state.tie + priority(day, employee.id, choice.queue), path: [...state.path, choice.queue]};
      if (better(candidate, next.get(key))) next.set(key, candidate);
    }
    states = next;
  }
  // Queue staffing > first-L1 coverage > second-L1 priority > rotation.
  // Rotation scores are nonpositive; bound their full possible range rather
  // than choosing a fixed weight that long histories can eventually outweigh.
  const rotationBound = 100 + employees.length * (106 * history.length + 53);
  const l1Weight = rotationBound + 1;
  // L1 preference ranges from 0 through 255; staffing must dominate it all.
  const staffingWeight = 256 * l1Weight;
  let best;
  for (const state of states.values()) {
    const [eds, backlogs, ...l1Counts] = state.staffing;
    const staffingScore = [eds, backlogs].reduce((sum, count) => sum + 100 * count - 1000 * Math.max(0, 2 - count) - 100 * (3 - count), 0);
    const priorityCounts = [l1Counts[0], l1Counts[2], l1Counts[1]];
    const covered = priorityCounts.filter(count => count > 0).length;
    const coveragePriority = priorityCounts.reduce((sum, count, i) => sum + (count > 0 ? 4 >> i : 0), 0);
    const pairingPriority = priorityCounts.reduce((sum, count, i) => sum + (count > 1 ? 4 >> i : 0), 0);
    const l1Preference = 64 * covered + 8 * coveragePriority + pairingPriority;
    const score = staffingWeight * staffingScore + l1Weight * l1Preference + state.score;
    const candidate = {...state, score};
    if (better(candidate, best)) best = candidate;
  }
  if (!best) throw new Error('No valid allocation could be found for this attendance list.');
  const result = Object.fromEntries(QUEUES.map(queue => [queue, []]));
  employees.forEach((employee, index) => result[best.path[index]].push(employee));
  const warnings = [];
  for (const queue of ['EDS', 'Backlogs']) {
    const members = result[queue];
    if (members.length < 2) warnings.push(`${queue} has ${members.length} employee(s); minimum staffing of 2 could not be met.`);
    else if (members.length === 2) warnings.push(`${queue} is at minimum staffing (2); preferred staffing is 3.`);
  }
  warnings.push(...l1StaffingWarnings(result));
  for (const queue of ['EDS', 'MSM']) {
    const selected = chooseSprt(day, queue, result[queue], history);
    if (selected) selected.sprt = `${queue} SPRT`;
    else warnings.push(`${queue} SPRT could not be allocated: no L0 employee in the queue.`);
  }
  return [result, warnings];
}
