# Project Management SaaS

A multi-tenant project management app for software teams: workspaces, projects, issues, Kanban,
Scrum sprints, reports and notifications, with a separate platform-administration console.
Built as a portfolio project to production-style quality gates (Baseline 3.0 specification in
[`docs/baseline-v3/`](docs/baseline-v3)).

![Active sprint with burndown](docs/screenshots/05-active-sprint-burndown.png)

## Key features

- **Workspaces & teams** — invitations by email (7-day single-use tokens), roles (Owner/Admin/Member),
  atomic ownership transfer, member removal cascade, per-workspace reporting timezone.
- **Projects & issues** — epics, stories, tasks, bugs and subtasks with a validated hierarchy,
  labels, comments with @mentions and moderation, watchers, activity history, soft delete/restore,
  per-role field permissions.
- **Kanban & backlog** — five-column board, keyboard-accessible "Move to…" fallback,
  rank ordering with transactional rebalancing.
- **Sprints** — plan, start (commitment frozen), scope changes, complete with carry-over, cancel.
- **Reports** — workspace dashboard, project analytics, burndown (actual vs ideal, unestimated
  issues listed), velocity, workload; all day boundaries in the workspace timezone.
- **Attachments** — private S3-compatible storage, 5-minute signed URLs, 10 MB limit,
  extension/MIME allow-list plus magic-byte sniffing.
- **Notifications & email** — transactional outbox, background worker with retries, re-authorized
  at delivery; in-app inbox with unread badge.
- **Platform admin** — separate sign-in and session, metrics and job health, workspace
  suspension with audited reasons, read-only user directory; never sees tenant content.
- **UX** — responsive (390 px → desktop), light/dark/system themes, WCAG 2.2 AA checks with axe.

## Tech stack & architecture

| Layer | Choice |
|---|---|
| Web | React 19, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS |
| API | Node.js 22, Express 5 modular monolith, Zod request **and** response validation |
| Data | PostgreSQL 16, Prisma 6, committed migrations, composite tenant foreign keys |
| Jobs | `apps/worker`: DB outbox (`FOR UPDATE SKIP LOCKED` leases, backoff, dead-lettering) + hourly jobs under an advisory lock |
| Files | S3-compatible adapter (MinIO locally) |
| Contracts | `packages/shared` Zod schemas used by web and API; OpenAPI 3.1 generated from them ([`docs/openapi.json`](docs/openapi.json)) |

```
apps/web      React app            apps/api   Express modules (auth, workspaces, projects,
apps/worker   outbox + scheduler                issues, sprints, reports, notifications, platform-admin)
packages/shared  Zod contracts      prisma/    schema, migrations, seeds
```

Request flow: route → Zod validation → policy helper (tenant resolved from the URL's resource
ancestry and the caller's membership) → domain service → Prisma.

## Security & multi-tenant design

- Every tenant query is scoped by workspace/project resolved server-side; a `workspaceId` in a
  request body is never trusted. Resources outside your scope return **404**, not 403.
- Composite foreign keys keep child rows inside their tenant at the database level.
- Argon2id passwords; opaque, hashed session/invite/reset tokens; HttpOnly + Secure +
  SameSite=Lax cookies; double-submit CSRF with an Origin check; session rotation on login and
  privilege change; rate-limited auth and invitations.
- Separate APP and PLATFORM sessions (different cookies, kinds and guards). A platform admin holds
  no workspace membership and has no route to issues, comments or files.
- Outbox payloads carry reference IDs only; email links are minted by the worker at send time.
- Audit log for sensitive actions (ownership, removals, moderation, suspensions, platform sign-ins).

## Local setup

Requirements: Node 22, Docker (for Postgres, Mailpit, MinIO).

```sh
npm ci
cp .env.example .env               # local placeholder values
docker compose up -d               # postgres, mailpit (http://localhost:8025), minio + private bucket
npx prisma migrate deploy
npm run dev:api                    # http://localhost:4000
npm run dev:worker                 # delivers email + notifications
npm run dev:web                    # http://localhost:5173
```

Optional fictional demo data (only into an **empty** database):
`DEMO_SEED_CONFIRM=yes DEMO_PASSWORD=<temp-password> npm run db:seed:demo` — sign in as
`maya@demo.example` (and five other fictional users).

## Testing

```sh
npm run lint && npm run format:check && npm run typecheck
npm test                                       # unit tests (shared, API, web)
DATABASE_URL=postgresql://pm:pm_local_only@localhost:5432/pm_test npm run test:integration
E2E_DATABASE_URL=postgresql://pm:pm_local_only@localhost:5432/pm_test npm run e2e   # Playwright
npm run openapi -w @pm/api                     # regenerate docs/openapi.json
```

Integration and E2E suites truncate their database and refuse anything except a local database
whose name ends in `_test`. CI (GitHub Actions) runs checks, integration and Playwright jobs, each
against its own throwaway Postgres container.

## Screenshots

Captured from the fictional demo seed ([`docs/screenshots/`](docs/screenshots)).

| | |
|---|---|
| ![Workspace dashboard](docs/screenshots/01-workspace-dashboard.png) | ![Kanban board](docs/screenshots/02-kanban-board.png) |
| ![Issue detail](docs/screenshots/04-issue-detail.png) | ![Project reports](docs/screenshots/06-project-reports.png) |
| ![Board, dark theme](docs/screenshots/07-board-dark.png) | ![Mobile notifications](docs/screenshots/08-mobile-notifications.png) |

## Deployment

Prepared for a single low-cost VPS with Docker Compose, Caddy (automatic HTTPS), a private
S3-compatible bucket and an SMTP provider — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
**Not deployed yet.**

## Known limitations

See [`docs/GAPS.md`](docs/GAPS.md). In short: avatar upload is deferred; the theme preference is
stored per browser; attachments are verified against a SigV4-checking S3 test double, and
verification against real MinIO/S3 is pending; the production Docker stack has not been run.
