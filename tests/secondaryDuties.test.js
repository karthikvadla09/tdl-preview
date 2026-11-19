import test from 'node:test';
import assert from 'node:assert/strict';
import {assignSecondary, MAIL} from '../frontend/src/secondaryDuties.mjs';
const member = (id, level='L0') => ({id,name:`Person ${id}`,level});
const queues = {EDS:[member(1),member(2,'L1')], MSM:[member(3),member(4,'L1')],Backlogs:[member(5)]};
const roster = Object.values(queues).flat();
const separate = result => assert(!result[MAIL] || !['EDS','MSM'].some(q=>result[q]?.id===result[MAIL].id));
test('36 dates select a separate mail sender with minimum eligible history count',()=>{
 const history=[];
 for(let i=0;i<36;i++){
  const date=new Date(Date.UTC(2026,10,17+i)).toISOString().slice(0,10);
  const duties=assignSecondary(date,queues,roster,{},history);separate(duties);
  assert(duties[MAIL]);
  const eligible=roster.filter(e=>e.level==='L0'&&!['EDS','MSM'].some(q=>duties[q]?.id===e.id));
  const count=id=>history.filter(h=>h.duty===MAIL&&h.id===id).length;
  assert.equal(count(duties[MAIL].id),Math.min(...eligible.map(e=>count(e.id))));
  for(const [duty,holder] of Object.entries(duties)) if(holder) history.push({date,duty,id:holder.id});
 }
});
test('reserve only mail candidate by moving HO when a replacement exists',()=>{
 const previous={EDS:member(1),MSM:member(3)};
 const result=assignSecondary('2026-11-17',queues,roster,{mail:[3,5]},[],previous);
 assert.equal(result[MAIL].id,1);assert.equal(result.EDS.id,2);assert.equal(result.MSM.id,3);separate(result);
 assert.deepEqual(assignSecondary('2026-11-17',queues,roster,{mail:[3,5]},[],previous),result);
});
test('mail stays unfilled when its sole candidate is irreplaceable HO',()=>{
 const result=assignSecondary('2026-11-17',queues,roster,{ho:[2],mail:[3,5]},[],{EDS:member(1)});
 assert.equal(result.EDS.id,1);assert.equal(result[MAIL],null);separate(result);
});
test('manual edits replace mail when the retained sender becomes an HO holder',()=>{
 const previous={EDS:member(5),MSM:member(3),[MAIL]:member(1)};
 const result=assignSecondary('2026-11-17',queues,roster,{},[],previous);
 assert.equal(result.EDS.id,1);assert.notEqual(result[MAIL].id,1);separate(result);
});
test('no candidates never invents duties or changes primary queues',()=>{
 const before=structuredClone(queues);
 const result=assignSecondary('2026-11-17',queues,roster,{ho:roster.map(e=>e.id),mail:roster.map(e=>e.id)},[]);
 assert.deepEqual(result,{EDS:null,MSM:null,[MAIL]:null});assert.deepEqual(queues,before);
});
