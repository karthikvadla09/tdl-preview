"""Check theme-matched dropdown triggers, menus, and keyboard interaction."""
import os,json,tempfile
from pathlib import Path
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
base=os.environ.get('TDL_TEST_URL','http://127.0.0.1:6194/')
labels={'swiss-grid':'Swiss Grid'}
out=Path(tempfile.mkdtemp(prefix='tdl-dropdown-evidence-'))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium');page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc));page.goto(base,wait_until='networkidle')
 def click(name):page.get_by_role('button',name=name,exact=True).click()
 def assert_surface(element):
  assert element.evaluate("""e=>{const probe=document.createElement('div');probe.style.backgroundColor='var(--picker-menu)';document.body.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return getComputedStyle(e).backgroundColor===color}"""),element.evaluate('(e)=>getComputedStyle(e).backgroundColor')
 def check_select(label):
  trigger=page.get_by_role('combobox',name=label,exact=True);trigger.click()
  menu=page.get_by_role('listbox',name=label,exact=True);expect(menu).to_be_visible();assert_surface(menu)
  assert menu.get_by_role('option').count()>0
  rect=menu.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=page.viewport_size['width']+1,(label,page.viewport_size,rect)
  if label=='Team filter' and width==1440:menu.screenshot(path=str(out/f'{theme}-team-filter.png'))
  trigger.press('Escape');expect(menu).not_to_be_visible()
 for name in ['Daily TDL','Select all','Save attendance','Generate TDL']:click(name)
 page.locator('.allocation-panel .queue-member').first.wait_for()
 for width in (1440,390):
  page.set_viewport_size({'width':width,'height':1000})
  for theme in labels:
   click('Daily TDL')
   for label in ['Team member to replace','Substitute level','EDS HO assignee','MSM HO assignee','TDL mail assignee']:
    check_select(label)
   queue=page.locator('.manual-editor [role=combobox]').first
   check_select(queue.get_attribute('aria-label'))
   date_trigger=page.get_by_role('button',name='Working date,',exact=False);date_trigger.click()
   calendar=page.get_by_role('dialog',name='Working date',exact=True);assert_surface(calendar)
   rect=calendar.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=width+1
   if width==1440:calendar.screenshot(path=str(out/f'{theme}-calendar.png'))
   calendar.get_by_role('button',name='Next month',exact=True).click();calendar.get_by_role('button',name='Previous month',exact=True).click()
   page.keyboard.press('Escape');expect(calendar).not_to_be_visible()
   click('Team');check_select('Team filter');click('Add employee');check_select('Employee level');click('Cancel')
   click('History')
   for label in ['Queue filter','Level filter']:check_select(label)
   for label in ['Start date','End date','Week filter']:
    page.get_by_role('button',name=label,exact=True).click();popup=page.get_by_role('dialog',name=label,exact=True);assert_surface(popup)
    rect=popup.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=width+1,(label,width,rect)
    page.keyboard.press('Escape')
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close()
print('PASS: all dropdown families and date popovers match Swiss Grid on desktop/mobile; menu bounds, selected state, keyboard, and dismissal. Evidence:',out)
