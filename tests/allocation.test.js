import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {allocate, chooseSprt, addDays, restrictedConsecutiveEdsIds} from '../assets/allocation.js';
const specs = [['Demo Member 01','L1',true],['Demo Member 02','L1',true],['Demo Member 03','L1',true],['Demo Member 04','L0',false],['Demo Member 05','L0',true],['Demo Member 06','L0',false],['Demo Member 07','L1',false],['Demo Member 08','L1',true],['Demo Member 09','L1',true],['Demo Member 10','L0',true],['Demo Member 11','L0',false],['Demo Member 12','L0',false],['Demo Member 13','L0',false],['Demo Member 14','L0',false]];
const team = () => specs.map(([name,level,eds_access],i) => ({id:i+1,name,level,eds_access,restrictions:name==='Demo Member 09'?'EDS and Backlogs only':''}));
const signature = queues => Object.fromEntries(Object.entries(queues).map(([q,es]) => [q,es.map(e=>[e.id,e.sprt||'']).sort((a,b)=>a[0]-b[0])]));
function invariants(day,queues,roster,history){
  const flat=Object.values(queues).flat();
  assert.equal(flat.length,roster.length);assert.equal(new Set(flat.map(e=>e.id)).size,roster.length);
  assert(queues.EDS.every(e=>e.eds_access));assert(queues.MSM.every(e=>e.restrictions!=='EDS and Backlogs only'));
  const monday=addDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
  const excluded=new Set(history.filter(r=>r.queue==='Backlogs'&&r.level==='L0'&&addDays(monday,-7)<=r.date&&r.date<monday).map(r=>r.employee_id));
  assert(queues.Backlogs.every(e=>!excluded.has(e.id)));
  const previous=addDays(day,new Date(day+'T00:00:00Z').getUTCDay()===2?-5:-1);
  const recent=new Set(history.filter(r=>r.date===previous&&r.queue==='EDS').map(r=>r.employee_id));
  assert(queues.EDS.every(e=>e.restrictions==='EDS and Backlogs only'||!recent.has(e.id)));
  for(const q of ['EDS','MSM']){
    const eligible=queues[q].filter(e=>e.level==='L0'),chosen=queues[q].filter(e=>e.sprt);
    assert.equal(chosen.length,eligible.length?1:0);
    if(chosen.length){
      const count=e=>history.filter(r=>r.employee_id===e.id&&r.sprt===q+' SPRT').length;
      assert.equal(count(chosen[0]),Math.min(...eligible.map(count)));
      assert.equal(chosen[0].sprt,q+' SPRT');
    }
  }
}

test('12 empty-history Tuesdays vary all queues and reproduce with permuted inputs',()=>{
  const sets={EDS:new Set(),Backlogs:new Set(),MSM:new Set()};
  for(let week=0;week<12;week++){
    const day=addDays('2026-11-17',7*week),roster=team();
    const [queues,warnings]=allocate(day,roster,[]);
    invariants(day,queues,roster,[]);assert.deepEqual(warnings,[]);
    assert.deepEqual(Object.values(queues).map(es=>es.length),[3,3,8]);
    assert.deepEqual(signature(queues),signature(allocate(day,[...roster].reverse(),[])[0]));
    assert(roster.every(e=>!('sprt' in e)));
    for(const q of Object.keys(sets))sets[q].add(JSON.stringify(queues[q].map(e=>e.id).sort((a,b)=>a-b)));
  }
  for(const teams of Object.values(sets))assert(teams.size>=6);
});

test('36 finalized dates preserve staffing, L1 pairing, eligibility and minimum SPRT counts',()=>{
  const history=[];const holders=new Set();
  for(let week=0;week<12;week++)for(let offset=0;offset<3;offset++){
    const day=addDays('2026-11-17',week*7+offset),roster=team();
    const [queues]=allocate(day,roster,history);
    for (const q of ['EDS','Backlogs']) {
      assert.equal(queues[q].length,3);
      assert.equal(queues[q].filter(e=>e.level==='L1').length,2);
    }
    invariants(day,queues,roster,history);
    holders.add(queues.MSM.find(e=>e.sprt)?.id);
    for(const [q,es]of Object.entries(queues))for(const e of es)history.push({date:day,employee_id:e.id,level:e.level,queue:q,sprt:e.sprt||''});
  }
  assert(holders.size>=6);
});

