"""Checks the eight marked theme details and actual search filtering using demo data."""
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
out=Path(tempfile.mkdtemp(prefix='tdl-theme-details-'))
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium');page=browser.new_page(viewport={'width':1484,'height':726})
  page.clock.install(time=datetime(2026,11,19,12,tzinfo=timezone.utc));page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
  def click(n):page.get_by_role('button',name=n,exact=True).click()
  for n in ['Daily TDL','Select all','Save attendance','Generate TDL']:click(n)
  page.clock.run_for(4000)
  for theme,label in themes.items():
   page.get_by_role('combobox',name='Website theme').click();page.get_by_role('option',name=label,exact=True).click()
   names=page.locator('.allocation-panel .queue-grid.compact').first.locator('.queue-member>span:nth-child(2)')
   expect(names).to_have_count(14)
   for el in names.all():
    assert el.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')==(13 if theme=='high-contrast' else 12)
   assert page.locator('.attendance-summary small').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=11
   page.screenshot(path=str(out/f'{theme}-daily.png'),full_page=True)
   if theme=='high-contrast':
    page.locator('.attendance-summary').screenshot(path=str(out/'attendance-summary.png'))
    page.locator('.queue-grid.compact').first.screenshot(path=str(out/'queue-cards.png'))
  page.get_by_role('combobox',name='Website theme').click();page.get_by_role('option',name='High Contrast',exact=True).click()
  click('Validate TDL');click('Finalize TDL');page.clock.run_for(4000)
  click('History');field=page.get_by_role('searchbox',name='Search history');field.fill('Demo Member 14')
  expect(page.locator('.table-panel tbody tr')).to_have_count(1)
  field.fill('');expect(page.locator('.table-panel tbody tr')).to_have_count(14)
  page.screenshot(path=str(out/'history.png'),full_page=True)
  click('Team');page.get_by_role('searchbox',name='Search team members').fill('Demo Member 14');expect(page.locator('tbody tr')).to_have_count(1)
  page.screenshot(path=str(out/'team-search.png'),full_page=True)
  browser.close()
finally:server.shutdown()
print('PASS: generated queue typography and actual Team/History filtering',out)
