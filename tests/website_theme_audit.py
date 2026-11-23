"""Whole-site layout and font audit. Uses only isolated demo browser data."""
from pathlib import Path
from functools import partial
from threading import Thread
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
import os,json,tempfile
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
themes={'high-contrast':'High Contrast','dark-minimal':'Dark Minimal','monochrome':'Monochrome','swiss-grid':'Swiss Grid'}
views=['Overview','Daily TDL','Team','Weekly view','History','Analytics','Local data']
widths=[1440,1280,1024,768,560,390,360]
out=Path(tempfile.mkdtemp(prefix='tdl-whole-site-audit-'));errors=[];fonts=[];preview_signatures={}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER','/usr/bin/chromium'))
  page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc));page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(name):page.get_by_role('button',name=name,exact=True).click()
  def switch(theme):
   page.get_by_role('combobox',name='Website theme',exact=True).click();page.get_by_role('option',name=themes[theme],exact=True).click()
  def bounded(element):
   r=element.bounding_box();v=page.viewport_size
   assert r and r['x']>=-1 and r['y']>=-1 and r['x']+r['width']<=v['width']+1 and r['y']+r['height']<=v['height']+1,(r,v)
  for name in ['Daily TDL','Select all','Save attendance','Generate TDL']:click(name)
  page.locator('.allocation-panel .queue-member').first.wait_for()
  for width in widths:
   page.set_viewport_size({'width':width,'height':1000})
   for theme in themes:
    switch(theme)
    for view in views:
     click(view)
     assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(theme,width,view)
     issues=page.evaluate('''()=>{
      const issues=[];const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const selector='.panel,.queue-card,.stat-card,.week-card,.secondary-editor,.workflow-bar,.swap-form,.duty-summary>div,.page-heading,.attendance-summary';
      for(const box of document.querySelectorAll(selector)){
       if(!visible(box))continue;const r=box.getBoundingClientRect();const style=getComputedStyle(box);
       if(box.scrollWidth>box.clientWidth+2&&!['auto','scroll'].includes(style.overflowX))issues.push({box:box.className,excess:box.scrollWidth-box.clientWidth});
       for(const child of box.querySelectorAll('button,input,h1,h2,h3,label,.status-pill,.queue-tag')){
        if(!visible(child)||child.closest('.styled-select-menu,.calendar-popover,.theme-picker-menu')||child.closest(selector)!==box)continue;
        if(['auto','scroll'].includes(style.overflowX))continue;
        const c=child.getBoundingClientRect();if(c.left<r.left-2||c.right>r.right+2)issues.push({box:box.className,child:child.className||child.tagName,text:child.textContent?.slice(0,40)});
       }
      }
      const expected=getComputedStyle(document.body).fontFamily;
      for(const e of document.querySelectorAll('h1,h2,h3,.week-date b,.queue-card-head>b,.calendar-header>b,.theme-picker-trigger,.styled-select-trigger')){
       if(visible(e)&&getComputedStyle(e).fontFamily!==expected)issues.push({font:e.className||e.tagName,actual:getComputedStyle(e).fontFamily,expected});
      }
      return issues;
     }''')
     assert not issues,(theme,width,view,issues)
    click('Overview')
    page.get_by_role('combobox',name='Website theme').click();menu=page.get_by_role('listbox',name='Website theme');bounded(menu)
    for key in themes:
     option=menu.locator(f'[data-theme-preview="{key}"]')
     signature=option.evaluate("e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,font:getComputedStyle(e.querySelector('.theme-option-name')).fontFamily,radius:getComputedStyle(e).borderRadius})")
     if key in preview_signatures:assert preview_signatures[key]==signature
     else:preview_signatures[key]=signature
    if width in (1440,390):
     menu.screenshot(path=str(out/f'{theme}-menu-{width}.png'))
    page.keyboard.press('Escape')
    if width==390:
     click('Team');page.screenshot(path=str(out/f'{theme}-team-mobile.png'),full_page=True)
    fonts.append({'theme':theme,'width':width,'family':page.evaluate('getComputedStyle(document.body).fontFamily')})
  assert len({p['background'] for p in preview_signatures.values()})==4
  # Short screens must keep open menus and dialogs reachable, including landscape.
  for width,height in [(1440,900),(768,1024),(390,844),(360,640),(740,360)]:
   page.set_viewport_size({'width':width,'height':height})
   for theme in themes:
    switch(theme);trigger=page.get_by_role('combobox',name='Website theme');trigger.click();bounded(page.get_by_role('listbox',name='Website theme'));trigger.press('End');trigger.press('Escape')
    click('Daily TDL')
    for label in ['Substitute level','EDS HO assignee']:
     trigger=page.get_by_role('combobox',name=label,exact=True);trigger.click();bounded(page.get_by_role('listbox',name=label,exact=True));trigger.press('Escape')
    page.get_by_role('button',name='Working date,',exact=False).click();bounded(page.get_by_role('dialog',name='Working date',exact=True));page.keyboard.press('Escape')
    click('Team');click('Add employee');bounded(page.locator('.modal'))
    trigger=page.get_by_role('combobox',name='Employee level',exact=True);trigger.click();bounded(page.get_by_role('listbox',name='Employee level',exact=True));trigger.press('Escape');click('Cancel')
  # Long personal names are tested using a fictional example in disposable data.
  page.set_viewport_size({'width':390,'height':844});click('Team')
  page.get_by_role('button',name='Edit Demo Member 01',exact=True).click()
  long_name='FictionalMemberWithAnIntentionallyLongName For Layout Testing'
  page.get_by_label('Name',exact=True).fill(long_name);click('Save changes')
  expect(page.locator('.toast')).to_contain_text('Employee updated')
  for theme in themes:
   switch(theme);click('Team')
   for name in page.locator('.team-table-panel .table-person b').all():
    assert name.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
   page.screenshot(path=str(out/f'{theme}-long-name-mobile.png'),full_page=True)
  click('Daily TDL');click('Regenerate TDL')
  expect(page.locator('.allocation-panel .queue-member').filter(has_text=long_name).first).to_be_visible()
  for theme in themes:
   switch(theme)
   for name in page.locator('.allocation-panel .queue-member>span:not(.avatar)').all():
    assert name.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert not errors,errors
  browser.close()
finally:server.shutdown()
(out/'summary.json').write_text(json.dumps({'themes':list(themes),'pages':views,'widths':widths,'page_checks':len(themes)*len(views)*len(widths),'fonts':fonts,'theme_previews':preview_signatures,'browser_errors':errors},indent=2))
print('PASS: 196 page/theme/width checks; contained cards/controls and consistent fonts; four distinct theme previews; short-screen popovers/dialogs. Evidence:',out)
