# OpenScribe Architecture

This document describes how the repository is structured today, why each folder exists, and where new code should live as the system grows.

---

## Top-Level Layout

| Path | Purpose |
| --- | --- |
| `apps/` | Runtime entry points (Next.js, future apps). Each subfolder is an independently deployable UI or service. |
| `packages/` | Reusable domain modules shared across apps. Every non-Next TypeScript package lives here. |
| `config/` | Centralized tool configuration (Next, PostCSS, TypeScript test config, shadcn). Apps import from here. |
| `build/` | The **only** location for generated artifacts (Next standalone output, packaged binaries, compiled tests, etc.). Safe to delete between builds. |
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `.env*` | Root-level project metadata and shared TypeScript config. |

No other source files should sit at the root—add them to the appropriate
`apps/` or `packages/` subtree.

---

## apps/

### `apps/web`

* Next.js (App Router) implementation of OpenScribe.
* Directory tree:

  ```
  apps/web/
    .env.local              # app-specific secrets (DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, NEXT_PUBLIC_SECURE_STORAGE_KEY)
    next-env.d.ts
    next.config.mjs         # re-exports config/next.config.mjs
    postcss.config.mjs      # re-exports config/postcss.config.mjs
    tailwind.config.mjs     # Tailwind v4 config (scans app + packages)
    src/
      app/                  # routes, layouts, server actions, CSS entry point
      middleware.ts
      types/
    public/                 # images, icons, worklets
  ```

* All UI composition, routing, and server actions belong here.
* Future web-only features (e.g., marketing pages, admin panels) can live
  inside `apps/web/src/app`.
* If another frontend appears (mobile/desktop), add another folder under
  `apps/` and import the same packages.

---

## packages/

The `packages/` directory acts like a pnpm workspace. Each folder hosts an
isolated TypeScript package with its own `src/` tree. Path aliases defined in
`tsconfig.json` (e.g., `@audio`, `@storage`, `@ui`) map into these packages so apps can import domain logic without relative paths.

### `packages/pipeline`

Ordered processing stages that reflect the end-to-end workflow. Every stage
exposes a small API/contract so it can be tested and swapped individually.

```
packages/pipeline/
  audio-ingest/
  transcribe/
  assemble/
  note-core/
  render/
  medgemma-scribe/
  eval/
```

* **audio-ingest** – microphone/system audio capture hooks, resamplers,
  worklets, permission helpers.
* **transcribe** – transcription provider adapters (default Deepgram, chosen by
  `TRANSCRIPTION_PROVIDER`), segment uploader hook, WAV parsing.
* **assemble** – streaming session store, SSE helpers, overlap
  trimming, diarization handling.
* **note-core** – clinical note generation (single SOAP-format prompt),
  parsing/formatting logic, LLM orchestration (calls into `@llm`).
* **render** – React components for presenting structured notes and
  exporters (SOAP renderer, specialty variants).
* **medgemma-scribe** – fully local, text-only MedGemma scribe workflow.
  Maintains rolling transcript window, encounter state JSON, and draft
  note sections for incremental updates. No audio support.
* **eval** – regression/evaluation harness plus anonymized fixtures and
  test cases (`pnpm test:audio` compiles this package).

When expanding the pipeline (e.g., add “07_quality_control” or “08_storage”),
create another subdirectory and add a new path alias if needed.

### `packages/ui`

Reusable React components, hooks, and UI utilities consumed by the apps.
Examples: encounter list, recording view, shared buttons, Radix wrappers,
`useEncounters` hook. UI-only work that is not tied to Next-specific routing
belongs here so other apps (e.g. mobile) can reuse it.

### `packages/storage`

Secure storage utilities and repositories:

* `secure-storage.ts` – AES-GCM helpers (requires `NEXT_PUBLIC_SECURE_STORAGE_KEY`).
* `encounters.ts` – CRUD helpers for encounter objects.
* `types.ts` – domain types shared between frontend and backend.

