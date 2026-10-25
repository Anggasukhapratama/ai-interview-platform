# Fullstack Product Engineer Case Study — AI Interview Platform Revamp

**Candidate Deliverable — Steps 1 to 6**  
**Branch:** `feat/product-revamp`  
**Seeded Fault Verification Branch:** `test/seeded-fault-proof`

---

## 1. Executive Summary & Domain Immersion (Step 2)

### 1.1 Product & Architecture Overview
The **AI Interview Platform** is a multi-tenant B2B talent assessment system built with a **Ruby on Rails 7 API (`api/`)** and a **React 18 + TypeScript + Vite SPA (`web/`)**. Rather than relying on static multiple-choice quizzes or rigid one-way video recordings, the platform conducts live, adaptive, voice-to-voice behavioral and technical interviews powered by **Google Gemini Live (`BidiGenerateContent`)** over a full-duplex WebSocket bridge (`AudioWebSocketMiddleware`).

During an interview, a sidecar worker (`CoverageAnalyzerWorker` + `Coverage::Analyzer`) evaluates candidate turns after every response to track probing depth across configured **B7 Competency Taxonomy** skills (`not_yet` → `initiated` → `partial` → `covered`) and dynamically injects updated instructions (`Coverage::MapInjector`) into the live AI session. Once the interview concludes, `Portfolios::Generator` synthesizes a structured **Skill Portfolio** (`L1–L5` ratings, confidence levels, and verbatim evidence quotes), which assessors can review, override (`AssessorOverride`), export to PDF (`Exports::PdfGenerator`), and compare against specific job openings using the **Fit/Gap Engine** (`FitGap::Engine`).

### 1.2 Indonesian HRTech Market & Regulatory Context (UU PDP No. 27/2022)
In Indonesia's high-volume hiring landscape (enterprise banking, BUMN, tech unicorn, and Tech-Enabled Services), recruitment teams screen hundreds to thousands of applicants per role across diverse network conditions (mobile 4G/tethering and shared office Wi-Fi). Three domain imperatives govern production readiness:

1. **Evidence Integrity over Hallucinated Ratings:** An assessor must be able to trust that an `L1` rating means *"demonstrated L1 behavior with transcript evidence"*—not *"the candidate disconnected early or time ran out before the AI asked about this skill."*
2. **UU PDP (Undang-Undang Pelindungan Data Pribadi No. 27 Tahun 2022) Compliance:** Biometric voice streams, camera proctoring feeds, and automated AI competency profiling constitute personal data processing requiring explicit, informed, timestamped candidate consent prior to hardware capture (`Pasal 20–22 UU PDP`).
3. **Strict Multi-Tenant Isolation:** In B2B SaaS recruitment, cross-tenant leakage of candidate transcripts, portfolios, or overrides is a catastrophic trust failure.

---

## 2. Problem & Gap Analysis (Step 3)

### 2.1 Classification: Defective Implementation vs. Missing Specification

