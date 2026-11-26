# TDL static preview

This repository contains the static, frontend-only TDL website. Serve the directory with `python -m http.server 5174 --bind 127.0.0.1` and open it in a local browser. The site opens directly into the local workspace. Keep signup, login, and authentication out of future upstream syncs.

The readable frontend lives in `frontend/`. Run `npm ci` and `npm run build` there. Publish the generated `frontend/dist/index.html` and its matching assets to the repository root and remove the superseded generated bundles. Keep `assets/allocation.js`, which the frontend imports for primary allocation and replacement SPRT selection and the allocator suite tests directly.

Upstream `TDL-generator/main` through `446cfa6f0eacdc7b817d56f51b69ea1c5e780bed` was reviewed for the static sync. HO screenshare assigns one eligible member from each of EDS and MSM. TDL mail sender selects a present L0 and records the duty without sending email. Each duty rotates against its own finalized history. Date-specific exclusions are saved in IndexedDB and included in backups. Daily and finalized weekly workbooks include the new duties. Earlier generations remain readable and show duties as not recorded.

Primary allocations use the existing staffing, eligibility and history objective. A separate date/employee/queue score breaks equal primary scores without weakening them. Input order and display names do not control ties. Same inputs/date/history regenerate consistently. Different dates can still repeat valid teams; the tie-breaker does not guarantee equal totals without history.

EDS SPRT and MSM SPRT are counted separately from prior current finalized records. The eligible L0 with the fewest duties in that queue is selected; date/identity breaks ties. Manual edits preserve a legal holder; if a replacement is required, the same rule applies. Only L0 employees already in the primary queue are eligible. Browser priority hashing is deterministic and synchronous; exact names need not match the Python CP-SAT application's tied solutions.

Run `npm test` (Node 20+, no dependencies). Browser verification must use a fresh browser context so existing IndexedDB workspace data is never reset or changed by testing. Verify generation, finalization, reload, subsequent-date rotation, manual edits, and daily/weekly Excel contents. Login/signup is intentionally absent.

With the local server running on port 5174, run `python tests/browser_regression.py` (requires Playwright, Chrome on Windows or Chromium at `/usr/bin/chromium` on Linux, and openpyxl). Set `TDL_TEST_BROWSER` to override the browser executable. It uses an isolated browser profile, fixes the test clock, exercises 36 finalized dates through the UI and inspects exported workbooks. Evidence is saved to a new temporary directory printed by the script.

The incremental sync from upstream `b500e5473ef8761030d3516bb60688681afcb835` to `5ba5af850f8ad8305d0ea9694672bd8757c6b0eb` carries consecutive EDS restrictions across temporary substitutes. Generation, manual adjustments, validation and finalization use the covered regular member's identity for this rule only. A returning member or a different cover is blocked after yesterday's cover worked EDS, including Thursday-to-Tuesday. The restricted member's configured exception is not inherited by his substitute. Existing saved swaps supply the identity without changing backup format or rewriting historical snapshots; other fairness counts remain tied to actual assignees.

Focused substitute continuity integration tests: with `npm run dev -- --port 5173` running in `frontend/`, run `python tests/substitute_eds_regression.py` from the repository root. This uses a disposable browser context and the real local API/IndexedDB implementation served by Vite.

Upstream `5ba5af8..a805d92` adds separation of TDL mail sender from both HO screenshare holders. HO is assigned first; mail rotates among remaining present, non-excluded L0s. When the only mail candidate holds HO, HO is reassigned only if all filled HO duties can retain eligible replacements. Otherwise mail remains unfilled with a warning. Manual edits preserve legal duties and reselect conflicting holders. Validation rejects saved overlaps and blocks finalization. Primary allocations, SPRT and historical snapshots are unchanged.

For focused duty separation integration checks, run `python tests/duty_separation_regression.py` with the frontend Vite server running on port 5173.

Upstream `a805d92..a229565` adds draft editing for both HO screenshare holders and the TDL mail sender. Save all three selections together using the current generation ID; invalid or stale selections leave saved data unchanged. Only present, non-excluded members of each primary queue may hold HO; mail must be a distinct, present, non-excluded L0. Unfilled is accepted only when there are no eligible candidates. Finalized generations are locked. Saving updates snapshots, warnings and audit without changing primary queues or SPRT. Existing history, backups and workbooks use the saved duty selections.

