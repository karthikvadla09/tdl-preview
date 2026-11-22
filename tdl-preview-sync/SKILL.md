---
name: tdl-preview-sync
description: Fetch changes from TDL-generator and port the requested features, fixes, or UI changes into the browser-only tdl-preview website. Use for upstream syncs and specific TDL-generator commits or PRs that should carry over to the static preview.
---

# Sync TDL-generator into tdl-preview

Keep the preview deployable as static files under a GitHub Pages project subpath. Implement the requested upstream behavior using browser storage, local computation, and client-side exports.

Project policy for future syncs: omit upstream signup, login, and authentication changes. The static preview opens directly into the local workspace.

## Resolve the upstream changes

1. Start in the `tdl-preview` checkout. Read its README, check the active branch and working tree, and inspect its current static entry point and tests. Preserve unrelated edits.
2. Upstream is `https://github.com/karthikvadla09/TDL-generator.git`. The sibling Git repository at `../TDL automation/tdl-frontend-prototype` may provide useful local history. Verify its remote before using it. For live changes, fetch the requested upstream ref (default `main`) into an isolated clone within a writable location, or use GitHub tools to inspect that ref and its diff. Record the resolved commit. If live access fails, label any cached commit as such.
3. For a commit, PR, or range, inspect the requested diff and any prerequisite changes. For an open-ended sync, find the last verified upstream revision ported, then reconcile the upstream diff with the actual preview behavior. The prototype branch and preview have independent changes. Without a verified baseline, compare the relevant behavior and source and avoid claiming full parity. Ask for scope only if the missing baseline leaves materially different implementations or features in play.

## Port the behavior

- The sibling repository's `prototype/frontend-only` branch contains readable source for the original static UI. Check its relationship to the deployed assets before rebuilding. Look at `frontend/src/localApi.ts` for browser persistence, `allocator.ts` for local generation, `workbook.ts` for exports, and `App.tsx` and `style.css` for UI. Recover source in a writable workspace if needed. Treat the current preview as authoritative for later preview-only changes.
- In the current preview, `assets/allocation.js` implements primary allocation and replacement SPRT selection. Preserve its integration with generation, manual edits, and finalized history, including the `sprt` field, when rebuilding. Keep changes readable in source wherever possible.
- Trace each behavior through upstream UI, API, persistence, allocation, and exports as relevant. Port server-side business logic to equivalent local operations. Authentication, shared accounts, and server-only integrations fall outside the browser-only preview unless the user asks for a static equivalent. Keep the browser app independent of FastAPI, SQLite, and server calls.
- Preserve existing IndexedDB data, stable employee IDs, backup and restore compatibility, and workbook contracts unless the requested behavior changes them. Handle existing saved data when adding fields or stores. Only the current finalized generation feeds later rotation and analytics. Compare eligibility, objective order, warnings, and duty selection with upstream. Independent solvers may choose different valid names on tied results.
- For a rebuild, inspect the prototype's build configuration and publish the matching HTML and asset set to the preview checkout. Verify relative asset and lazy-import URLs under a project subpath and retain `.nojekyll` where used.

## Verify and report

- Run the preview allocator suite with Node 20 or newer. If Windows passes the test glob literally, run `node --test tests/allocation.test.js`. Add targeted regression coverage for behavior that existing tests miss.
- Use a fresh browser context against a local static server. Verify the changed user flows, reload persistence, and the absence of backend requests. For allocation or history changes, exercise attendance, generation, manual edits, finalization, and rotation on a later date. For export changes, inspect the workbook sheets and cell values. Adapt the existing browser regression harness to the available Chromium path when needed. Use disposable fixture data for storage and backup tests.
- Report the upstream ref and commit, the range or features examined, the preview changes, and test results or gaps. Record the upstream commit or range in the handoff or commit message when committing is requested. Describe any upstream behavior that needs a server. Leave publishing, pushing, and deployment to separately authorized actions.

## Roster privacy

Never copy real employee names or personal roster data from upstream into this public preview, fixtures, documentation or generated assets. Retain fictional demo member labels. Eligibility exceptions must use explicit configuration, never a real person's name. Rebuild and scan generated assets before publishing.
