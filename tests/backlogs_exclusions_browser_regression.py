"""Static-site Backlogs opt-outs, persistence, imports, exports and confirmation."""
from pathlib import Path
from functools import partial
from threading import Thread
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone
import json, tempfile, time, copy
import openpyxl
from playwright.sync_api import sync_playwright, expect

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
out=Path(tempfile.mkdtemp(prefix='tdl-backlogs-exclusions-'))
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium')
  page=browser.new_page(viewport={'width':1484,'height':900});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,11,24,12,tzinfo=timezone.utc))
  page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(name):page.get_by_role('button',name=name,exact=True).click()
  def state():
   return page.evaluate('''()=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('tdl-local-workspace',1);r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{const db=r.result;const q=db.transaction('workspace','readonly').objectStore('workspace').get('state');
    q.onsuccess=()=>{resolve(q.result);db.close()}}})''')
  def day():return state()['days']['2026-11-24']
  def current():
   d=day();return next((g for g in d['generations'] if g['id']==d.get('current_generation_id')),None)
  def wait(fn):
   end=time.monotonic()+10
   while time.monotonic()<end:
    if fn():return
    time.sleep(.05)
   raise AssertionError('Saved state condition not met')
  def panel():return page.locator('details').filter(has=page.locator('summary',has_text='Backlogs exclusions'))
  def open_panel():
   if panel().get_attribute('open') is None:panel().locator('summary').click()
  def restore(path):
   click('Local data');page.once('dialog',lambda d:d.accept());page.locator('input[type=file]').set_input_files(path)
   expect(page.locator('.toast')).to_contain_text('Backup restored')
  click('Daily TDL');click('Select all');click('Save attendance');click('Generate TDL');wait(lambda:current() is not None)
  original=current();saved_att=copy.deepcopy(day()['attendance'])
  targets=[next(e for e in original['queues']['Backlogs'] if e['level']==level) for level in ['L0','L1']]
  ids=sorted(e['id'] for e in targets)
  open_panel()
  for employee in targets:panel().get_by_role('checkbox',name=employee['name'],exact=False).check()
  click('Save Backlogs exclusions');wait(lambda:current() is None)
  assert day()['attendance']==saved_att and day()['generations'][0]['status']=='superseded'
  assert day()['exclusions']['backlogs']==ids
  click('Generate TDL');wait(lambda:current() is not None)
  assert not set(ids)&{e['id'] for e in current()['queues']['Backlogs']}
  open_panel();panel().screenshot(path=str(out/'backlogs-panel.png'))
  for employee in targets:
   trigger=page.get_by_role('combobox',name='Queue for '+employee['name'],exact=True);trigger.click()
   expect(page.get_by_role('listbox',name='Queue for '+employee['name']).get_by_role('option',name='Backlogs',exact=True)).to_have_count(0)
   trigger.press('Escape')
  page.reload(wait_until='networkidle');click('Daily TDL');open_panel()
  for employee in targets:expect(panel().get_by_role('checkbox',name=employee['name'],exact=False)).to_be_checked()
  click('Validate TDL');click('Finalize TDL');wait(lambda:day()['status']=='finalized')
  open_panel();expect(page.get_by_role('button',name='Save Backlogs exclusions',exact=True)).to_be_disabled()
  with page.expect_download() as downloaded:click('Export Excel')
  daily=out/'daily.xlsx';downloaded.value.save_as(daily)
  rows=list(openpyxl.load_workbook(daily).active.values)
  row=next(row for row in rows if row[0]=='Backlogs exclusions')
  assert all(e['name'] in row[1] for e in targets)
  click('Weekly view')
  with page.expect_download() as downloaded:click('Export finalized days')
  weekly=out/'weekly.xlsx';downloaded.value.save_as(weekly)
  exclusion_rows=list(openpyxl.load_workbook(weekly)['Backlogs exclusions'].values)
  assert all(e['name'] in exclusion_rows[1][1] for e in targets)
  click('Local data')
  with page.expect_download() as downloaded:click('Download backup')
  backup=out/'workspace.json';downloaded.value.save_as(backup);saved=json.loads(backup.read_text())
  assert saved['state']['days']['2026-11-24']['exclusions']['backlogs']==ids
  click('Daily TDL');open_panel()
  panel().get_by_role('checkbox',name=targets[0]['name'],exact=False).uncheck()
  page.once('dialog',lambda d:d.dismiss());click('Save Backlogs exclusions')
  assert day()['status']=='finalized' and day()['exclusions']['backlogs']==ids
  page.once('dialog',lambda d:d.accept());click('Save Backlogs exclusions');wait(lambda:current() is None)
  assert day()['attendance']==saved_att
  restore(backup);assert day()['exclusions']['backlogs']==ids and current()['status']=='finalized'
  # Backups predating the new field still load with no Backlogs opt-outs.
  legacy=copy.deepcopy(saved);legacy['state']['days']['2026-11-24']['exclusions'].pop('backlogs')
  legacy_file=out/'legacy.json';legacy_file.write_text(json.dumps(legacy));restore(legacy_file)
  assert not day().get('exclusions',{}).get('backlogs')
  # Invalid imported assignments cannot bypass date exclusions or finalization.
  invalid=copy.deepcopy(saved);d=invalid['state']['days']['2026-11-24'];g=next(g for g in d['generations'] if g['id']==d['current_generation_id'])
  violation=g['queues']['Backlogs'][0]['id'];d['exclusions']['backlogs'].append(violation)
  d['status']='tdl_generated';g['status']='draft'
  invalid_file=out/'invalid.json';invalid_file.write_text(json.dumps(invalid));restore(invalid_file)
  click('Daily TDL');click('Validate TDL')
  wait(lambda:any('Backlogs date exclusion violation' in w for w in current()['warnings']))
  click('Finalize TDL');expect(page.locator('.error-banner').first).to_contain_text('Backlogs date exclusion violation')
  assert day()['status']!='finalized'
  # Recovered backup retains normal roster and all exclusions across mobile widths.
  restore(backup);click('Daily TDL');open_panel();page.clock.run_for(4000)
  page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/'daily-backlogs.png'),full_page=True)
  for width in [390,360]:
   page.set_viewport_size({'width':width,'height':844});open_panel()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   panel().screenshot(path=str(out/f'backlogs-panel-{width}.png'))
  # Regular members keep hidden exclusions while substitutes have their own IDs.
  page.set_viewport_size({'width':1484,'height':900})
  original=targets[1]
  page.get_by_role('combobox',name='Team member to replace',exact=True).click()
  page.get_by_role('option',name=original['name'],exact=True).click()
  page.get_by_placeholder('Name from the other team').fill('Fictional Backlogs Cover')
  page.get_by_placeholder('Team name',exact=True).fill('Example Team')
  page.once('dialog',lambda d:d.accept());click('Add substitute')
  wait(lambda:len(day()['swaps'])==1)
  proxy=day()['swaps'][0]['substitute_employee_id']
  assert original['id'] in day()['exclusions']['backlogs'] and proxy not in day()['exclusions']['backlogs']
  open_panel();expect(panel().get_by_role('checkbox',name='Fictional Backlogs Cover',exact=False)).not_to_be_checked()
  expect(panel().get_by_role('checkbox',name=original['name'],exact=False)).to_have_count(0)
  panel().get_by_role('checkbox',name='Fictional Backlogs Cover',exact=False).check();click('Save Backlogs exclusions')
  wait(lambda:proxy in day()['exclusions']['backlogs'])
  assert original['id'] in day()['exclusions']['backlogs']
  page.locator('.swap-item').get_by_role('button',name='Remove',exact=True).click();wait(lambda:not day()['swaps'])
  open_panel();expect(panel().get_by_role('checkbox',name=original['name'],exact=False)).to_be_checked()
  # Other working dates start with no date-specific exclusions.
  other=browser.new_page();other.clock.install(time=datetime(2026,11,25,12,tzinfo=timezone.utc))
  other.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle');other.get_by_role('button',name='Daily TDL',exact=True).click()
  expect(other.locator('summary',has_text='Backlogs exclusions')).to_have_text('Backlogs exclusions (0)')
  assert not errors,errors
  browser.close()
finally:server.shutdown()
print('PASS: Backlogs checklist, L0/L1 blocks, invalidation, manual options, reload, finalized confirmation, old/new backup restore, imported validation, daily/weekly export, date scope and mobile layout. Evidence:',out)
