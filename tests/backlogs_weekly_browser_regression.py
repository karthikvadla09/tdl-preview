"""Reproduce the uploaded weekly rotation pattern using fictional names only."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from datetime import datetime,timezone
import json,tempfile,time,copy
from playwright.sync_api import sync_playwright,expect
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
root=Path(__file__).resolve().parents[1]
case=json.loads((root/'tests/fixtures/backlogs-weekly-reproduction.json').read_text())
out=Path(tempfile.mkdtemp(prefix='tdl-backlogs-weekly-'))
people={e['id']:dict(e,active=True) for e in case['employees']}
for row in case['history']:
 if row['employee_id'] not in people:
  i=row['employee_id'];people[i]=dict(id=i,name=f'Demo Member {i:02}',level=row['level'],eds_access=True,restrictions='',active=False)
state={'nextId':100,'employees':list(people.values()),'days':{}}
for row in case['history']:
 d=state['days'].setdefault(row['date'],{'status':'finalized','attendance':{},'swaps':[],'generations':[],'current_generation_id':None,'audit':[]})
 if not d['generations']:
  g={'id':state['nextId'],'number':1,'status':'finalized','warnings':[],'queues':{'EDS':[],'MSM':[],'Backlogs':[]},'created_at':row['date']+'T12:00:00Z'}
  state['nextId']+=1;d['generations']=[g];d['current_generation_id']=g['id']
 g=d['generations'][0];e=people[row['employee_id']]
 g['queues'][row['queue']].append(dict(id=e['id'],name=e['name'],level=e['level'],sprt=row.get('sprt','')));d['attendance'][str(e['id'])]=True
state['days'][case['day']]={'status':'attendance_entered','attendance':{str(e['id']):True for e in case['employees']},'swaps':[],'generations':[],'current_generation_id':None,'audit':[]}
backup=out/'fixture.json';backup.write_text(json.dumps({'format':'tdl-workspace','version':1,'state':state}))
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root)));Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium');page=b.new_page(viewport={'width':1484,'height':900})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,11,26,12,tzinfo=timezone.utc));page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(n):page.get_by_role('button',name=n,exact=True).click()
  def current():return page.evaluate('''()=>new Promise(resolve=>{const r=indexedDB.open('tdl-local-workspace',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('workspace','readonly').objectStore('workspace').get('state');q.onsuccess=()=>{const d=q.result.days['2026-11-26'];resolve(d.generations.find(g=>g.id===d.current_generation_id));db.close()}}})''')
  def wait(fn):
   end=time.monotonic()+10
   while time.monotonic()<end:
    g=current()
    if g and fn(g):return g
    time.sleep(.05)
   raise AssertionError('Saved state condition not met')
  click('Local data');page.once('dialog',lambda d:d.accept());page.locator('input[type=file]').set_input_files(backup)
  expect(page.locator('.toast')).to_contain_text('Backup restored')
  click('Daily TDL');click('Generate TDL');g=wait(lambda g:bool(g['queues']['Backlogs']))
  used={r['employee_id'] for r in case['history'] if r['queue']=='Backlogs' and '2026-11-23'<=r['date']<'2026-11-26'}
  assert not used & {e['id'] for e in g['queues']['Backlogs']}
  assert [sum(e['level']=='L1' for e in g['queues'][q]) for q in ['EDS','MSM','Backlogs']]==[2,2,1]
  assert any('previous-week L0 restriction relaxed' in w for w in g['warnings'])
  for i in [14,8]:
   trigger=page.get_by_role('combobox',name=f'Queue for Demo Member {i:02}',exact=True);trigger.click()
   expect(page.get_by_role('listbox',name=f'Queue for Demo Member {i:02}').get_by_role('option',name='Backlogs',exact=True)).to_have_count(0)
   trigger.press('Escape')
  # Manual edits of permitted assignments must retain the valid fallback.
  click('Save assignments');click('Validate TDL');click('Finalize TDL');wait(lambda g:g['status']=='finalized')
  page.reload(wait_until='networkidle');click('Daily TDL');assert current()['status']=='finalized'
  page.clock.run_for(4000);page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/'weekly-fallback.png'),full_page=True)
  assert not errors,errors;b.close()
finally:server.shutdown()
print('PASS: uploaded-pattern weekly ban, minimum last-week fallback, L1 priority, manual options/saves, validation, finalization and reload. Evidence:',out)