With Vite running on port 5173 and the static site on port 5184, run `python tests/secondary_editing_regression.py`. Set `TDL_TEST_URL` for another static URL. It checks atomic validation, stale/finalized protection, exclusions and absence, legitimate unfilled duties, UI editing, reload, narrow layout and daily/weekly Excel contents.

Upstream `a229565..446cfa6` aligns HO and mail card typography. The shared Overview/Daily TDL duty summary uses consistent labels, assignee names and separate level lines, with wrapping for long names.

Upstream `446cfa6..8a7f256` moves manual assignment controls into the queue cards. Draft moves appear immediately, and save errors appear beside the editor. Weekly queue counts wrap, and date exclusions show draft counts and mail attendance.

### Staffing before rotation

Generation preserves queue staffing and hard eligibility first, then covers as many queues as possible with at least one L1. Coverage ties and second L1 assignments use EDS → MSM → Backlogs priority. With five eligible L1s the target is EDS 2, MSM 2, Backlogs 1; with three it is 1 in each queue. Rotation history and date ties rank only equally suitable distributions. Missing L1 coverage and relaxed pairing are warnings, including for MSM. Existing saved TDLs are unchanged until regenerated.

Privacy: the public preview ships fictional demo member labels only. Real roster names must stay in browser-local workspace data and private backups; do not commit them. Existing browser workspaces are preserved, so replacing the published demo does not erase personal data saved on a user's device.

## Website design

Swiss Grid is the permanent website style: Helvetica/Arial typography, red accents, neutral surfaces, square controls, and a responsive grid. There is no theme selector or appearance storage; earlier saved theme preferences are ignored. Workspace data and backups are unchanged.

Run `python3 tests/website_theme_audit.py`, `python3 tests/commented_controls_regression.py`, and `python3 tests/theme_details_regression.py` for the single-style layout, control, search, and appearance checks. Each serves the static checkout internally using disposable demo browser data. Run `TDL_TEST_URL=http://127.0.0.1:6194/ python3 tests/dropdown_theme_regression.py` against a static server for dropdown and calendar checks.

Run `python3 tests/l1_policy_browser_regression.py` to verify five-L1 generation, manual-edit warning refresh, reload, finalization, Excel export, and explicit regeneration using disposable demo data. Matching policy fixtures cover zero through six L1s, eligibility restrictions, long histories, and substitutes in both repositories.

## Date-specific Backlogs exclusions

Daily TDL includes a **Backlogs exclusions** checklist for L0 and L1 members of the selected date's effective roster, including substitutes. These opt-outs are always enforced, including when the previous-week L0 restriction is relaxed for staffing. Saving changed selections preserves attendance and supersedes any current allocation; finalized dates require confirmation. Unchanged saves are no-ops. Generate again to apply changes. Selections are personal to each roster identity and date; covered members' hidden selections are retained while substitutes have their own. Generation, manual saves, validation and finalization all enforce these exclusions. Impossible combinations report a conflict rather than ignoring an exclusion. Daily Excel exports include the selected names, and weekly exports include a Backlogs exclusions sheet.

Run `python3 tests/backlogs_exclusions_browser_regression.py` to check the checklist, saved exclusions, generation, manual options, finalized confirmation, legacy/current backup restore, imported-data validation, exports, substitutes, and mobile layout using disposable fictional data.

## Backlogs weekly rotation

Neither L0 nor L1 can receive Backlogs twice in the same Monday-based operational week. Only earlier current-finalized generations count. Last-week L0 members are normally avoided, but may be reused to maintain queue staffing and EDS → MSM → Backlogs L1 priorities when current-week non-repeat options are insufficient. The allocator minimizes these exceptions and reports them explicitly. Date-specific Backlogs exclusions, EDS access, and other hard eligibility rules are never relaxed. Manual saves and finalization reject same-week repeats and unnecessary previous-week reuse. Existing saved assignments stay unchanged until explicitly regenerated.

Run `python3 tests/backlogs_weekly_browser_regression.py` to reproduce the weekly shortage pattern with fictional names and verify fallback generation, manual options, validation, finalization, and reload.