test('SPRT duties counted separately; names/order cannot control a date tie',()=>{
  const members=team().filter(e=>e.level==='L0'),target=members.at(-1);
  for(const q of ['EDS','MSM']){
    const other=q==='EDS'?'MSM':'EDS';
    const history=members.filter(e=>e.id!==target.id).map(e=>({date:'2026-10-01',employee_id:e.id,sprt:q+' SPRT'}));
    for(let i=0;i<12;i++)history.push({date:'2026-10-02',employee_id:target.id,sprt:other+' SPRT'});
    assert.equal(chooseSprt('2026-11-17',q,members,history).id,target.id);
    const chosen=new Set();
    for(let w=0;w<24;w++){
      const day=addDays('2026-11-17',7*w),winner=chooseSprt(day,q,members,[]).id;chosen.add(winner);
      assert.equal(chooseSprt(day,q,[...members].reverse().map(e=>({...e,name:'renamed'})),[]).id,winner);
    }
    assert(chosen.size>=6);
  }
  assert.equal(chooseSprt('2026-11-17','MSM',team().filter(e=>e.level==='L1'),[]),undefined);
});

test('sparse attendance and unavailable SPRT warn without breaking eligibility',()=>{
  for(const roster of [team().filter(e=>e.level==='L0'),team().filter(e=>e.level==='L1'),team().filter(e=>!e.eds_access)]){
    const [queues,warnings]=allocate('2026-11-17',roster,[]);
    invariants('2026-11-17',queues,roster,[]);assert(warnings.length>0);
  }
});

test('same/future date duties do not influence regeneration and stale SPRT is cleared',()=>{
  const roster=team().map(e=>({...e,sprt:'MSM SPRT'}));
  const history=roster.map(e=>({date:'2026-11-17',employee_id:e.id,level:e.level,queue:'Backlogs',sprt:'MSM SPRT'}));
  const [queues]=allocate('2026-11-17',roster,history);
  assert.deepEqual(signature(queues),signature(allocate('2026-11-17',team(),[])[0]));
  assert.equal(Object.values(queues).flat().filter(e=>e.sprt).length,2);
});


test('consecutive EDS follows the covered identity across substitute changes and return', () => {
  const original = team()[0];
  const cover = {...original, id:99, name:'Today cover', restrictions:'Temporary substitute', eds_rotation_employee_id:original.id};
  const roster = team().map(e => e.id === original.id ? cover : e);
  for (const previous of [original.id, 98]) {
    const history = [{date:'2026-11-17',employee_id:previous,eds_rotation_employee_id:original.id,level:'L1',queue:'EDS'}];
    assert(restrictedConsecutiveEdsIds('2026-11-18',roster,history).has(99));
    assert(restrictedConsecutiveEdsIds('2026-11-18',team(),history).has(original.id));
    assert(!allocate('2026-11-18',roster,history)[0].EDS.some(e => e.id === 99));
    assert(!restrictedConsecutiveEdsIds('2026-11-19',roster,history).has(99));
  }
});

test('Thursday EDS carries to Tuesday but configured exception is personal', () => {
  const original = team().find(e => e.name === 'Demo Member 09');
  const cover = {...original,id:99,name:'Cover',restrictions:'Temporary substitute',eds_rotation_employee_id:original.id};
  const history = [{date:'2026-11-19',employee_id:98,eds_rotation_employee_id:original.id,level:'L1',queue:'EDS'}];
  assert.deepEqual([...restrictedConsecutiveEdsIds('2026-11-24',[cover],history)],[99]);
  assert.equal(restrictedConsecutiveEdsIds('2026-11-24',[original],history).size,0);
  assert.equal(restrictedConsecutiveEdsIds('2026-12-01',[cover],history).size,0);
});

