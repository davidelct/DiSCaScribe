# One App: DiSCaScribe → integrated EPR + scribe

**Goal.** Retire DummyEPR and grow DiSCaScribe into a single app that simulates what
clinicians actually use today: an EPR with an integrated scribe. Patient list → chart →
start consultation → record → generate note → edit → approve/file → stimulated recall.

**Why this is the right move**
- One codebase to maintain instead of two (DummyEPR hasn't been touched since 17 Jun).
- The manual copy-paste handoff disappears; write-back becomes real.
- DummyEPR is unhostable as-is (JSON-on-disk + native Rust binary vs Vercel's read-only
  filesystem — the exact reason hosting was declined for the July demo). DiSCaScribe
  already deploys.
- Ecological validity: participants see one integrated tool, like Epic+Abridge or
  EMIS+scribe, not two browser windows.
- The rebuild silently fixes DummyEPR's worst traps: SOAP text lost on refresh (no
  autosave), finalise-only save, un-actioned SNOMED suggestions defaulting to rejected.

**Serendipity:** the scribe already generates the note as structured
`{subjective, objective, assessment, plan}` JSON (`SOAP_NOTE_SCHEMA`, prompt
`v4-soap-structured`) and only *then* flattens it to markdown. DummyEPR stores exactly
that four-string shape. Write-back is a data-plumbing task, not a parsing task.

---

## What we keep, absorb, and drop

| | Decision |
|---|---|
| **Keep (DiSCaScribe base)** | Auth roles (full/BYOK), capture modes (`scribed`/`recording_only`), Deepgram pipeline + SSE, structured note generation, note versioning, stimulated recall view, two-phase Box archival, audit log, design system. |
| **Absorb (from DummyEPR)** | The data model (`Patient`, `Observation`, `LabResult`, encounter status lifecycle — `src/lib/types.ts`), the 3 seeded VP patients + baseline observations, the patient list / summary / clinical-record UX, the per-section SOAP editing surface, analysis CSV export concept. |
| **Drop** | CSV/archetype/OpenAI patient generation (study patients are hand-authored), JSON file store, dm+d prescribing (5-seed-drug fallback only on this machine anyway), the Generate tab, Amelia-Hughes seed. |
| **Defer (explicit decision later)** | SNOMED review flow + Rust extractor (WS4 roadmap item; Windows-first setup, licensed refsets, only the diagnoses artefact ever built on this Mac). Referrals (simple modal — cheap to port if the study needs it). |

---

## Decision points (recommendations marked ✅)

### D1 — Persistence: where do patients and filed consultations live?
The scribe today is browser-local (encrypted localStorage + IndexedDB); DummyEPR is
JSON-on-disk. Neither gives us a shared, durable patient chart.

- **(a) Stay browser-local, ship seed patients into the client** — least work, still
  Vercel-deployable, but every browser is its own world: no cross-session history, no
  shared chart between machines, and clearing site data wipes the "EPR".
- **(b) ✅ Serverless Postgres (Neon / Vercel Postgres) + Drizzle** — real shared chart,
  hostable on the existing Vercel deploy, gives us server-side interaction logging for
  free. The study data is simulated (actors, 999-range NHS numbers, no real PHI) and we
  already ship transcripts to Deepgram/Anthropic and archive everything to Box, so
  server-side storage of these patients is consistent with the existing posture.
- **(c) Turso/libSQL** — same idea, slightly less boring than Postgres.

**Recommended shape: hybrid.** The *chart* (patients, observations, filed
consultations, view-event log) is server-backed. The *in-progress consultation*
(recording, live transcript, draft note) stays in the existing client-side flow —
that code works and is the study-critical path. "Approve & file" is the moment a
consultation crosses from local draft to server chart. Box remains the raw-artifact
archive, unchanged.

### D2 — Approval becomes a first-class step
Today the scribe has no sign-off concept (edits just bump `note_version`). Add
`draft → approved/filed`: approving files the structured SOAP to the patient chart,
locks the consultation (amendments = new version, like a real EPR), triggers the final
Box archive, and makes it appear in patient history. `note_version` history is kept —
generated v0 vs approved vN is itself a PID-relevant measurement (how much did the
clinician reshape the AI note?).

### D3 — Routing and the `page.tsx` decomposition
Real routes replace the single-page view-state machine:

```
/                                  → patient list (the EPR landing)
/patients/[id]                     → chart: summary, meds/allergies/social,
                                     observations, past consultations
/patients/[id]/consultations/new   → starts a consultation (mode picker)
/consultations/[id]                → workspace: Capture / Note / Recall tabs (today's
                                     note-editor.tsx, bound to a patient)
/login                             → unchanged
```

This forces the overdue decomposition of the 1,237-line `apps/web/src/app/page.tsx`.
The workflow state moves into the consultation workspace route; encounter list sidebar
becomes patient-scoped history. New UI goes in a `packages/ui` + `apps/web` split as
today; patient/chart components are new, the capture/note/recall internals move mostly
intact.

