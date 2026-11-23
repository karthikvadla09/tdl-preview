"""Theme integration test against the static app; isolated browser data only."""
import os,tempfile,json
from pathlib import Path
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
base=os.environ.get('TDL_TEST_URL','http://127.0.0.1:6094/')
themes=['high-contrast','dark-minimal','monochrome','swiss-grid']
views=['Overview','Daily TDL','Team','Weekly view','History','Analytics','Local data']
out=Path(tempfile.mkdtemp(prefix='tdl-theme-evidence-'))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER','/usr/bin/chromium'))
 context=browser.new_context(viewport={'width':1440,'height':1000})
 page=context.new_page();errors=[];remote=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:remote.append(r.url) if r.url.startswith(('http:','https:')) and not r.url.startswith(base.rsplit('/',1)[0]) else None)
 page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc))
 page.goto(base,wait_until='networkidle')
 def click(name):page.get_by_role('button',name=name,exact=True).click()
 def switch(theme):
  page.get_by_role('combobox',name='Website theme',exact=True).select_option(theme)
  expect(page.locator('html')).to_have_attribute('data-theme',theme)
 def state():
  return page.evaluate("""()=>new Promise((resolve,reject)=>{const r=indexedDB.open('tdl-local-workspace',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace');const q=tx.objectStore('workspace').get('state');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}})""")
 for name in ['Daily TDL','Select all','Save attendance','Generate TDL']:click(name)
 page.locator('.allocation-panel .queue-member').first.wait_for()
 saved=state()
 signatures={}
 for width in (1440,1024,768,390,360):
  page.set_viewport_size({'width':width,'height':1000})
  for theme in themes:
   switch(theme)
   for view in views:
    click(view)
    assert page.locator('.page-heading h1').is_visible(),(theme,width,view)
    picker=page.get_by_role('combobox',name='Website theme',exact=True)
    assert picker.is_visible()
    box=picker.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1,(theme,width,box)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(theme,width,view)
   click('Overview')
   assert page.locator('#tdl-active-theme').count()==1
   assert state()==saved,'Appearance changed workspace data'
   if width==1440:
    signatures[theme]=page.evaluate("[getComputedStyle(document.querySelector('.sidebar')).backgroundColor,getComputedStyle(document.querySelector('.hero-card')).backgroundColor,document.querySelector('.hero-card h2').textContent]")
    page.screenshot(path=str(out/f'{theme}-desktop.png'),full_page=True)
   if width==390:page.screenshot(path=str(out/f'{theme}-mobile.png'),full_page=True)
 # A repeated switching sequence must reproduce each theme without accumulated rules.
 page.set_viewport_size({'width':1440,'height':1000})
 for theme in themes[::-1]+themes:
  switch(theme)
  assert signatures[theme]==page.evaluate("[getComputedStyle(document.querySelector('.sidebar')).backgroundColor,getComputedStyle(document.querySelector('.hero-card')).backgroundColor,document.querySelector('.hero-card h2').textContent]")
  page.reload(wait_until='networkidle');expect(page.get_by_role('combobox',name='Website theme')).to_have_value(theme)
  assert state()==saved
 # Another tab picks up persisted selection and synchronizes changes.
 other=context.new_page();other.goto(base,wait_until='networkidle')
 expect(other.get_by_role('combobox',name='Website theme')).to_have_value(themes[-1])
 other.get_by_role('combobox',name='Website theme').select_option('dark-minimal')
 expect(page.locator('html')).to_have_attribute('data-theme','dark-minimal')
 other.close()
 click('Daily TDL');click('Validate TDL');click('Finalize TDL')
 expect(page.get_by_role('button',name='Save HO and mail assignments',exact=True)).to_be_disabled()
 with page.expect_download() as dl:click('Export Excel')
 assert dl.value.failure() is None
 assert not errors and not remote,(errors,remote)
 context.close()
 for mode in ('invalid','blocked'):
  context=browser.new_context();page=context.new_page();failures=[];page.on('pageerror',lambda e:failures.append(str(e)))
  if mode=='invalid':page.add_init_script("localStorage.setItem('tdl-appearance-theme','not-a-real-theme')")
  else:page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError')}})")
  page.goto(base,wait_until='networkidle');expect(page.locator('html')).to_have_attribute('data-theme','high-contrast')
  for theme in themes:switch(theme)
  assert not failures,failures
  context.close()
 browser.close()
(out/'summary.json').write_text(json.dumps({'themes':themes,'viewports':[1440,1024,768,390,360],'pages_per_theme':views,'workspace_unchanged':True,'reload_and_cross_tab':True,'blocked_or_invalid_storage':True,'browser_errors':errors},indent=2))
print('PASS: four themes, seven pages, five widths; no overflow/errors or workspace changes; reload/cross-tab persistence, invalid/blocked storage, finalize and Excel. Evidence:',out)