| ID | Tier | Title | Classification | Layer / Seam | Impact & Root Cause |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **P0-1** | **P0** | **Fit/Gap `expected_level` vs `required_level` Contract Mismatch** | **Defective Implementation** | `api/` ↔ `web/` Seam (`FitGap::Engine` → `ComparisonTable.tsx`) | `FitGap::Engine#build_skill_comparisons` emitted `expected_level`, whereas `ComparisonTable.tsx` read `c.required_level`, rendering `Lundefined` across the entire Required column and breaking Assessor Override indicators. |
| **P0-2** | **P0** | **Portfolio Polling Deadlock on `pending` Status (`422` vs `202`)** | **Defective Implementation** | `api/` ↔ `web/` Seam (`PortfoliosController#show` → `PortfolioPage.tsx`) | Immediately after session end, `Portfolio` is created with `generation_status: 'pending'` while Sidekiq queues `PortfolioGeneratorWorker`. `PortfoliosController#show` only returned `202 Accepted` for `generating?`, falling through to render an empty `200 OK` payload (or `422` on race) for `pending` and halting frontend polling permanently. |
| **P0-3** | **P0** | **Missing UU PDP No. 27/2022 Informed Consent Gate & Audit Trail** | **Missing Specification** | Fullstack (`sessions` DB, `SessionsController`, `InterviewPage.tsx`) | Candidates were dropped directly into camera/microphone capture and AI profiling without any privacy notice, consent checkbox, or database audit timestamp (`consent_given_at`, `consent_version`). |
| **P0-4** | **P0** | **Multi-Tenant IDOR Vulnerability on Portfolios & Overrides** | **Defective Implementation** | `api/` Security (`PortfoliosController`, `PortfolioSkillsController`) | `set_portfolio` in `PortfoliosController` and `set_portfolio_skill` in `PortfolioSkillsController` queried `Portfolio.find_by(session_id: ...)` and `PortfolioSkill.find(...)` without scoping to `current_tenant_id`, allowing an authenticated assessor in Tenant B to read or override Tenant A's candidate portfolios. |
| **P0-5** | **P0** | **Silent Fabrication of `L1` Ratings for Unprobed / 0-Turn Skills** | **Missing Specification & Defective Implementation** | `api/` ↔ `web/` (`Portfolios::Generator`, `PortfoliosController`, `PortfolioPage.tsx`) | When a session ended early (manual end, disconnect, or time ceiling) before all configured skills were probed (`state == 'not_yet'`, `probe_count == 0`), `Portfolios::Generator` allowed fabricated `L1` ratings instead of separating unassessed skills (`unassessed_skills`). |
| **P0-6** | **P0** | **Ruby 4.0 `LoadError: cannot load such file -- ostruct` in Auth** | **Defective Implementation** | `api/` (`AuthorizeApiRequest`) | `AuthorizeApiRequest` required `'ostruct'`, which was removed from Ruby's default gems in Ruby 4.0, crashing authenticated API endpoints unless replaced with native `Struct`. |
| **P1-1** | **P1** | **Destructive Portfolio Regeneration Wipe (`AssessorOverride` Loss)** | **Defective Implementation** | `api/` (`Portfolios::Generator#save_skills`) | `portfolio.portfolio_skills.destroy_all` ran outside an atomic transaction and cascaded deletion to `assessor_overrides` (`dependent: :destroy`), wiping human assessor judgments on regeneration. |
| **P1-2** | **P1** | **Cross-Language Fit/Gap False `not_assessed` on Label Mismatch** | **Defective Implementation** | `api/` (`FitGap::Engine#find_portfolio_skill`) | Matched vacancy skills against portfolio skills solely by `skill_label` string equality before checking canonical `skill_id`, causing Indonesian assessments (`Desain Sistem`) compared against English vacancies (`System Design`) to fail matching despite sharing `SK-ENG-003`. |
| **P1-3** | **P1** | **Audio WebSocket Binary Frame Corruption & Reconnect Race** | **Defective Implementation** | `api/` (`AudioWebSocketMiddleware`, `AudioRingBuffer`, `EndHandler`) | Binary PCM frames (`Array<Integer>`) passed through `JSON.parse` rescue flow; candidate browser refresh left the old socket's 120s `graceful_end_timer` running (killing the live interview 2 minutes later); `AudioRingBuffer` lacked `write`/`empty?`/`drain` methods expected by reconnect replay. |
| **P1-4** | **P1** | **Candidate Invite URL Pointing to Backend API Port (`3001`)** | **Defective Implementation** | `api/` (`Session#invite_url`) | `Session#invite_url` used `BACKEND_BASE_URL` (`http://localhost:3001/interview/:token`) instead of `FRONTEND_BASE_URL` (`http://localhost:5173/interview/:token`), resulting in a 404 when candidates clicked their invite link. |
| **P1-5** | **P1** | **Client-Only Interview Timer Reset on Page Refresh** | **Defective Implementation** | `api/` ↔ `web/` (`SessionsController#candidate_info`, `InterviewTimer.tsx`) | `InterviewTimer` initialized its countdown solely from `timeLimitMin * 60` in React state without anchoring to server `started_at`, resetting the clock whenever the candidate refreshed the page. |
| **P1-6** | **P1** | **Async-Only `system_prompt` Race & Silent Delete Failures** | **Defective Implementation** | `api/` (`AssessmentsController`, `VacanciesController`) | Creating an assessment and immediately starting a session raced against Sidekiq `SystemPromptGeneratorWorker`, leaving `system_prompt` nil; `destroy` actions ignored `restrict_with_error` return values and returned `200 OK` even when deletion failed. |
| **P2-1** | **P2** | **Hardcoded Cloudflare Speed Test Blocking Corporate Firewalls** | **Defective Implementation** | `web/` (`internetSpeedTest.ts`, `vercel.json`) | Hard-failed hardware check when `speed.cloudflare.com` was blocked by enterprise firewalls; `vercel.json` blocked camera (`camera=()`) and omitted `speed.cloudflare.com` from CSP `connect-src`. |
| **P2-2** | **P2** | **Prawn PDF Crash on Unicode Characters (`→`, `—`, Smart Quotes)** | **Defective Implementation** | `api/` (`Exports::PdfGenerator`) | Prawn's built-in Helvetica font uses `WinAnsiEncoding` and raised `Prawn::Errors::IncompatibleStringEncoding` whenever AI narratives or transcripts contained `→` or `—`. |
| **P3-1** | **P3** | **Assessment / Vacancy Form Validation & LiveMonitor Truncation** | **Defective Implementation** | `web/` (`AssessmentEditPage.tsx`, `VacancyEditPage.tsx`, `LiveMonitorPage.tsx`) | Allowed saving assessments/vacancies with 0 skills or duplicate skills; `LiveMonitorPage` truncated live transcripts to `.slice(-10)` and lacked HTTP coverage polling fallback when WebSocket disconnected. |

