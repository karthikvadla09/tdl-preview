"""Exercise substitute EDS continuity through the real browser local API and IndexedDB.
Run the frontend Vite server on port 5173 first. All data is disposable.
"""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('TDL_TEST_BROWSER', '/usr/bin/chromium'))
    for prior_cover, today_cover, previous, today in [
        (False, True, '2026-11-17', '2026-11-18'),
        (True, True, '2026-11-17', '2026-11-18'),
        (True, False, '2026-11-17', '2026-11-18'),
        (True, True, '2026-11-19', '2026-11-24'),
    ]:
        context = browser.new_context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5173/', wait_until='networkidle')
        result = page.evaluate('''async ({priorCover,todayCover,previous,today}) => {
          const {localApi: api, exportBackup, restoreBackup} = await import('/src/localApi.ts');
          const assert = (condition, message) => {if (!condition) throw Error(message)};
          const call = (path, method='GET', body={}) => api(path,{method,body:JSON.stringify(body)});
          const cover = async (date,name) => call(`/day/${date}/swaps`,'POST',{
            original_employee_id:1,substitute_name:name,source_team:'Test',level:'L1',eds_access:true});
          const populate = async date => {
            const day = await call(`/day/${date}`);
            await call(`/day/${date}/attendance`,'PUT',{present_ids:day.employees.map(e=>e.id)});
            return day.employees;
          };
          if (priorCover) await cover(previous,'Previous cover');
          const roster = await populate(previous);
          const yesterdayId = roster.find(e=>e.name===(priorCover?'Previous cover':'Demo Member 01')).id;
          await call(`/day/${previous}/generate`,'POST');
          await call(`/day/${previous}/assignments`,'PUT',{assignments:roster.map(e=>({employee_id:e.id,
            queue:[yesterdayId,2,10].includes(e.id)?'EDS':[9,7,4].includes(e.id)?'Backlogs':'MSM'}))});
          await call(`/day/${previous}/finalize`,'POST');
          if (todayCover) await cover(today,'Today cover');
          const present = await populate(today);
          const target = present.find(e=>e.name===(todayCover?'Today cover':'Demo Member 01')).id;
          const generated = await call(`/day/${today}/generate`,'POST');
          assert(!generated.queues.EDS.some(e=>e.id===target),'Generation allowed consecutive EDS');
          const assignments = Object.entries(generated.queues).flatMap(([queue, members])=>members.map(e=>({employee_id:e.id,queue:e.id===target?'EDS':queue})));
          let rejected=false;
          try {await call(`/day/${today}/assignments`,'PUT',{assignments})} catch(e) {rejected=/Consecutive-day EDS/.test(e.message)}
          assert(rejected,'Manual adjustment accepted consecutive EDS');
          // Simulate a legacy/imported invalid generation without modifying historical snapshots.
          const backup=JSON.parse(await exportBackup());
          const day=backup.state.days[today];const gen=day.generations.find(g=>g.id===day.current_generation_id);
          let member;
          for(const queue of ['Backlogs','MSM']) {const i=gen.queues[queue].findIndex(e=>e.id===target);if(i>=0) member=gen.queues[queue].splice(i,1)[0]}
          gen.queues.EDS.push({...member,sprt:''});
          await restoreBackup(JSON.stringify(backup));
          const validation=await call(`/day/${today}/validate`,'POST');
          assert(!validation.valid&&validation.warnings.some(w=>w.includes('Consecutive-day EDS')),'Validation missed invalid imported generation');
          rejected=false;
          try {await call(`/day/${today}/finalize`,'POST')} catch(e) {rejected=/Consecutive-day EDS/.test(e.message)}
          assert(rejected,'Finalization accepted invalid imported generation');
          await call(`/day/${today}/generate`,'POST');
          await call(`/day/${today}/finalize`,'POST');
          return {target,previous,today,priorCover,todayCover};
        }''', {'priorCover': prior_cover, 'todayCover': today_cover, 'previous': previous, 'today': today})
        page.reload(wait_until='networkidle')
        persisted = page.evaluate("""async date => {
            const {localApi} = await import('/src/localApi.ts');
            return localApi(`/day/${date}`);
        }""", today)
        assert persisted['status'] == 'finalized'
        assert all(e['id'] != result['target'] for e in persisted['generation']['queues']['EDS'])
        assert not errors, errors
        print('PASS:', result, 'generation, manual rejection, imported validation/finalization, regeneration, reload')
        context.close()
    browser.close()