### D4 — The control arm needs manual note entry
`recording_only` mode currently produces no note at all (the DummyEPR SOAP textareas
were where the control-arm GP typed their note). The consultation workspace must offer
**manual per-section SOAP entry when mode = `recording_only`** — same four-section
editor the AI arm uses, minus generation. This replaces the raw markdown `<textarea>`
with four section editors for both arms (markdown export stays).

### D5 — Interaction logging (new, PID-relevant)
DummyEPR logged *nothing* about process — no view, dwell, or navigation data. With a
server DB we can cheaply log which chart sections a participant opened and when
(patient selected, tab opened, past consultation expanded), plus the existing note-edit
versions and recall timeline. Extend the existing PHI-free audit-log discipline; store
events server-side keyed by consultation. Worth confirming with Olga/Eoin what the
analysis actually wants before building dashboards — but capture from day one, it's
cheap and unrecoverable after the fact.

### D6 — Study integrity: the chart shows baseline only
Seed exactly what DummyEPR's `data/` holds today: demographics, social history,
summary, historical observations. **No presenting complaint, no exam findings, no
investigation results** — those are uncovered live with the actor (pre-loading them
would give away the reasoning the study measures). The chart is read-only except
through filed consultations.

### D7 — Identity (flag, don't build yet)
Auth is a shared password; `user_id` is `"local-user"`. For a real study run we likely
need a participant code (typed at consultation start, or per-participant passwords).
Cheap to add later; schema should reserve a `participant_id` column now.

---

## Phases

### Phase 0 — Safeguard & prep (≤ half a day)
- [x] **Back up `DummyEPR/data/`** — the 3 study patients were untracked, single-machine
      only. Copied to `local-only/dummyepr-data-backup-2026-07-27/`.
- [ ] Commit the seed data into DiSCaScribe as fixtures (it's simulated, 999-range NHS
      numbers — safe to track; decide whether Derek's demo encounter comes along).
- [ ] Prune dead weight so the refactor is honest: `packages/llm-medgemma`,
      `packages/pipeline/medgemma-scribe`, live-segment path
      (`/api/transcription/segment` + `useSegmentUpload`), `note-core/verification`
      (unwired), legacy `server-api-keys.ts` Electron paths, stale env vars.
- [ ] Re-enable typechecking in builds (`typescript.ignoreBuildErrors: true` is a trap
      for a refactor this size).

### Phase 1 — Patient foundation (~1 week)
- DB + Drizzle schema: `patients`, `observations`, `lab_results`,
  `consultations` (filed), `view_events`. Reserve `participant_id`.
- Seed script from the backed-up JSON (3 VPs + 8 baseline observations).
- Routes + UI: patient list, patient chart (summary blocks, observations table,
  consultation history). Read-only.
- Auth middleware extends to the new routes unchanged.

### Phase 2 — Consultation workflow (~1–2 weeks, the core)
- "Start consultation" from chart → mode picker (`scribed` / `recording_only`) →
  workspace route bound to `patientId` (name/NHS auto-filled, no more free-text
  patient name).
- Decompose `page.tsx` into the workspace; capture/note/recall tabs move mostly as-is.
- Structured SOAP editor (four sections, both arms; manual entry for control arm).
- **Approve & file**: writes structured SOAP + metadata to the chart, locks the
  consultation, archives `note_final` to Box (metadata.json gains `patientId`),
  appears in patient history immediately.
- Capture-mode theming, BYOK key handling, and the two-phase archival flow unchanged.

### Phase 3 — Recall + research layer (~3–5 days)
- Stimulated recall attached to the *filed* consultation (component exists; bind it to
  patient context, keep `recall_session.json` archival).
- View-event logging wired through chart + workspace.
- Analysis exports: consultations CSV (per-arm), note-version diffs; shapes checked
  against what Eoin's analysis expects from DummyEPR's CSVs before finalising columns.

### Phase 4 — Deferred / optional
- SNOMED review flow port (decision gated on WS4 + artefact rebuild on macOS/Linux —
  note the untracked `scripts/build-snomed-artefacts.sh` in DummyEPR is the only
  macOS port of the artefact build; preserved in the backup decision).
- Referrals modal, simplified prescribing, per-participant auth, patient search.

**Retirement:** DummyEPR is archived (not deleted) once Phase 2 lands — it stays the
reference for the SNOMED adapter (`src/lib/server/snomed.ts`, 733 lines) and the
review-modal UX if WS4 revives coding.

---

## Open questions for the team
1. **Hosting/DB** (D1): confirm serverless Postgres is acceptable for simulated-patient
   data, or must everything stay local for the study protocol?
2. **Analysis contract**: does Eoin's pipeline consume DummyEPR's SNOMED/Scribe CSV
   column shapes? If yes, we preserve them; if no, we design cleaner exports.
3. **SNOMED/WS4 timing**: is coding in scope for the next study milestone, or
   demo-roadmap only?
4. **Participant identity** (D7): does the protocol need per-participant IDs at data
   collection, or is a typed participant code enough?
5. **Referrals/prescribing**: do any of the three cases require them in-flow? (Derek's
   plan is investigations, not prescriptions — suspect the answer is no.)
