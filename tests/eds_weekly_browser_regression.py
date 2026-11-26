"""EDS weekly warnings use the regular pair even when one member is absent."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
import time,tempfile
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
out=Path(tempfile.mkdtemp(prefix='tdl-eds-weekly-'))
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium');page=browser.new_page(viewport={'width':1484,'height':900})
  page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(name):page.get_by_role('button',name=name,exact=True).click()
  def current():return page.evaluate('''()=>new Promise(resolve=>{const r=indexedDB.open('tdl-local-workspace',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('workspace','readonly').objectStore('workspace').get('state');q.onsuccess=()=>{const d=q.result.days['2026-11-17'];resolve(d.generations.find(g=>g.id===d.current_generation_id));db.close()}}})''')
  def wait(fn):
   end=time.monotonic()+10
   while time.monotonic()<end:
    g=current()
    if g and fn(g):return g
    time.sleep(.05)
   raise AssertionError('Saved generation condition not met')
  click('Daily TDL');click('Select all');page.locator('.check-row').filter(has_text='Demo Member 05').click()
  click('Save attendance');click('Generate TDL')
  g=wait(lambda g:any(w.startswith('EDS weekly L0') for w in g['warnings']))
  assert all(e['id']!=5 for e in g['queues']['EDS'])
  expect(page.locator('.warning-list')).to_contain_text('EDS weekly L0 rotation preference relaxed')
  click('Validate TDL');click('Finalize TDL');wait(lambda g:g['status']=='finalized')
  page.reload(wait_until='networkidle');click('Daily TDL')
  expect(page.locator('.warning-list')).to_contain_text('EDS weekly L0 rotation preference relaxed')
  # Restoring availability and explicitly regenerating removes the stale warning.
  click('Select all');page.once('dialog',lambda d:d.accept());click('Save attendance')
  click('Generate TDL');g=wait(lambda g:g['number']==2 and any(e['id']==5 for e in g['queues']['EDS']))
  assert not any(w.startswith('EDS weekly L0') for w in g['warnings'])
  click('Validate TDL');page.clock.run_for(4000);page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/'eds-weekly.png'),full_page=True)
  assert not errors,errors
  browser.close()
finally:server.shutdown()
print('PASS: full-roster weekly preference, absence warning, validation/finalization/reload, explicit regeneration and stale-warning removal. Evidence:',out)
