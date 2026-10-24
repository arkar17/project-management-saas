# CLAUDE.md — Project Management SaaS (Baseline 3.0)

## 1. Objective and stack
A multi-tenant project management SaaS, built to portfolio quality, where software teams plan, run (Scrum/Kanban), collaborate on and analyse their work.
One app with many logically isolated workspaces. Credits expire **5 Nov 2026**. Quality gates take precedence over ticking boxes.
- **Web:** React + TypeScript + Vite + React Router, Tailwind + shadcn/ui, TanStack Query.
- **API:** Node.js + Express + TypeScript as a modular monolith grouped by domain, with Zod validation on requests and responses.
- **DB:** PostgreSQL + Prisma, with migrations committed.
- **Jobs:** DB outbox + worker (`apps/worker`).
- **Files:** private S3-compatible storage behind an adapter.
- **Ops:** Docker Compose locally, GitHub Actions CI, structured JSON logs with request ID.
- Monorepo/package tooling and test runners are G1 implementation choices. Record them here once chosen; do not open an ADR for them.

## 2. Authoritative documents (`docs/baseline-v3/`, approved, read-only)
| Topic | File |
|---|---|
| Requirements (FR/NFR, roles, acceptance scenarios) | `01_Software_Requirements_Specification_v3.docx` |
| Architecture, 22 entities, route inventory, tenant isolation | `02_Technical_Architecture_and_Data_Model_v3.docx` |
| Gates, test strategy, definition of done | `03_Implementation_Quality_and_Documentation_Plan_v3.docx` |
| Decisions ADR-001…020 | `ADR_LOG_v3.md` |
| INC-01…27 (all resolved) | `INCONSISTENCY_REGISTER_v3.md` |
| Role × capability and issue-field policy | `PERMISSION_MATRIX_v3.csv`, `04_role_permissions.drawio` |
| FR → entity → API → flow → TC-* | `TRACEABILITY_REPORT_v3.md` |
| Workflow, user flows, ERD, sitemap | `01`–`05_*.drawio` (see `README_DIAGRAMS.md`) |

- To read a `.docx`, convert it once to the scratchpad (`pandoc -t plain`) and grep the section you need. Do not reprint whole documents.
- Baseline 3.0 is the approved architecture. Do not redesign the schema or the business rules.
- If you find a **genuine contradiction**, stop. Report it and record it as a new `INC-28+` entry. Do not resolve it silently.

## 3. Repository architecture and conventions
```
apps/web      React screens, routing, API client
apps/api      Express route modules + domain services
apps/worker   outbox processor + scheduled jobs (sprint daily metrics, invitation expiry)
packages/shared  Zod DTOs/contracts, enums, date/report rules (single source for web + api)
packages/ui   reusable components (optional)
prisma/       schema, migrations, seed
docs/         baseline-v3 (frozen), OpenAPI 3.1, runbook
.github/workflows  CI
```
- API modules: `auth`, `workspaces`, `projects`, `issues`, `sprints`, `reports`, `notifications`, `platform-admin`. Keep them separate.
- Request flow: route → Zod validation → **policy helper** → domain service → Prisma. Routes never call Prisma directly, and the client never writes to the DB.
- API conventions: `/api/v1` prefix; errors shaped `{code,message,details,requestId}`; pagination defaults to 25, max 100.
- Status codes follow **ADR-015** exactly: 401, 403, 404 for hidden resources, 409 for state/version conflicts, 410, 422, 429.
- Reuse what exists first: shared DTOs, policy helpers, UI components. Do not duplicate files or create extra docs.
- TypeScript is strict. Lint and format must be clean. Name files and symbols after their domain. Comments explain *why*.
- Every screen has loading, empty and error states and works at 390px, 768px and desktop widths.

## 4. Development gates (plan §2)
| Gate | Target | Pass condition |
|---|---|---|
| G1 | Oct 22–24 | Monorepo; migrations with composite FKs and partial unique indexes; APP/PLATFORM sessions; PlatformAdmin seed; tenant isolation tests; API skeleton |
| G2 | Oct 24–27 | Workspaces (invitation lifecycle, removal cascade, ownership transfer, timezone), projects, issues, permissions, comments with moderation; tested and with UI |
| G3 | Oct 27–30 | Kanban (Member status rule, PM ranking), backlog, sprint lifecycle incl. cancel and scope change, epics/subtasks, watchers, uploads |
| G4 | Oct 30–Nov 2 | Dashboards, burndown, velocity, workload (workspace timezone), notifications/outbox, scheduled jobs, platform admin |
| G5 | Nov 2–5 | Security/a11y QA, full regression, demo seed, CI, deployment, screenshots, portfolio README |

- Build complete **vertical slices**: UI, API, DB, permissions and tests together. A mocked screen is never "done".
- Order of priority: P0 (release-blocking), then P1, then P2. If time runs short, keep a written gap list rather than claiming features work.
- **Definition of done:**
  - Behaviour matches its FR.
  - Permissions are enforced in the API and reflected in the UI.
  - Tests cover the success, invalid, unauthorized, cross-tenant and conflict paths.
  - OpenAPI is updated.
  - No secrets are committed.

## 5. Authorization and tenant isolation (SRS §3–4, ADR-002/007/008/011/012/020)
- **Roles have two layers.** `WorkspaceMember` holds OWNER/ADMIN/MEMBER; `ProjectMember` holds PROJECT_MANAGER/MEMBER. There is no global user role.
  - Owner/Admin have implicit admin rights on every project in their workspace.
  - PM and Member need an ACTIVE `ProjectMember` row.
