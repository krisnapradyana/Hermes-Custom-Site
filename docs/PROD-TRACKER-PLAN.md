# Production Tracker — plan (Google Sheets mirror)

Status: PLANNED — nothing implemented yet. This document is the spec to read,
amend, and approve before any code is written.

---

## 1 · Goal and principles

Client-facing production sheets (Kurzgesagt-style trackers) are how we report
progress and how clients respond — they edit cells directly, and our legacy
Slack workflow is wired to them. That system stays. The web app gains a
**Production Tracker tab** on each project that *mirrors* the project's sheet
in our stylized UI, computes the dashboards we currently hand-build, and gives
the whole team one visual language across every project.

Principles, in priority order:

1. **The sheet remains the source of truth.** Clients edit there; Slack
   workflows hook there. The app reads, renders, computes — it does not own.
2. **Read-only first.** No cell is ever written by the app in v1. Write-back
   is a v3 question, and only for individually mapped cells.
3. **Standardize the model, not the sheets.** Sheets differ per client and
   always will. One canonical data model + a per-project mapping absorbs the
   differences; the UI is identical for every project.
4. **The sheet's vocabulary stays visible.** A chip says "Kurz Approved" in
   the client's own words; only its COLOR comes from our canonical bucket.
   The mirror must "strongly represent what exists in the sheet".

## 2 · Canonical data model

Every tracker reduces to shots × phases:

```
TrackerShot {
  rowIndex        // position in the sheet (stable ordering + deep links)
  scene, shotId   // "010", "010_A"
  thumb?          // image if extractable (see Risks)
  type?           // Painterly / Scribble / …
  complexity?     // Hard / Mid / Low
  batch?          // "B1 - 30%" …
  remark?
  phases: {       // per mapped phase, e.g. "Colour Script", "Illustration", "Animation"
    [phaseName]: {
      statusRaw   // exact cell text, e.g. "Kurz Approved"
      status      // canonical bucket (below)
      assignee?   // cell text, e.g. "Disa"
      link?       // Frame.io / file link if a link column is mapped to this phase
    }
  }
}
```

Canonical status buckets (fixed, five + unknown):

| Bucket           | Meaning                              | Color  |
| ---------------- | ------------------------------------ | ------ |
| `todo`           | not started / not assigned           | grey   |
| `in_progress`    | being worked                         | amber  |
| `waiting_client` | delivered, awaiting client feedback  | purple |
| `revise`         | client sent it back                  | red    |
| `approved`       | client approved / final              | green  |
| `unknown`        | cell text not in the dictionary      | grey, dotted outline |

`unknown` is rendered honestly (raw text, dotted) and counted in a "N
unmapped statuses" warning — never silently guessed.

## 3 · Per-project mapping (the wizard)

Attaching a sheet = pasting its URL on the project page → one-time wizard:

1. **Tab picker** — which worksheet is the tracker (e.g. `Prod_Tracker`).
2. **Header detection** — the app proposes the header row; multi-row headers
   (`[Colour Script] Status`) are flattened by joining the rows. PM can
   override which row(s) are headers.
3. **Column roles** — for each detected column, a dropdown: Shot ID · Scene ·
   Thumbnail · Type · Complexity · Batch · Remark · Phase status · Phase
   assignee · Phase link · Ignore. Choosing a phase role also asks the phase
   name (free text; suggestions: Colour Script, Illustration, Animation).
4. **Status dictionary** — the app lists every distinct value found in the
   mapped status columns with a count, and the PM buckets each one
   ("Kurz Approved" → approved). Prefilled by heuristics (approve/final →
   approved; revise/reject → revise; review/feedback/waiting → waiting_client;
   progress/wip → in_progress; to do/not assigned/empty → todo).
5. **Save** — mapping stored server-side per project
   (`DATA_DIR/trackers/<projectId>.json`: sheetId, tab, headerRows, columns[],
   statusDict{}, savedBy, savedAt). Optional **"Save as template"** stores a
   named copy (`DATA_DIR/tracker-templates/<name>.json`).

**Auto-recognition:** when a new sheet's flattened headers match a saved
template (or the built-in SuperPixel template) above a similarity threshold,
the wizard opens pre-filled and becomes a one-click confirm.

## 4 · Template strategy (new projects)

We publish one **SuperPixel Production Tracker** Google Sheets template:
Scene · Shot · Sketch · Type · Complexity · Batch · Remark · per-phase
Status/Assignee/Link columns — deliberately shaped like the current Kurzgesagt
tracker so nothing feels foreign. New projects copy it; the app recognizes it
instantly. Legacy/odd sheets go through the wizard. Standardization is
achieved by gravity, not decree.

## 5 · Architecture

- **Auth:** the same `documents/token.json` the Events page uses — the
  oauth-helper token already carries the `spreadsheets` scope. Zero new
  credentials, zero new consent.
- **Server routes** (all session-gated like everything else):
  - `GET  /api/projects/[id]/tracker` → parsed canonical payload (shots,
    phases, computed stats) or `{connected:false}`.
  - `POST /api/projects/[id]/tracker` → save mapping (from the wizard).
  - `GET  /api/projects/[id]/tracker/inspect?url=…` → headers + sample rows +
    distinct status values (wizard data source).
  - `DELETE` → disconnect.