### 2.2 Constraint Signal Analysis
We evaluated what had to be fixed immediately in this revamp cycle versus what was intentionally scoped out:
- **In-Scope (Must Fix Now):** Multi-tenant security (`P0-4`), `api/` ↔ `web/` data contract integrity (`P0-1`, `P0-2`, `P0-5`), UU PDP candidate consent (`P0-3`), assessor override preservation (`P1-1`), canonical `skill_id` matching (`P1-2`), WebSocket binary/reconnect resilience (`P1-3`), and server-anchored timer (`P1-5`).
- **Scoped Out (Future Roadmap):** Full PostgreSQL Row-Level Security (RLS) policy migration across legacy `rakamin-api` tables, server-side WebRTC TURN relay clusters, and custom TTF font bundling for CJK glyphs in Prawn PDF exports.

---

## 3. Revamp Strategy, Acceptance Criteria & Trade-offs (Step 4)

### 3.1 Self-Defined Acceptance Criteria (AC-1 to AC-8)
- **AC-1 (Fit/Gap Contract & Canonical Matching):** `FitGap::Engine` emits both `expected_level` and `required_level`, `ai_level`, and `is_override`. `ComparisonTable.tsx` renders exact `L1–L5` labels and `Assessor Override` badges without `Lundefined`. Matching prioritizes case-insensitive `skill_id` before `skill_label`.
- **AC-2 (Zero Fabricated `L1`s for Unassessed Skills):** Sessions with 0 candidate turns produce 0 `PortfolioSkill` rows. Skills with `state == 'not_yet'`, `probe_count == 0`, and no transcript evidence are excluded from `portfolio_skills` and returned in `unassessed_skills`, rendered in a dedicated **"Unassessed Skills (Not Evaluated)"** section on `PortfolioPage.tsx`.
- **AC-3 (Resilient Portfolio Polling & Regeneration):** `GET /api/v1/sessions/:id/portfolio` returns `202 Accepted` (`{ status: 'generating' }`) when `@portfolio.nil? || @portfolio.in_progress?` (`pending` or `generating`). `PortfolioPage.tsx` polls up to 36 attempts (3 minutes) with a manual retry CTA. Regenerating a portfolio wraps skill replacement in `ActiveRecord::Base.transaction` and restores existing `AssessorOverride` records.
- **AC-4 (UU PDP No. 27/2022 Informed Consent):** Candidates must review and accept the bilingual (ID/EN) UU PDP privacy & AI recording notice on `InterviewPage.tsx` before camera/microphone hardware checks begin. Acceptance persists `consent_given_at` and `consent_version` via `POST /api/v1/sessions/:token/consent`.
- **AC-5 (Multi-Tenant IDOR Prevention):** `PortfoliosController` and `PortfolioSkillsController` scope all queries through `Session` with `sessions: { tenant_id: current_tenant_id }`. Cross-tenant requests deterministically return `404 Not Found`.
- **AC-6 (WebSocket Reconnect & Server-Anchored Timer):** Reconnecting candidates cancel any stale `graceful_end_timer` via `ACTIVE_CONNECTIONS` registry; `AudioRingBuffer` supports `write`, `empty?`, and `drain` for seamless Gemini audio replay; `InterviewTimer.tsx` computes remaining time from server `started_at`.
- **AC-7 (Synchronous Prompt Compilation & Cache Invalidation):** `AssessmentsController#create` and `#update` compile `system_prompt` synchronously via `Prompts::SystemPromptCompiler` before queuing background work. `VacanciesController#update` invalidates stale `FitGapReport` caches when vacancy skills change.
- **AC-8 (Graceful Network Fallback & PDF Encoding Safety):** `internetSpeedTest.ts` falls back to API latency measurement if `speed.cloudflare.com` is blocked by corporate firewalls; `Exports::PdfGenerator` sanitizes non-WinAnsi Unicode characters before Prawn rendering.