Future persistence layers (SQLite, filesystem, remote sync) can live alongside
the current browser implementation; apps keep importing `@storage/*`.

### `packages/llm`

Provider-agnostic LLM abstraction plus versioned prompts.
Today it exposes a thin wrapper around Anthropic Claude via `runLLMRequest`,
and the clinical-note prompt in `src/prompts/clinical-note/` (a single
SOAP-format prompt).

Future expansion:
* Additional providers (OpenAI, Azure, local models).
* Retry/rate-limiting/shared logging for LLM calls.

### `packages/tests`

Placeholder for shared test harnesses outside the pipeline packages. Use this
when introducing cross-cutting integration tests, mocks, or helpers that are
not tied to a specific pipeline stage.

---

## config/

Holds all shared tool configuration. Current files:

* `next.config.mjs` – base Next configuration (CSP, headers, standalone
  output inside `apps/web/.next`).
* `postcss.config.mjs` – Tailwind v4 plugin setup.
* `tsconfig.test.json` – TypeScript config used by `pnpm build:test`.
* `components.json` – shadcn UI CLI settings (points to `@ui` aliases).

Add future configs (ESLint, Jest/Vitest, Storybook) here and have apps import
them via small stubs (similar to `apps/web/next.config.mjs`).

---

## build/

Generated artifacts only. Expected subfolders:

* `build/tests-dist/` – compiled test sources (`pnpm build:test`).

Next.js generates its standalone bundle under `apps/web/.next` (ignored by Git),
so it no longer sits inside `build/`.

This directory should be safe to delete at any time and is git-ignored.

---

## TypeScript Configuration

* Root `tsconfig.json` sets `baseUrl` and the aliases for every package
  (`@audio`, `@transcription`, `@storage`, `@ui`, etc.). Apps inherit from
  this file.
* `apps/web/tsconfig.json` extends the root config and only overrides
  `baseUrl`/paths for `@/*` so Next.js tooling works locally.
* Tests compile using `config/tsconfig.test.json`, which emits to
  `build/tests-dist`.

---

## Environment Variables

* App-specific secrets live in `apps/web/.env.local` (ignored by Git). For
  example:
  ```
  TRANSCRIPTION_PROVIDER=deepgram
  DEEPGRAM_API_KEY=...
  ANTHROPIC_API_KEY=...
  NEXT_PUBLIC_SECURE_STORAGE_KEY=base64-32-byte-secret
  ```
* Provide defaults/template via `apps/web/.env.local.example`.
* Future apps should follow the same pattern (keep `.env.local` next to the
  app, not at the repo root).

---

## Security & HIPAA Compliance

### Encryption in Transit (TLS/HTTPS)

**Requirement**: All external API calls transmitting PHI must use HTTPS to ensure data is encrypted during transmission.

**Implementation**:

1. **External API Enforcement**:
   - Transcription providers (e.g. `packages/pipeline/transcribe/src/providers/deepgram-transcriber.ts`) validate HTTPS before sending audio data
   - LLM API client (`packages/llm/src/index.ts`) validates HTTPS before sending transcript data
   - Both services reject non-HTTPS URLs with explicit security errors

2. **Production UI Warning**:
   - The application displays a security banner if accessed over HTTP in production builds (non-localhost)
   - Warning implemented via `useHttpsWarning` hook (`packages/ui/src/hooks/use-https-warning.ts`)
   - Development builds skip this check for local testing convenience

3. **Testing**:
   - Unit tests verify HTTPS enforcement in `packages/pipeline/transcribe/src/__tests__/transcribe.test.ts`
   - Integration tests validate HTTPS usage in `packages/llm/src/__tests__/llm-integration.test.ts`

**Deployment Recommendations**:
- **Self-hosted web**: Configure reverse proxy (nginx/Apache) with TLS certificates
- **Development**: HTTP on localhost is acceptable (PHI stays local)
- **Production web**: Always serve via HTTPS or block non-localhost access

