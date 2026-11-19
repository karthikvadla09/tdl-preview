"""Draft duty editing integration tests; run frontend Vite on port 5173."""
import os
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import openpyxl
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER','/usr/bin/chromium'))
    context=browser.new_context()
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/',wait_until='networkidle')
    result=page.evaluate('''async()=>{
      const {localApi:api,exportBackup}=await import('/src/localApi.ts');
      const assert=(v,m)=>{if(!v)throw Error(m)};
      const call=(action='',method='GET',body={},date='2026-11-17')=>api(`/day/${date}${action?'/'+action:''}`,{method,body:JSON.stringify(body)});
      const rejected=async(body,pattern)=>{
        const before=await exportBackup();let error;
        try{await call('secondary-assignments','PUT',body)}catch(e){error=e.message}
        assert(error&&pattern.test(error),`Expected rejection, got ${error}`);
        assert(await exportBackup()===before,'Rejected edit changed persisted state');
      };
      const roster=(await call()).employees;
      await call('attendance','PUT',{present_ids:roster.map(e=>e.id)});
      let gen=await call('generate','POST');
      const payload=g=>({generation_id:g.id,eds_ho_id:g.secondary.EDS?.id??null,msm_ho_id:g.secondary.MSM?.id??null,mail_sender_id:g.secondary['TDL mail sender']?.id??null});
      const old=payload(gen);
      const l0=gen.queues.EDS.find(e=>e.level==='L0');
      for(const [overrides,pattern] of [
        [{eds_ho_id:99999},/present/], [{eds_ho_id:gen.queues.MSM[0].id},/present/],
        [{mail_sender_id:roster.find(e=>e.level==='L1').id},/L0/],
        [{eds_ho_id:l0.id,mail_sender_id:l0.id},/different/],
        [{eds_ho_id:null},/Choose/], [{mail_sender_id:null},/Choose/],
        [{msm_ho_id:old.eds_ho_id},/different/], [{eds_ho_id:undefined},/positive/],
      ])await rejected({...old,...overrides},pattern);
      let chosen;
      for(const eds of gen.queues.EDS) for(const msm of gen.queues.MSM) for(const mail of roster.filter(e=>e.level==='L0')){
        if(mail.id!==eds.id&&mail.id!==msm.id&&eds.id!==old.eds_ho_id&&msm.id!==old.msm_ho_id&&mail.id!==old.mail_sender_id)
          chosen={generation_id:gen.id,eds_ho_id:eds.id,msm_ho_id:msm.id,mail_sender_id:mail.id};
      }
      assert(chosen,'No edit fixture');
      const originalQueues=JSON.stringify(gen.queues);
      gen=await call('secondary-assignments','PUT',chosen);
      assert(JSON.stringify(gen.queues)===originalQueues&&gen.id===old.generation_id,'Primary queues or generation changed');
      assert(gen.secondary.EDS.id===chosen.eds_ho_id&&gen.secondary.MSM.id===chosen.msm_ho_id&&gen.secondary['TDL mail sender'].id===chosen.mail_sender_id,'Selections not saved');
      const backup=JSON.parse(await exportBackup());
      assert(backup.state.days['2026-11-17'].audit.at(-1).event_type==='secondary_assignments_updated','Missing audit');
      assert((await call('validate','POST')).valid,'Edited duties invalid');
      await call('generate','POST');await rejected(chosen,/changed/);
      gen=(await call()).generation;
      await call('finalize','POST');await rejected(payload(gen),/draft/);
      // Date exclusions and absence must be rechecked, not trusted from the editor.
      const date='2026-11-18';
      await call('attendance','PUT',{present_ids:roster.filter(e=>e.id!==5).map(e=>e.id)},date);
      await call('ho-exclusions','PUT',{excluded_ids:[1]},date);
      await call('mail-exclusions','PUT',{excluded_ids:[6]},date);
      gen=await call('generate','POST',{},date);
      for(const overrides of [{eds_ho_id:1},{mail_sender_id:5},{mail_sender_id:6}]){
        const before=await exportBackup();let error;
        try{await call('secondary-assignments','PUT',{...payload(gen),...overrides},date)}catch(e){error=e.message}
        assert(error,'Invalid excluded/absent edit accepted');assert(before===await exportBackup(),'Invalid edit mutated state');
      }
      await call('ho-exclusions','PUT',{excluded_ids:roster.map(e=>e.id)},date);
      await call('mail-exclusions','PUT',{excluded_ids:roster.map(e=>e.id)},date);
      gen=await call('generate','POST',{},date);
      await call('secondary-assignments','PUT',{generation_id:gen.id,eds_ho_id:null,msm_ho_id:null,mail_sender_id:null},date);
      assert((await call('validate','POST',{},date)).valid,'Legitimate unfilled duties rejected');
      return 'PASS: atomic rejection, valid edit, audit, stale generation, finalized lock, exclusions/absence, legitimate unfilled duties';
    }''')
    print(result)
    context.close()
    # Exercise the actual editor and workbook exports with disposable UI data.
    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.clock.install(time=datetime(2026,11,17,12,tzinfo=timezone.utc))
    page.goto(os.environ.get('TDL_TEST_URL','http://127.0.0.1:5184/'),wait_until='networkidle')
    def click(name):page.get_by_role('button',name=name,exact=True).click()
    for name in ['Daily TDL','Select all','Save attendance','Generate TDL']:click(name)
    page.locator('.allocation-panel .queue-member').first.wait_for()
    def state():
        return page.evaluate("""()=>new Promise((resolve,reject)=>{const r=indexedDB.open('tdl-local-workspace',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace');const q=tx.objectStore('workspace').get('state');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}})""")
    def current():
        day=state()['days']['2026-11-17'];return next(g for g in day['generations'] if g['id']==day['current_generation_id'])
    original=current();secondary=original['secondary']
    roster=state()['employees']
    choices=next((e,m,l) for e in original['queues']['EDS'] for m in original['queues']['MSM'] for l in roster if l['level']=='L0' and l['id'] not in (e['id'],m['id']) and e['id']!=secondary['EDS']['id'] and m['id']!=secondary['MSM']['id'] and l['id']!=secondary['TDL mail sender']['id'])
    for label,person in zip(['EDS HO assignee','MSM HO assignee','TDL mail assignee'],choices):
        page.get_by_role('combobox',name=label,exact=True).click()
        page.get_by_role('option',name=f"{person['name']} · {person['level']}",exact=True).click()
    click('Save HO and mail assignments')
    expect(page.locator('.toast')).to_contain_text('HO and mail assignments updated')
    edited=current()
    assert edited['queues']==original['queues'] and edited['id']==original['id']
    assert [edited['secondary'][q]['id'] for q in ('EDS','MSM','TDL mail sender')]==[e['id'] for e in choices]
    page.reload(wait_until='networkidle');click('Daily TDL')
    assert current()['secondary']==edited['secondary']
    # Narrow layout keeps the editor usable.
    page.set_viewport_size({'width':390,'height':844})
    for label in ['EDS HO assignee','MSM HO assignee','TDL mail assignee']:
        box=page.get_by_role('combobox',name=label,exact=True).bounding_box()
        assert box and box['width']>0 and box['x']>=0 and box['x']+box['width']<=391,box
    page.set_viewport_size({'width':1440,'height':1000})
    click('Validate TDL');click('Finalize TDL')
    expect(page.get_by_role('combobox',name='EDS HO assignee',exact=True)).to_be_disabled()
    expect(page.get_by_role('button',name='Save HO and mail assignments',exact=True)).to_be_disabled()
    out=Path(tempfile.mkdtemp(prefix='tdl-secondary-edit-evidence-'))
    with page.expect_download() as dl:click('Export Excel')
    dl.value.save_as(out/'daily.xlsx')
    daily=openpyxl.load_workbook(out/'daily.xlsx')
    assert daily['HO screenshare']['C2'].value==choices[0]['name']
    assert daily['HO screenshare']['C3'].value==choices[1]['name']
    assert any(r[0]=='TDL mail sender' and r[1]==choices[2]['name'] for r in daily.active.values)
    click('Weekly view')
    with page.expect_download() as dl:click('Export finalized days')
    dl.value.save_as(out/'weekly.xlsx')
    weekly=openpyxl.load_workbook(out/'weekly.xlsx')
    assert {row[6] for row in weekly.active.iter_rows(min_row=4,values_only=True)}=={choices[2]['name']}
    assert list(weekly['HO screenshare'].values)==list(daily['HO screenshare'].values)
    assert not errors,errors
    print('PASS: UI editing, unchanged queues, reload, mobile layout, finalization lock, edited daily/weekly workbook contents. Evidence:',out)
    context.close();browser.close()