- There is exactly one ACTIVE OWNER per workspace. Admins cannot change or remove the Owner. Ownership transfers atomically, and the old Owner becomes ADMIN.
- **Members** may edit only title, description, dueAt and status, and only on issues they are assigned to or reported. A status change appends the issue to the end of the target column. Members cannot reorder.
- `PERMISSION_MATRIX_v3.csv` is the policy, and policy tests are generated from it. Field allow-lists are enforced server-side in one policy per rule.
- **Resolving the tenant:**
  - Resolve the workspace from the authenticated membership plus the URL's resource ancestry (Issue → Project → Workspace). Never trust a `workspaceId` in the request body.
  - Every list or mutation selector filters on `workspaceId`/`projectId`, and that includes report aggregates.
  - A resource outside the caller's scope returns **404**, not 403.
- **Platform admins:**
  - Use a separate `/platform` namespace, PLATFORM session kind and PlatformAdmin guard.
  - PLATFORM sessions are rejected on tenant routes, and APP sessions are rejected on `/platform`.
  - A PlatformAdmin record grants no workspace membership and no access to tenant content.
- Other rules:
  - Suspended workspaces return 403 `WORKSPACE_SUSPENDED`. Archived projects are read-only and return 409 `PROJECT_ARCHIVED`.
  - The outbox payload carries reference IDs only, and access is re-checked at delivery.

## 6. Database migrations and security
- The Prisma schema must match ERD `03_database_erd.drawio` and Architecture §4. Any schema change updates the ERD and the cross-check in the same commit.
- **Composite tenant FKs** (ADR-011) and the partial unique indexes and indexes listed in Architecture §8 are mandatory.
- Every FK is `RESTRICT`. The one exception is `IssueLabel.labelId`, which uses CASCADE.
- No hard deletes of users, workspaces, projects, issues, comments, attachments, activity or audit rows. Use soft delete or archive (ADR-014/019).
- Migrations are versioned, committed and reproducible on a fresh DB. Writing a migration file is allowed. **Applying** one requires approval.
- Mutations listed in Architecture §8 run in transactions. The outbox row is written in the same transaction as the change.
- **Security rules:**
  - Hash passwords with Argon2id.
  - Session, invite and verification tokens are opaque and stored hashed.
  - Cookies are HttpOnly + Secure + SameSite=Lax.
  - Mutations require a double-submit CSRF token and an Origin check.
  - Rotate the session on login or privilege change.
  - Rate-limit auth and invitations.
  - Use strict CORS and security headers. Sanitize rich text.
  - Files: max 10 MB, MIME allowlist plus content sniffing, 5-minute signed URLs, no public bucket.
  - Never log passwords, tokens or personal data. Redact secrets.
- **Never commit secrets.** Keep `.env*` gitignored and commit only `.env.example` with placeholder values. Demo data is fictional.

## 7. Testing and acceptance
- **Unit:** policy helpers, field allow-lists, hierarchy matrix, key allocator, sprint math, timezone day boundaries, analytics.
- **Integration:** every mutating endpoint (authorization + validation), cross-tenant attempts with guessed IDs, composite-FK violations, invitation lifecycle, removal cascade, and ADR-015 codes.
- **E2E:** register/invite → project → issue → board → sprint → report, across multiple roles and denied routes.
- **Security and accessibility:** session fixation, APP/PLATFORM separation, CSRF, IDOR, attachment ACL, rate limits; keyboard navigation and WCAG 2.2 AA as the target.
- Test names carry their **TC-\* ID** from `TRACEABILITY_REPORT_v3.md` (e.g. `TC-AUTH-002-3 …`).
- During development, run **focused tests only** (the changed package or file). Run the full regression only when closing a gate (G1–G5).
- **Release (plan §8):**
  - No cross-tenant leakage.
  - Every TC-\* passes or is listed as a known gap.
  - A fresh install plus migrations works.
  - Role-based E2E journeys pass.
  - Reports reconcile with the data.
  - ERD and Prisma are in sync.

## 8. Git and pull requests
- Work on the assigned `claude/*` branch. Never push to `main` or force-push a shared branch.
- Keep commits small and scoped to one slice, with imperative messages, e.g. `feat(issues): add assignee eligibility (FR-ISS-009)`.
- Before you push, lint, typecheck and the focused tests must be green.
- Open PRs only when asked. Each PR covers one slice or gate and references the FR and TC IDs, the tests run, the migration impact and known gaps.
- CI (NFR-08) runs lint, format, typecheck, unit/integration tests, the web build and a smoke E2E.

## 9. Approval required (ask first)
Ask before you:
- apply migrations (`prisma migrate dev/deploy`, `db push`)
- create or seed DB records
- run anything destructive (DB reset, dropping data, `rm -rf`, rewriting history)
- deploy
- create paid infrastructure
- change an approved ADR or baseline decision

## 10. Cloud credit discipline
- Do not use subagents or parallel agents. Do the work inline.
- Read only the doc section the task needs. Do not rescan the whole repository or reprint documents.
- Inspect the existing code before writing. Implement only what is missing, and never regenerate scaffolds.
- Run targeted tests and keep terminal output short (use `--silent` or tail the logs).
- Keep summaries short, and produce no reports unless asked.
- Stop when the requested task is done.

## 11. Session handoff format (end every session with this)
```
Completed:   <slice/FR IDs>
Tests:       <commands run → pass/fail counts>
Changed:     <key files>
Migrations:  <created / applied (with approval) / none>
Blockers:    <INC items, approvals needed>
Next task:   <single next step + gate>
```