<!-- For complete security implementation details, see [ENCRYPTION-GUIDE.md](ENCRYPTION-GUIDE.md) and [HIPAA-SECURITY-GAPS.md](HIPAA-SECURITY-GAPS.md). -->

---

## Naming & Linting Rules

These conventions are enforced by ESLint (`pnpm lint`) and the structure check (`pnpm lint:structure`):

- **Folders** – always kebab-case (`audio-ingest`, `note-core`). Pipeline stages must use the numbered order shown earlier (`audio-ingest`, `transcribe`, `assemble`, `note-core`, `render`, `eval`).
- **Source files** – kebab-case as well (`note-editor.tsx`, `secure-storage.ts`). Generated files belong in `build/`.
- **React components/classes/exported functions** – PascalCase (`NoteEditor`, `BadgeVariants`, `ButtonVariants`).
- **Config files** – live under `config/` and end in `.config.mjs` when the tool allows it. App-level stubs simply re-export from `config/`.
- **Top-level allowlist** – only `apps/`, `packages/`, `config/`, `build/`, `node_modules/`, and the root metadata files (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `.env*`). Everything else should move into an app/package.
- **ESLint ignores** – `build/**` and `apps/web/public/**` are ignored, so never put source there. If you need to add a new generated directory, point it into `build/`.

Breaking these rules causes CI/local `pnpm lint` to fail, so prefer renaming/moving files before adding exceptions.

---

## Adding New Functionality

1. Decide whether it is **app-specific** or **shared**.
   * App UI, routing, server actions → `apps/<app-name>/src/...`
   * Shared React components/hooks → `packages/ui`
   * Pipeline/domain logic → the appropriate `packages/pipeline/0x_*`
   * Persistence → `packages/storage`
   * LLM providers/prompts → `packages/llm`
2. Update aliases in `tsconfig.json` if a new package is added.
3. Keep generated assets confined to `build/`.

By following this structure, the project stays modular: each domain evolves in
its own package, apps consume those packages, and tooling sits in `config/`.

---

## Quick Reference: Where to Edit

This section provides a practical guide for day-to-day development work.

### Primary Development Locations

**`apps/web/src/app/page.tsx`** ⭐⭐⭐  
Main application orchestrator
- State management and workflow logic
- View transitions (idle → recording → processing → viewing)
- Integration point for all UI components
- Edit when: changing app behavior, adding features, fixing workflow bugs

**`apps/web/src/app/actions.ts`**  
Server-side functions
- Clinical note generation endpoint
- Edit when: changing server-side logic, note generation flow

**`apps/web/src/app/api/`**  
Next.js API routes
- `transcription/segment/` - Segment uploads
- `transcription/final/` - Final transcription
- `transcription/upload/` - Uploaded-file transcription
- `transcription/stream/[sessionId]/` - SSE streaming
- `settings/transcription-status/` - Active provider + live-segment flag
- Edit when: changing API endpoints, adding new routes

**`packages/ui/src/components/`** ⭐⭐⭐  
Reusable React components (edit frequently)
- `encounter-list.tsx` - Encounter history list
- `recording-view.tsx` - Recording interface
- `processing-view.tsx` - Processing status display
- `settings-dialog.tsx` - Settings modal
- `new-encounter-form.tsx` - New encounter form
- `permissions-dialog.tsx` - Permission requests
- `error-boundary.tsx` - Error handling
- `idle-view.tsx` - Initial/idle state
- `settings-bar.tsx` - Settings toolbar
- Edit when: UI changes, new components, component behavior changes

**`packages/llm/src/prompts/clinical-note/v1.ts`** ⭐⭐⭐  
The clinical-note prompt (single SOAP format)
- `getSystemPrompt()` / `getUserPrompt()` - the prompt sent to Claude
- Edit when: changing the SOAP note structure or instructions

### Occational Development Locations

**`packages/pipeline/audio-ingest/src/`**  
Audio recording and capture
- `capture/` - Recording implementation
- `devices/` - Microphone/system audio device management
- `__tests__/` - Audio capture tests
- Edit when: recording bugs, new audio features, device support

