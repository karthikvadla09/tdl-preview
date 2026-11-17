import test from 'node:test';
import assert from 'node:assert/strict';
import {allocate, chooseSprt, addDays} from '../assets/allocation.js';
import {originalAllocate} from './fixtures/original-allocation.js';
const specs = [['Demo Member 01','L1',true],['Demo Member 02','L1',true],['Demo Member 03','L1',true],['Demo Member 04','L0',false],['Demo Member 05','L0',true],['Demo Member 06','L0',false],['Demo Member 07','L1',false],['Demo Member 08','L1',true],['Demo Member 09','L1',true],['Demo Member 10','L0',true],['Demo Member 11','L0',false],['Demo Member 12','L0',false],['Demo Member 13','L0',false],['Demo Member 14','L0',false]];
const team = () => specs.map(([name,level,eds_access],i) => ({id:i+1,name,level,eds_access,restrictions:name==='Demo Member 09'?'EDS and Backlogs only':''}));
const signature = queues => Object.fromEntries(Object.entries(queues).map(([q,es]) => [q,es.map(e=>[e.id,e.sprt||'']).sort((a,b)=>a[0]-b[0])]));
function score(day, queues, history) {
  let sum=0;
  const monday=addDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
  for(const [q,es] of Object.entries(queues)) {
    if(q!=='MSM')sum+=100*es.length-1000*Math.max(0,2-es.length)-100*(3-es.length);
    sum-=45*Math.max(0,2-es.filter(e=>e.level==='L1').length);
    for(const e of es){
      const rows=history.filter(r=>r.employee_id===e.id).sort((a,b)=>a.date.localeCompare(b.date));
      sum-=5*rows.filter(r=>r.queue===q).length;
      if(rows.at(-1)?.queue===q)sum-=8;
      if(q==='Backlogs'){
        sum-=35*rows.filter(r=>r.queue===q&&monday<=r.date&&r.date<day).length;
        if(e.level==='L1'){
          sum-=18*rows.filter(r=>r.queue===q&&addDays(monday,-7)<=r.date&&r.date<monday).length;
          if(rows.some(r=>r.queue===q&&r.date===addDays(day,-7)))sum-=45;
        }
      }
    }
  }
  return sum;
}
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

test('36 finalized dates preserve original primary optimum, eligibility and minimum SPRT counts',()=>{
  const history=[];const holders=new Set();
  for(let week=0;week<12;week++)for(let offset=0;offset<3;offset++){
    const day=addDays('2026-11-17',week*7+offset),roster=team();
    const [queues]=allocate(day,roster,history);
    const [original]=originalAllocate(day,team(),history);
    assert.equal(score(day,queues,history),score(day,original,history));
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