test('two-L1 EDS and Backlogs staffing outranks even long rotation history',()=>{
  const roster=team();
  const history=Array.from({length:200},(_,i)=>roster.filter(e=>e.level==='L1').map(e=>({date:addDays('2020-01-07',i),employee_id:e.id,level:e.level,queue:'Backlogs'}))).flat();
  const [queues,warnings]=allocate('2026-11-24',roster,history);
  for(const queue of ['EDS','Backlogs']){
    assert.equal(queues[queue].length,3);
    assert.equal(queues[queue].filter(e=>e.level==='L1').length,2);
  }
  assert(!warnings.some(w=>w.includes('pairing')));
  assert.deepEqual(signature(queues),signature(allocate('2026-11-24',[...roster].reverse(),history)[0]));
});

test('L1 shortage relaxes pairing with a warning while preserving eligibility',()=>{
  const roster=team().filter(e=>e.level==='L0');
  const [queues,warnings]=allocate('2026-11-24',roster,[]);
  invariants('2026-11-24',queues,roster,[]);
  assert(warnings.some(w=>w.includes('Backlogs: L1 pairing')));
});

const policyCases = JSON.parse(readFileSync(new URL('./fixtures/l1-policy.json', import.meta.url)));
for (const scenario of policyCases) test(`coverage-first L1 policy: ${scenario.name}`, () => {
  const before = JSON.stringify(scenario);
  const history=Array.from({length:scenario.historyCopies||1},()=>scenario.history).flat();
  const [queues, warnings] = allocate(scenario.day, scenario.employees, history);
  assert.deepEqual(['EDS','MSM','Backlogs'].map(q=>queues[q].filter(e=>e.level==='L1').length), scenario.expected);
  assert.equal(Object.values(queues).flat().length, scenario.employees.length);
  assert.equal(new Set(Object.values(queues).flat().map(e=>e.id)).size, scenario.employees.length);
  assert(queues.EDS.every(e=>e.eds_access));
  assert(queues.MSM.every(e=>e.restrictions!=='EDS and Backlogs only'));
  if (scenario.name.includes('substitute')) assert(!queues.EDS.some(e=>e.id===99));
  for (const q of ['EDS','MSM','Backlogs']) {
    const count=queues[q].filter(e=>e.level==='L1').length;
    assert.equal(warnings.some(w=>w.startsWith(`${q}: L1 coverage`)), Boolean(queues[q].length && !count));
    assert.equal(warnings.some(w=>w.startsWith(`${q}: L1 pairing`)), count<Math.min(2,queues[q].length));
  }
  assert.deepEqual(signature(queues),signature(allocate(scenario.day,[...scenario.employees].reverse(),history)[0]));
  assert.equal(JSON.stringify(scenario),before);
});

test('date-specific Backlogs exclusions block both levels alongside the weekly restriction',()=>{
  const roster=policyCases.find(c=>c.name==='6 L1s').employees;
  const history=[{date:'2026-11-17',employee_id:2,level:'L0',queue:'Backlogs'}];
  const [queues]=allocate('2026-11-24',roster,history,[1,9]);
  assert(!queues.Backlogs.some(e=>[1,2,9].includes(e.id)));
  assert.deepEqual(['EDS','MSM','Backlogs'].map(q=>queues[q].filter(e=>e.level==='L1').length),[2,2,2]);
  const [allExcluded,warnings]=allocate('2026-11-24',roster,[],roster.map(e=>e.id));
  assert.equal(allExcluded.Backlogs.length,0);
  assert(warnings.some(w=>w.includes('Backlogs has 0')));
  for(const level of ['L0','L1'])assert.throws(()=>allocate('2026-11-24',[
    {id:99,name:'Fictional Restricted',level,eds_access:false,restrictions:'EDS and Backlogs only'},
  ],[],[99]),/Backlogs exclusions conflict/);
  assert.deepEqual(signature(allocate('2026-11-24',roster,[])[0]),signature(allocate('2026-11-24',roster,[],[])[0]));
});
