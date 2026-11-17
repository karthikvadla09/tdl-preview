# TDL static preview

This repository contains the static, frontend-only TDL website. Serve the directory with `python3 -m http.server 5174 --bind 127.0.0.1` and open it in a local browser. No login or backend is required. Existing local data and Excel export formats are preserved.

The readable allocation implementation is `assets/allocation.js`. The prebuilt application imports that module for generation and replacement SPRT selection. Its finalized-history adapter preserves the `sprt` field. If replacing the prebuilt application with a new build, preserve these integration points or port them into the original source first.

Primary allocations use the existing staffing, eligibility and history objective. A separate date/employee/queue score breaks equal primary scores without weakening them. Input order and display names do not control ties. Same inputs/date/history regenerate consistently. Different dates can still repeat valid teams; the tie-breaker does not guarantee equal totals without history.

EDS SPRT and MSM SPRT are counted separately from prior current finalized records. The eligible L0 with the fewest duties in that queue is selected; date/identity breaks ties. Manual edits preserve a legal holder; if a replacement is required, the same rule applies. Only L0 employees already in the primary queue are eligible. Browser priority hashing is deterministic and synchronous; exact names need not match the Python CP-SAT application's tied solutions.

Run `npm test` (Node 20+, no dependencies). Browser verification must use a fresh browser context so existing IndexedDB workspace data is never reset or changed by testing. Verify generation, finalization, reload, subsequent-date rotation, manual edits, and daily/weekly Excel contents. Login/signup is intentionally absent.

With the local server running on port 5174, run `python3 tests/browser_regression.py` (requires Playwright, Chromium at `/usr/bin/chromium`, and openpyxl). It uses an isolated browser profile, fixes the test clock, exercises 36 finalized dates through the UI and inspects exported workbooks. Evidence is saved to a new temporary directory printed by the script.
