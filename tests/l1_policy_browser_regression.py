"""Exercise the five-L1 policy, manual warnings, reload, finalization and Excel."""
from pathlib import Path
from functools import partial
from threading import Thread
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone
import tempfile, time
import openpyxl
from playwright.sync_api import sync_playwright, expect

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever, daemon=True).start()
out = Path(tempfile.mkdtemp(prefix='tdl-l1-policy-'))
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium')
        page = browser.new_page(viewport={'width':1484,'height':900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.clock.install(time=datetime(2026,11,24,12,tzinfo=timezone.utc))
        page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
        def click(name):page.get_by_role('button',name=name,exact=True).click()
        def generation():
            return page.evaluate('''()=>new Promise((resolve,reject)=>{
                const r=indexedDB.open('tdl-local-workspace',1);r.onerror=()=>reject(r.error);
                r.onsuccess=()=>{const db=r.result;const q=db.transaction('workspace','readonly').objectStore('workspace').get('state');
                q.onsuccess=()=>{const d=q.result?.days['2026-11-24'];resolve(d?.generations.find(g=>g.id===d.current_generation_id));db.close()}}})''')
        def wait_for(predicate):
            end=time.monotonic()+10
            while time.monotonic()<end:
                gen=generation()
                if gen and predicate(gen):return gen
                time.sleep(.05)
            raise AssertionError('Saved allocation condition not met')
        def counts(gen):return [sum(e['level']=='L1' for e in gen['queues'][q]) for q in ('EDS','MSM','Backlogs')]
        click('Daily TDL');click('Select all')
        page.locator('.check-row').filter(has_text='Demo Member 07').click()
        expect(page.locator('.check-row').filter(has_text='Demo Member 07').locator('input')).not_to_be_checked()
        click('Save attendance');click('Generate TDL')
        gen=wait_for(lambda g:counts(g)==[2,2,1])
        assert any(w.startswith('Backlogs: L1 pairing') for w in gen['warnings'])
        assert not any(w.startswith('MSM: L1') for w in gen['warnings'])
        click('Validate TDL');page.reload(wait_until='networkidle');click('Daily TDL')
        assert counts(generation())==[2,2,1]
        msm=next(e for e in gen['queues']['MSM'] if e['level']=='L1')
        backlog=next(e for e in gen['queues']['Backlogs'] if e['level']=='L0')
        for member,queue in [(msm,'Backlogs'),(backlog,'MSM')]:
            page.get_by_role('combobox',name='Queue for '+member['name'],exact=True).click()
            page.get_by_role('option',name=queue,exact=True).click()
        click('Save assignments')
        edited=wait_for(lambda g:counts(g)==[2,1,2])
        assert any(w.startswith('MSM: L1 pairing') for w in edited['warnings'])
        assert not any(w.startswith('Backlogs: L1') for w in edited['warnings'])
        click('Validate TDL');click('Finalize TDL')
        wait_for(lambda g:g['status']=='finalized')
        # A finalized generation stays unchanged on reload; regeneration is explicit.
        page.reload(wait_until='networkidle');click('Daily TDL')
        assert counts(generation())==[2,1,2]
        with page.expect_download() as download:click('Export Excel')
        workbook=out/'five-l1.xlsx';download.value.save_as(workbook)
        assert openpyxl.load_workbook(workbook).sheetnames
        page.once('dialog',lambda d:d.accept());click('Regenerate TDL')
        wait_for(lambda g:g['number']==2 and counts(g)==[2,2,1])
        page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/'five-l1.png'),full_page=True)
        assert not errors,errors
        browser.close()
finally:server.shutdown()
print('PASS: five L1s = EDS 2 / MSM 2 / Backlogs 1; manual warning recomputation, reload, finalization, export, explicit regeneration. Evidence:',out)