### 3.2 Architectural Trade-offs (Option A vs. Option B)
1. **Unassessed Skills Representation:**
   - *Option A:* Add a nullable `ai_level` column to `portfolio_skills` and store unprobed skills as rows with `ai_level: nil` (requires dropping DB `NOT NULL` and `CHECK (ai_level >= 1 AND ai_level <= 5)` constraints).
   - *Option B (Chosen):* Keep `portfolio_skills` strictly for evaluated skills with valid `1..5` levels and derive `unassessed_skills` dynamically in `PortfoliosController` by diffing `session.coverage_maps.configured` against `portfolio.portfolio_skills`. This preserves database check constraints and prevents accidental numeric aggregation bugs in downstream analytics.
2. **Fit/Gap Contract Normalization:**
   - *Option A:* Change only `ComparisonTable.tsx` to read `expected_level`.
   - *Option B (Chosen — Dual-Key Normalization):* Emit both `expected_level` and `required_level` in `FitGap::Engine` AND normalize existing JSONB rows in `PortfoliosController#fit_gap_json` while updating `ComparisonTable.tsx` to `c.required_level ?? c.expected_level`. This guarantees backward compatibility with already-persisted `fit_gap_reports` rows in PostgreSQL without requiring a destructive data backfill.

---

## 4. Monozukuri Implementation, Verification & AI Verification Moment (Step 5)

### 4.1 Automated Test Suite Results
- **Backend (`api/` — RSpec):** 16 examples, 0 failures (`bundle exec rspec --format documentation`)
  - `spec/lib/audio_ring_buffer_spec.rb` (3 examples)
  - `spec/services/fit_gap/engine_spec.rb` (2 examples)
  - `spec/services/portfolios/generator_spec.rb` (3 examples)
  - `spec/requests/api/v1/multi_tenant_and_session_lifecycle_spec.rb` (8 examples)
- **Frontend (`web/` — TypeScript + Vite Build & Node Test Runner):**
  - `npm run build` (`tsc && vite build`): 0 errors, production bundle compiled cleanly.
  - `npm test` (`node --test tests/frontend_contracts.test.mjs`): 4 tests, 0 failures.

### 4.2 AI Verification Moment (Critical Inspection of AI-Generated Code)
During Step 5, we encountered two concrete **AI Verification Moments** where inspecting the actual runtime/codebase prevented silent production failures:

1. **`AudioRingBuffer` Interface & Return-Type Verification:**
   - When wiring `AudioWebSocketMiddleware#replay_buffered_audio` (`state.audio_ring_buffer.drain`) and `#handle_browser_audio` (`state.audio_ring_buffer.write(pcm_data)`), initial AI-assisted code assumed `AudioRingBuffer` implemented `.write`, `.empty?`, and `.drain` returning an `Array<String>`.
   - By inspecting `api/app/lib/audio_ring_buffer.rb` and `AudioWebSocketMiddleware#replay_buffered_audio` (`state.gemini_client.send_audio(buffered)`), we discovered:
     1. `AudioRingBuffer` originally only defined `#push(pcm_bytes, timestamp:)`, `#since`, `#size`, `#count`, and `#clear`—calling `.write`, `.empty?`, or `.drain` would have raised `NoMethodError` during a live Gemini reconnect!
     2. `state.gemini_client.send_audio(buffered)` expects a **concatenated binary `String`** (`@chunks.map(&:data).join`), not an `Array` of chunks (which our unit test in `spec/lib/audio_ring_buffer_spec.rb` verified when comparing `buffer.drain`).
2. **Ruby 4.0 `ostruct` Removal Caught by Request Specs:**
   - Running our RSpec request specs immediately revealed `LoadError: cannot load such file -- ostruct` in `app/auth/authorize_api_request.rb:3` because Ruby 4.0 removed `ostruct` from default gems. Replacing `OpenStruct.new` with a native `Struct.new(:id, :role, :scheme, keyword_init: true)` (`UserPrincipal`) eliminated the external gem dependency and restored all authenticated endpoints.

### 4.3 Seeded Fault Test Proof
To prove our automated tests genuinely guard the business logic and are not tautological:
1. On branch `test/seeded-fault-proof`, we intentionally introduced a seeded fault in `FitGap::Engine#find_portfolio_skill` (reverting to label-only matching and omitting `required_level`).
2. Running `bundle exec rspec spec/services/fit_gap/engine_spec.rb` immediately failed with:
   `Failure/Error: expect(sys_design_comp['result']).to eq('match') — expected: "match", got: "not_assessed"`.
3. We committed the seeded fault and then reverted it via `git revert HEAD` on `test/seeded-fault-proof` so the git commit history visibly records both the fault and its revert.
