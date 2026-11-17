import json,time,tempfile
from pathlib import Path
from datetime import datetime,timedelta,date,timezone
from playwright.sync_api import sync_playwright, expect
import openpyxl
out=Path(tempfile.mkdtemp(prefix='tdl-preview-evidence-'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000)
 page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc))
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5174',wait_until='networkidle')
 assert page.get_by_role('heading',name='Welcome back').count()==0
 page.get_by_role('button',name='Daily TDL',exact=True).click()
 def state():
  return page.evaluate('''() => new Promise((resolve,reject)=>{const r=indexedDB.open('tdl-local-workspace',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const t=db.transaction('workspace','readonly');const q=t.objectStore('workspace').get('state');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}})''')
 def current(s,day):
  d=s['days'].get(day,{});return next((g for g in d.get('generations',[]) if g['id']==d.get('current_generation_id')),None)
 def wait(fn):
  end=time.monotonic()+10
  while time.monotonic()<end:
   s=state()
   if s and fn(s):return s
   time.sleep(.05)
  raise AssertionError('Saved workspace condition did not become true')
 def click(name):page.get_by_role('button',name=name,exact=True).click()
 selected=date(2026,11,17)
 def choose(day):
  global selected
  clicker=page.get_by_role('button',name='Working date,');clicker.click()
  delta=(day.year-selected.year)*12+day.month-selected.month
  for _ in range(abs(delta)):page.get_by_role('button',name='Next month' if delta>0 else 'Previous month',exact=True).click()
  label=f'{day:%A}, {day:%B} {day.day}, {day.year}'
  page.get_by_role('gridcell',name=label,exact=True).click();selected=day
 def queues():
  s=state();return current(s,str(selected))['queues']
 def finalize():
  click('Validate TDL');click('Finalize TDL');return wait(lambda s:s['days'][str(selected)]['status']=='finalized')
 click('Select all');click('Save attendance');wait(lambda s:s['days'].get(str(selected),{}).get('status')=='attendance_entered')
 click('Generate TDL');wait(lambda s:current(s,str(selected)) is not None)
 initial=queues();assert list(map(len,initial.values()))==[3,3,8]
 page.locator('.allocation-panel .queue-member').first.wait_for()
 finalize()
 page.once('dialog',lambda d:d.dismiss());click('Regenerate TDL');assert queues()==initial
 page.once('dialog',lambda d:d.accept());click('Regenerate TDL');wait(lambda s:current(s,str(selected))['number']==2)
 assert queues()==initial
 # Replace the MSM SPRT holder via a legal primary-queue swap.
 old=next(e for e in initial['MSM'] if e.get('sprt'))
 swap=next(e for e in initial['Backlogs'] if e['level']=='L0')
 for name,q in [(old['name'],'Backlogs'),(swap['name'],'MSM')]:
  page.get_by_role('combobox',name='Queue for '+name,exact=True).click();page.get_by_role('option',name=q,exact=True).click()
 click('Save assignments');wait(lambda s:any(e['id']==old['id'] for e in current(s,str(selected))['queues']['Backlogs']))
 q=queues();holder=next(e for e in q['MSM'] if e.get('sprt'))
 expected=page.evaluate("async members=>(await import('./assets/allocation.js')).chooseSprt('2026-11-17','MSM',members,[]).id",q['MSM'])
 assert holder['id']==expected and holder['id']!=old['id']
 finalize();firstfinal=queues()
 page.reload(wait_until='networkidle');page.get_by_role('button',name='Daily TDL',exact=True).click();assert queues()==firstfinal
 with page.expect_download() as download:click('Export Excel')
 daily=out/'daily.xlsx';download.value.save_as(daily)
 ws=openpyxl.load_workbook(daily).active
 rows=list(ws.iter_rows(min_row=6,max_row=19,values_only=True))
 assert {(r[0],r[1]) for r in rows}=={(q,e['name']) for q,es in firstfinal.items() for e in es}
 click('Weekly view');assert page.get_by_role('button',name='Generate TDL',exact=True).count()==0
 with page.expect_download() as download:
  page.get_by_role('button',name='Export finalized days',exact=True).click()
 weekly=out/'weekly.xlsx';download.value.save_as(weekly)
 wr=list(openpyxl.load_workbook(weekly).active.iter_rows(min_row=4,values_only=True))
 assert len(wr)==14 and {r[0] for r in wr}=={'2026-11-17'}
 click('Daily TDL');history=[];counts={};samples=[]
 for week in range(12):
  for offset in range(3):
   day=date(2026,11,17)+timedelta(weeks=week,days=offset)
   choose(day)
   if day!=date(2026,11,17):
    expect(page.locator('.employee-checklist input:checked')).to_have_count(0)
    click('Select all');click('Save attendance');wait(lambda s:s['days'].get(str(day),{}).get('status')=='attendance_entered')
    click('Generate TDL');wait(lambda s:current(s,str(day)) is not None)
   gen=queues();flat=[(q,e) for q,es in gen.items() for e in es]
   assert len(flat)==14 and len({e['id'] for _,e in flat})==14
   for q in ('EDS','MSM'):
    eligible=[e for e in gen[q] if e['level']=='L0'];chosen=[e for e in eligible if e.get('sprt')==q+' SPRT'];assert len(chosen)==1
    assert counts.get((chosen[0]['id'],q),0)==min(counts.get((e['id'],q),0) for e in eligible)
    counts[chosen[0]['id'],q]=counts.get((chosen[0]['id'],q),0)+1
   if day!=date(2026,11,17):finalize()
   history.extend(dict(date=str(day),employee_id=e['id'],level=e['level'],queue=q,sprt=e.get('sprt','')) for q,e in flat)
   if offset==0:samples.append({'date':str(day),'Backlogs':[e['name'] for e in gen['Backlogs']]})
 s=state();assert len(s['days'])==36
 assert all(d['status']=='finalized' for d in s['days'].values())
 assert not errors,errors
 page.screenshot(path=str(out/'final-allocation.png'),full_page=True)
 (out/'summary.json').write_text(json.dumps({'days':36,'assignments':504,'sprt_counts':{f'{eid}:{q}':count for (eid,q),count in counts.items()},'tuesdays':samples,'browser_errors':errors},indent=2))
 print('Evidence:',out)
 print('PASS: static app, no login; IndexedDB reload; same-date regeneration; manual SPRT replacement; daily/weekly workbooks; 36 finalized UI dates / 504 assignments; lowest eligible SPRT counts; no JS errors.')
 b.close()
