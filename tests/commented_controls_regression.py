"""Regression checks for the user's nine marked layout/font examples."""
from pathlib import Path
from functools import partial
from threading import Thread
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
import json,tempfile,os
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])));Thread(target=server.serve_forever,daemon=True).start()
out=Path(tempfile.mkdtemp(prefix='tdl-comment-controls-'));errors=[];measurements=[]
themes={'high-contrast':'High Contrast','dark-minimal':'Dark Minimal','monochrome':'Monochrome','swiss-grid':'Swiss Grid'}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER','/usr/bin/chromium'));page=browser.new_page()
  page.on('pageerror',lambda e:errors.append(str(e)));page.clock.install(time=datetime(2026,11,19,12,tzinfo=timezone.utc))
  page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(name):page.get_by_role('button',name=name,exact=True).click()
  def switch(theme):page.get_by_role('combobox',name='Website theme').click();page.get_by_role('option',name=themes[theme],exact=True).click()
  def contained(inner,outer):
   a,b=inner.bounding_box(),outer.bounding_box()
   assert a and b and a['x']>=b['x']-1 and a['y']>=b['y']-1 and a['x']+a['width']<=b['x']+b['width']+1 and a['y']+a['height']<=b['y']+b['height']+1,(a,b)
  for width,height in [(1484,726),(1024,768),(768,1024),(390,844),(360,640)]:
   page.set_viewport_size({'width':width,'height':height})
   for theme in themes:
    switch(theme);click('Daily TDL')
    inputs=page.locator('.swap-form input:not([type=checkbox]),.swap-form .styled-select-trigger,.swap-form>.btn')
    sizes=inputs.evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')
    assert max(sizes)-min(sizes)<=1,(theme,width,sizes)
    for control in inputs.all():contained(control,page.locator('.temporary-swap-panel'))
    for control in page.locator('.swap-form input:not([type=checkbox]),.swap-form .styled-select-trigger').all():contained(control,control.locator('..') if control.evaluate('(e)=>e.parentElement.tagName===\"LABEL\"') else control.locator('../..'))
    contained(page.locator('.date-select .calendar-trigger'),page.locator('.workflow-bar'))
    assert page.locator('.date-select').evaluate('(e)=>getComputedStyle(e).borderTopWidth')=='0px'
    fonts=page.locator('.theme-control>span,.theme-picker-trigger,.date-select>label,.date-select>small,.swap-heading b,.swap-form>label').evaluate_all('(els)=>({expected:getComputedStyle(document.body).fontFamily,actual:els.map(e=>getComputedStyle(e).fontFamily)})')
    assert all(font==fonts['expected'] for font in fonts['actual']),(theme,fonts)
    if width==1484:
     page.screenshot(path=str(out/f'{theme}-daily.png'),full_page=True)
     for selector,name in [('.workflow-bar','working-date'),('.temporary-swap-panel','substitute'),('.theme-control','theme-selector')]:page.locator(selector).screenshot(path=str(out/f'{theme}-{name}.png'))
    for view in ('Team','History'):
     click(view);box=page.locator('.search-box');field=box.locator('input');contained(field,box)
     assert abs(box.bounding_box()['height']-page.locator('.toolbar .styled-select-trigger').first.bounding_box()['height'])<=1,(theme,width,view)
     assert field.evaluate('(e)=>getComputedStyle(e).fontFamily')==page.evaluate('getComputedStyle(document.body).fontFamily')
     if view=='History':
      for caption in page.locator('.history-filters .calendar-trigger>span').all():assert caption.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
      text=page.locator('.empty-state');expect(text).to_be_visible()
      assert text.locator('b,span').evaluate_all('(els)=>els.every(e=>getComputedStyle(e).fontFamily===getComputedStyle(document.body).fontFamily)')
      assert float(text.locator('b').evaluate('(e)=>getComputedStyle(e).fontSize').replace('px',''))>=12
     if width==1484:
      page.screenshot(path=str(out/f'{theme}-{view.lower()}.png'),full_page=True)
      page.locator('.toolbar').screenshot(path=str(out/f'{theme}-{view.lower()}-search.png'))
      if view=='History':text.screenshot(path=str(out/f'{theme}-empty-history.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(theme,width)
    measurements.append({'theme':theme,'width':width,'control_heights':sizes})
  # The resized form still submits a valid date-specific substitute.
  click('Daily TDL')
  page.get_by_role('combobox',name='Team member to replace',exact=True).click();page.get_by_role('option',name='Demo Member 01',exact=True).click()
  page.get_by_placeholder('Name from the other team').fill('Fictional Cover')
  page.get_by_placeholder('Team name',exact=True).fill('Example team')
  click('Add substitute');expect(page.locator('.toast')).to_contain_text('Temporary substitute added')
  assert not errors,errors
  browser.close()
finally:server.shutdown()
(out/'summary.json').write_text(json.dumps(measurements,indent=2))
print('PASS: nine marked cases across four themes/five viewports; aligned form heights, contained searches, correct fonts, date layout, empty state and substitute submission. Evidence:',out)