**`packages/pipeline/transcribe/src/`**  
Transcription integration
- `core/` - Transcription engine
- `hooks/` - React hooks (useSegmentUpload)
- `providers/` - Provider adapters (Deepgram, OpenAI Whisper, …)
- `__tests__/` - Transcription tests
- Edit when: transcription service changes, provider updates

**`packages/pipeline/note-core/src/`**  
Clinical note generation engine
- `note-generator.ts` - Note generation logic
- `clinical-models/` - Note structure definitions
- `preprocessing/` - Input processing
- `postprocessing/` - Output formatting
- `__tests__/` - Note generation tests
- Edit when: note generation logic, LLM orchestration

**`packages/pipeline/assemble/src/`**  
Transcript assembly and streaming
- `session-store.ts` - SSE session management
- `index.ts` - Assembly logic
- Edit when: streaming logic, transcript assembly changes

**`packages/storage/src/`**  
Data persistence layer
- `encounters.ts` - Encounter CRUD operations
- `preferences.ts` - User preferences
- `secure-storage.ts` - AES-GCM encryption utilities
- `server-api-keys.ts` - Server-side key loading (env)
- `types.ts` - Shared TypeScript types
- Edit when: data structure changes, storage logic updates

**`packages/llm/src/`**  
LLM abstraction layer
- `index.ts` - Main LLM wrapper (Anthropic Claude)
- `prompts/index.ts` - Prompt management
- `providers/` - (Future) Additional providers
- `__tests__/` - LLM integration tests
- Edit when: LLM provider changes, adding new providers

**`packages/ui/src/hooks/`**  
Shared React hooks
- `use-encounters.ts` - Encounter management hook
- Edit when: shared state logic, new hooks

**`packages/ui/src/lib/`**  
UI utilities
- `ui/` - shadcn/ui component wrappers
- `utils/` - Helper functions (cn, etc.)
- Edit when: new utilities, UI library updates

### 🛠️ Rarely Edit

**`packages/pipeline/render/src/`**  
Note display components
- `components/` - Note display components
- `renderers/` - Format-specific renderers (SOAP variants)
- Edit when: note display format changes

**`packages/pipeline/eval/src/`**  
Testing and evaluation framework
- `cases/encounter/` - Encounter test data
- `cases/testMP3/` - Audio test files
- `runtime/` - Test execution
- `tests/` - Test implementations
- `types/` - Test type definitions
- Edit when: adding tests, evaluation criteria

**`config/`**  
Centralized tool configuration
- `next.config.mjs` - Next.js config (CSP, headers, webpack aliases)
- `eslint.config.mjs` - Linting rules
- `postcss.config.mjs` - Tailwind setup
- `tsconfig.test.json` - Test compilation config
- `components.json` - shadcn UI settings
- `scripts/check-structure.mjs` - Structure linting
- Edit when: build configuration, webpack aliases, tool setup

### 🚫 Never Edit (Generated/System)

**Auto-generated folders** (safe to delete and rebuild)
- `build/` - Compiled output (tests, binaries)
- `apps/web/.next/` - Next.js build output
- `node_modules/` - Installed dependencies
- `.pnpm-store/` - pnpm package cache
- `.git/` - Git data (DO NOT DELETE)

### 🗺️ Navigation Quick Reference

**"I want to change..."**
| Goal | Location |
|------|----------|
| Main app behavior | `apps/web/src/app/page.tsx` |
| UI component | `packages/ui/src/components/<component>.tsx` |
| SOAP note prompt | `packages/llm/src/prompts/clinical-note/v1.ts` |
| Recording logic | `packages/pipeline/audio-ingest/src/` |
| Transcription | `packages/pipeline/transcribe/src/` |
| Data storage | `packages/storage/src/` |
| API endpoint | `apps/web/src/app/api/` |
| Server action | `apps/web/src/app/actions.ts` |
| Shared hook | `packages/ui/src/hooks/` |
