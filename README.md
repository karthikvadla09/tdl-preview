# TDL static preview

This repository contains the static, frontend-only TDL website. Serve the directory with `python -m http.server 5174 --bind 127.0.0.1` and open it in a local browser. The site opens directly into the local workspace. Keep signup, login, and authentication out of future upstream syncs.

The readable frontend lives in `frontend/`. Run `npm ci` and `npm run build` there. Publish the generated `frontend/dist/index.html` and its matching assets to the repository root and remove the superseded generated bundles. Keep `assets/allocation.js`, which the frontend imports for primary allocation and replacement SPRT selection and the allocator suite tests directly.

Upstream `TDL-generator/main` through `5ba5af850f8ad8305d0ea9694672bd8757c6b0eb` was reviewed for the static sync. HO screenshare assigns one eligible member from each of EDS and MSM. TDL mail sender selects a present L0 and records the duty without sending email. Each duty rotates against its own finalized history. Date-specific exclusions are saved in IndexedDB and included in backups. Daily and finalized weekly workbooks include the new duties. Earlier generations remain readable and show duties as not recorded.

Primary allocations use the existing staffing, eligibility and history objective. A separate date/employee/queue score breaks equal primary scores without weakening them. Input order and display names do not control ties. Same inputs/date/history regenerate consistently. Different dates can still repeat valid teams; the tie-breaker does not guarantee equal totals without history.

EDS SPRT and MSM SPRT are counted separately from prior current finalized records. The eligible L0 with the fewest duties in that queue is selected; date/identity breaks ties. Manual edits preserve a legal holder; if a replacement is required, the same rule applies. Only L0 employees already in the primary queue are eligible. Browser priority hashing is deterministic and synchronous; exact names need not match the Python CP-SAT application's tied solutions.

Run `npm test` (Node 20+, no dependencies). Browser verification must use a fresh browser context so existing IndexedDB workspace data is never reset or changed by testing. Verify generation, finalization, reload, subsequent-date rotation, manual edits, and daily/weekly Excel contents. Login/signup is intentionally absent.

With the local server running on port 5174, run `python tests/browser_regression.py` (requires Playwright, Chrome on Windows or Chromium at `/usr/bin/chromium` on Linux, and openpyxl). Set `TDL_TEST_BROWSER` to override the browser executable. It uses an isolated browser profile, fixes the test clock, exercises 36 finalized dates through the UI and inspects exported workbooks. Evidence is saved to a new temporary directory printed by the script.

The incremental sync from upstream `b500e5473ef8761030d3516bb60688681afcb835` to `5ba5af850f8ad8305d0ea9694672bd8757c6b0eb` carries consecutive EDS restrictions across temporary substitutes. Generation, manual adjustments, validation and finalization use the covered regular member's identity for this rule only. A returning member or a different cover is blocked after yesterday's cover worked EDS, including Thursday-to-Tuesday. Karthik's personal exception is not inherited by his substitute. Existing saved swaps supply the identity without changing backup format or rewriting historical snapshots; other fairness counts remain tied to actual assignees.

Focused substitute continuity integration tests: with `npm run dev -- --port 5173` running in `frontend/`, run `python tests/substitute_eds_regression.py` from the repository root. This uses a disposable browser context and the real local API/IndexedDB implementation served by Vite.