- **Sync:** poll on demand with a ~60s server cache (same pattern as
  calendar). No webhooks — Sheets push notifications need a public HTTPS
  endpoint + channel renewals; not worth it at this scale. Focus-refresh +
  Refresh button on the tab.
- **Reading:** one `spreadsheets.values.get` per sync (single range, whole
  tab) — cheap; quota is a non-issue at team scale.
- **Failure honesty:** if headers no longer match the mapping (client
  restructured the sheet), the tab shows "Mapping needs attention — N mapped
  columns not found" with a Re-map button. Never render misaligned data.

## 6 · UI — Production Tracker tab

Placement: a tab/section on the project page next to Task Board (mockup #1).

- **Header strip:** "synced from Google Sheets" capsule · last-sync time ·
  Refresh · "Open in Sheets" (deep link).
- **Progress cards:** one per phase — % approved (approved ÷ shots), colored
  bar; plus a Shots/batches counter. This replaces the hand-built Dashboard
  tab formulas.
- **Filters:** batch · assignee · complexity/type · status bucket chips
  ("Needs revision", "Waiting client") · text search.
- **The matrix:** rows = shots (thumb, id, type/complexity), columns =
  mapped phases; each cell = status chip in the sheet's own words + assignee
  + link icon when present. Row click → detail drawer (all fields, remark,
  link out to the exact sheet row).
- **Workload table:** per artist × phase × bucket counts — the "Artist
  Workload Distribution" tables, computed.
- **Unknown-status banner** when the dictionary has gaps, with a one-click
  "add to dictionary" flow.

## 7 · Relationship to the Task Board

Deliberately separate systems. The tracker mirrors the *client pipeline*
(sheet-owned); the Task Board is *our internal work* (app-owned). Merging
sheet rows into tasks-store would create identity conflicts and sync hell.
One bridge, later (v2): "Create internal task from this shot" — pre-fills
title/phase/assignee, links back to the shot.

## 8 · Client share link (v2)

Clients keep **editing** in the sheet forever. For **viewing**, v2 adds an
optional read-only share page: `/share/tracker/<token>` — a long random
token stored on the project, revocable/regenerable from the project page, no
Slack login required (middleware allowlists the route; the token IS the
auth). It renders the same tracker view minus internal-only elements. This
becomes the link you drop in a client email instead of "see the Dashboard
tab". Explicitly optional: v1 ships without it.

## 9 · Deliberately out of scope

- **Two-way sync (v1/v2).** The app never writes cells until v3, and then
  only single mapped cells behind an explicit per-project opt-in.
- **Slack workflow changes.** It keeps hooking the sheet; we touch nothing.
- **Editing the sheet's structure from the app.** Never.
- **The Weekly/Daily tabs.** v1 mirrors the shot tracker tab only. The
  schedule-blocks tab (AUG/SEPT week grid) could later feed the existing
  timeline component — parked as a v2+ idea.

## 10 · Risks

| Risk | Reality | Mitigation |
| --- | --- | --- |
| In-cell thumbnails | Sheets API only exposes images inserted as `=IMAGE()` formulas (URL readable) or, partially, newer in-cell images; pasted/floating images are invisible to the API | Render what's readable; otherwise a placeholder linking to the sheet row. Set expectations: thumbs are best-effort |
| Merged cells / multi-row headers | Present in current sheets | Wizard header-row override + flattening; merged data cells inherit the anchor value (API behavior) — matrix stays aligned by rowIndex |
| Sheet restructured mid-project | Will happen | Mapping validation on every sync; degraded "needs attention" state, never wrong data |
| Status vocabulary drift (client invents "Approved-ish") | Will happen | `unknown` bucket + banner + one-click dictionary add |
| Token/scope | Already solved — same token.json as Events | — |

## 11 · Phasing and acceptance

**v1 — mirror (one build session + review):** inspect + wizard + mapping
storage, tracker GET with canonical parsing, tracker tab with progress cards,
filters, matrix, workload table, degraded states. Accept when: the real
Kurzgesagt sheet connects through the wizard, every chip matches the sheet
exactly, dashboards match the sheet's own Dashboard tab numbers, and a
deliberately renamed column produces "needs attention" instead of wrong data.

**v2 — reach:** SuperPixel template + auto-recognition · client share link ·
"create task from shot" bridge · schedule-blocks → timeline.

**v3 — write-back (only if the team asks):** per-project opt-in, status
dropdown in our UI writing the single mapped cell, full audit line in chat.

## 12 · Open questions (answer before v1 starts)

1. Which sheet do we pilot with — the Kurzgesagt tracker from the
   screenshots? (Best test: it has every hard case.)
2. Phase names: fixed set across projects (Colour Script / Illustration /
   Animation) or free per project? Plan assumes free-per-project with
   suggestions.
3. Who may connect/re-map a sheet — anyone, or APPROVER_SLACK_IDS-style
   allowlist?
4. Client share link in v1 after all, or hold for v2 as planned?
