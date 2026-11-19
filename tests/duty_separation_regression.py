"""Run with frontend Vite on port 5173; uses disposable IndexedDB contexts."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER', '/usr/bin/chromium'))
    for scenario in ('reserve', 'unfilled', 'overlap'):
        context = browser.new_context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/', wait_until='networkidle')
        result = page.evaluate('''async scenario => {
          const {localApi:api,exportBackup,restoreBackup}=await import('/src/localApi.ts');
          const date='2026-11-17';
          const call=(action='',method='GET',body={})=>api(`/day/${date}${action?'/'+action:''}`,{method,body:JSON.stringify(body)});
          const assert=(condition,message)=>{if(!condition)throw Error(message)};
          const separate=gen=>assert(!gen.secondary['TDL mail sender'] || !['EDS','MSM'].some(q=>gen.secondary[q]?.id===gen.secondary['TDL mail sender'].id),'Duty overlap');
          const roster=(await call()).employees;
          await call('attendance','PUT',{present_ids:roster.map(e=>e.id)});
          let gen=await call('generate','POST');separate(gen);
          const original=JSON.stringify(gen.queues);
          // First force an L0 into HO by excluding all L1s from HO.
          await call('ho-exclusions','PUT',{excluded_ids:roster.filter(e=>e.level==='L1').map(e=>e.id)});
          gen=await call('generate','POST');
          const queue=['EDS','MSM'].find(q=>gen.secondary[q]?.level==='L0'&&gen.queues[q].filter(e=>e.level==='L0').length>1);
          const candidate=gen.secondary[queue];assert(candidate,'No L0 HO fixture');
          if(scenario==='overlap'){
            const backup=JSON.parse(await exportBackup());const day=backup.state.days[date];
            const saved=day.generations.find(g=>g.id===day.current_generation_id);
            saved.secondary['TDL mail sender']=candidate;
            await restoreBackup(JSON.stringify(backup));
            const check=await call('validate','POST');
            assert(!check.valid&&check.warnings.some(w=>w.includes('not an HO screenshare holder')),'Overlap validation missed');
            let rejected=false;try{await call('finalize','POST')}catch(e){rejected=e.message.includes('not an HO screenshare holder')}
            assert(rejected,'Overlap finalized');
            gen=await call('generate','POST');separate(gen);
          }else{
            if(scenario==='unfilled'){
              const allowed=new Set([candidate.id,...gen.queues[queue==='EDS'?'MSM':'EDS'].map(e=>e.id)]);
              await call('ho-exclusions','PUT',{excluded_ids:roster.filter(e=>!allowed.has(e.id)).map(e=>e.id)});
            }
            await call('mail-exclusions','PUT',{excluded_ids:roster.filter(e=>e.level==='L0'&&e.id!==candidate.id).map(e=>e.id)});
            gen=await call('generate','POST');separate(gen);
            assert(JSON.stringify(gen.queues)===original,'Duties altered primary queues');
            if(scenario==='reserve'){
              assert(gen.secondary['TDL mail sender']?.id===candidate.id,'Mail not reserved');
              assert(gen.secondary.EDS&&gen.secondary.MSM,'HO duty lost');
            }else{
              assert(gen.secondary['TDL mail sender']===null,'Irreplaceable HO also got mail');
              assert(gen.warnings.some(w=>w.includes('after HO screenshare')),'Missing unfilled warning');
            }
          }
          const assignments=Object.entries(gen.queues).flatMap(([queue,es])=>es.map(e=>({employee_id:e.id,queue})));
          gen=await call('assignments','PUT',{assignments});separate(gen);
          assert((await call('validate','POST')).valid,'Valid separated duties rejected');
          await call('finalize','POST');
          return gen.secondary;
        }''', scenario)
        page.reload(wait_until='networkidle')
        saved = page.evaluate("async()=> (await (await import('/src/localApi.ts')).localApi('/day/2026-11-17'))")
        assert saved['status'] == 'finalized'
        assert saved['generation']['secondary'] == result
        assert not errors, errors
        print('PASS:', scenario, 'generation, manual save, validation/finalization, reload')
        context.close()
    browser.close()
