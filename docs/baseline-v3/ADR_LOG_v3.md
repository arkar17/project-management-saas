# Architecture Decision Records — Baseline 3.0

**Status of all ADRs:** Accepted · 21 Oct 2026 · Owner: Lead Architect / Technical Product Owner
**Applies to:** SRS v3, Architecture & Data Model v3, Implementation & Quality Plan v3, diagrams 01–05 (Baseline 3.0)
ADR-001…005 were listed as "to verify" in Architecture v2 and are now decided. ADR-006…020 resolve INC-01…INC-27; the INC column shows which register items each ADR closes. Decisions marked **(directed)** were given by the product owner; all others are the safest, simplest option within Release 1.0 scope, with the rationale stated.

| ADR | Title | Resolves |
|---|---|---|
| 001 | Cookie sessions, session kinds, CSRF | INC-03 (part) |
| 002 | Tenant authorization service | INC-15 (part) |
| 003 | Burndown and velocity semantics | INC-18 (part), INC-19 (part) |
| 004 | Attachment storage and signed URLs | INC-08 (part) |
| 005 | Outbox processing, retry and dedupe | — |
| 006 | Issue type hierarchy; immutable project | INC-01, INC-25 |
| 007 | Platform administration identity | INC-03 |
| 008 | Member status changes and ordering | INC-06, INC-24 |
| 009 | Data-model completion: projects, priorities, timestamps, points | INC-14 |
| 010 | Issue watchers | INC-02 |
| 011 | Composite tenant keys; derived Owner | INC-04, INC-05, INC-09 |
| 012 | Membership removal, ownership transfer, assignee eligibility | INC-10, INC-11, INC-21 |
| 013 | Invitation lifecycle; account-neutral registration | INC-12, INC-20 |
| 014 | Archive vs soft delete; comment moderation | INC-07, INC-13 |
| 015 | HTTP status-code contract | INC-15 |
| 016 | Kanban transitions and ranking | INC-16, INC-17 |
| 017 | Sprint lifecycle edge cases | INC-18 |
| 018 | Reporting timezone and scheduled jobs | INC-19 |
| 019 | Foreign keys, deletion behaviour, indexes; API completion | INC-08, INC-26 |
| 020 | Member-list visibility; matrix clean-up; deliverable mapping | INC-22, INC-23, INC-27 |

---

## ADR-001 — Cookie sessions, session kinds, CSRF
**Context.** Arch v2 required DB-backed cookie sessions and CSRF but left the strategy open; platform admin needs a separate gate (FR-ADM-001).
**Decision.** Opaque 256-bit session token, stored as SHA-256 `tokenHash`. Cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`. Two session kinds: `APP` (cookie `pm_sid`, 7-day sliding expiry) and `PLATFORM` (cookie `pm_psid`, 8-hour absolute expiry). APP sessions are rejected by `/platform/*` and PLATFORM sessions by tenant routes (401). CSRF: double-submit token (`X-CSRF-Token` header must match a non-HttpOnly cookie) plus `Origin` allow-list check on every mutating request. Session ID rotated on login, password change, ownership transfer and role change of the caller; password reset and change revoke other sessions.
**Consequences.** One `Session` table with a `kind` column; no JWTs; CORS limited to the SPA origin with credentials.

## ADR-002 — Tenant authorization service
**Decision.** Every route calls `authorize(actor, action, resourceRef)`. The service loads the resource's ancestry (Issue → Project → Workspace) in one query, ignores any client-supplied workspaceId, checks the ACTIVE WorkspaceMember, workspace status, effective role (max of workspace and project grants), capability (PERMISSION_MATRIX_v3.csv), resource state (archived project, soft-deleted issue), and the field allow-list for issue PATCH. Hidden resources return 404 (ADR-015). List queries always filter by `workspaceId` and the caller's accessible `projectId` set.
**Consequences.** One policy module with unit tests generated from the CSV matrix; frontend only mirrors it for discoverability.

## ADR-003 — Burndown and velocity semantics
**Decision.** At start, every issue in the sprint gets a `SprintIssueHistory` row with `committedAt` and `committedPoints` = its storyPoints (null → 0, flagged "unestimated"). `remainingCommittedPoints(day)` = Σ committedPoints of committed issues not DONE at the end of that day (workspace timezone, ADR-018) and still in the sprint; later changes to storyPoints do not alter committed values. Issues added after start get a history row without `committedAt`; their points at time of addition are added to `scopeAddedPoints` for that day. Removal (or soft delete) sets `removedAt` and removes the issue from both series from that day. At completion, DONE issues get `completedAt` and `completedPoints` (current points). **Velocity** = Σ completedPoints of a COMPLETED sprint, default last 6; CANCELLED sprints excluded.
**Consequences.** Reports are reproducible from `SprintIssueHistory` + `IssueActivity`; `SprintDailyMetric` is a cache that can be recomputed.

## ADR-004 — Attachment storage and signed URLs
**Decision.** S3-compatible adapter interface (`putSignedUrl`, `getSignedUrl`, `head`, `delete` reserved for retention tooling). Upload: client requests `POST /issues/:iid/attachments` → server validates declared MIME/size, returns 5-minute signed PUT; client confirms; server `HEAD`s the object, sniffs magic bytes, rejects mismatches, then writes `Attachment`. Download: `GET /attachments/:aid/download` re-authorizes via the issue and returns a 5-minute signed GET with `Content-Disposition: attachment`. Allow-list: png, jpeg, gif, webp, pdf, txt, csv, md, zip; max 10 MB. Object keys are random (`ws/{wid}/att/{uuid}`), unique, never derived from file names.

## ADR-005 — Outbox processing, retry and dedupe
**Decision.** `OutboxEvent(status PENDING|PROCESSED|DEAD, attempts, availableAt, lastError)`. Worker polls `status='PENDING' AND availableAt <= now()` with `FOR UPDATE SKIP LOCKED`, batch 50. On failure `attempts+1`, `availableAt = now() + 2^attempts × 30 s`; at 8 attempts → `DEAD`, error logged and surfaced in platform job-health metrics. Notification insert uses `ON CONFLICT (recipientId, dedupeKey) DO NOTHING`; `dedupeKey = topic:entityId:recipientId[:version]`. Recipients are re-authorized at delivery; actor never notified.

## ADR-006 — Issue type hierarchy; immutable issue project **(directed)**
**Decision.** `IssueType = EPIC | STORY | TASK | BUG | SUBTASK`. Allowed parent → child: EPIC → STORY/TASK/BUG; STORY/TASK → SUBTASK. EPIC has no parent; SUBTASK must have a parent; BUG and SUBTASK have no children; depth ≤ 2. Parent must be in the same project (composite FK, ADR-011). Changing `type` or `parentId` must keep the matrix valid for the issue and its children (422 otherwise). An issue's `projectId` is immutable for every role; cross-project moves are not supported in Release 1.0 (INC-25).
**Rationale.** Keeps PROJECT-### keys immutable and avoids cross-project re-keying.

## ADR-007 — Platform administration identity **(directed)**
**Decision.** New entity `PlatformAdmin(id, userId UNIQUE FK→User, status ACTIVE|REVOKED, grantedAt, grantedById FK→User NULL, revokedAt)`. Provisioning only via seed/CLI (no UI in R1.0). `/platform/auth/login` authenticates the User's credentials **and** requires an ACTIVE PlatformAdmin, then issues a PLATFORM session (ADR-001). A PlatformAdmin record never creates or implies a WorkspaceMember; tenant content routes are unreachable with a PLATFORM session, and platform routes expose metadata only (FR-ADM-003). AuditLog rows by platform admins have `actorType=PLATFORM_ADMIN`, `actorId=userId`.
**Rationale.** Satisfies "no global user.role" while giving the admin a verifiable identity and audit actor. A platform admin who is also an ordinary tenant member uses a separate APP session for that tenant work.

## ADR-008 — Member status changes and ordering **(directed)**
**Decision.** A Member may change `status` of an issue where they are the assignee **or** reporter, through either `PATCH /issues/:iid` or `PATCH /issues/:iid/status` — one shared policy function. For Members the server ignores any client-supplied position and appends the issue at the end of the target status column. `PATCH /issues/:iid/rank` (pure reordering, backlog or board) is PM/Admin/Owner only. Member field allow-list after creation: `title, description, dueAt, status`; any other field in the payload → 403 FIELD_FORBIDDEN for the whole request. On creation a Member may set type, title, description, dueAt, parentId, labels, and assignee = self or none; priority defaults to MEDIUM, storyPoints and sprint are empty (INC-24).

## ADR-009 — Data-model completion **(directed)**
**Decision.** Project: `status PLANNED|ACTIVE|ON_HOLD|COMPLETED` (default ACTIVE), `startDate`, `targetDate` (date, nullable, start ≤ target), `archivedAt/archivedById` independent of status, `createdAt/updatedAt`. Issue: `priority LOWEST|LOW|MEDIUM|HIGH|HIGHEST` (default MEDIUM), `storyPoints` integer 0–100 nullable, `createdAt/updatedAt`. Sprint and Label gain `createdAt` (Sprint also `updatedAt`); WorkspaceInvitation gains `createdAt`. A COMPLETED project status does not make it read-only — only archival does.

## ADR-010 — Issue watchers **(directed)**
**Decision.** `IssueWatcher(id, issueId FK, userId FK, createdAt, UNIQUE(issueId,userId))`. Routes: `GET /issues/:iid/watchers`, `POST /issues/:iid/watch`, `DELETE /issues/:iid/watch` (self only). Any user who can view the issue may watch; reporter and assignee are added automatically (idempotent). Watcher events: status change, assignee change, new comment → `WATCHED_ISSUE_UPDATED`, deduplicated, never to the actor. Watch rows are deleted when the user loses project access (ADR-012) and ignored at delivery if access is lost by any other path.

## ADR-011 — Composite tenant keys; derived Owner **(directed: integrity)**
**Decision.** Target uniques `Project(id, workspaceId)`, `Issue(id, projectId)`, `Issue(id, workspaceId)`, `Sprint(id, projectId)`, `Label(id, projectId)`. Composite FKs: `Issue(projectId, workspaceId)→Project`, `Issue(parentId, projectId)→Issue`, `Issue(sprintId, projectId)→Sprint`, `IssueLabel(issueId, projectId)→Issue` and `(labelId, projectId)→Label` (IssueLabel gains `projectId`), `SprintIssueHistory(sprintId, projectId)→Sprint` and `(issueId, projectId)→Issue` (gains `projectId`), `Notification(projectId, workspaceId)→Project`, `(issueId, workspaceId)→Issue` (MATCH SIMPLE, so NULLs skip the check). `Workspace.ownerUserId` is **removed**: the Owner is the single ACTIVE `WorkspaceMember` with role OWNER, guaranteed by partial unique index plus transactional transfer, and checked by an invariant test. `Project.key` is immutable, so the stored `Issue.key` cannot drift. Arch §5 cardinalities rewritten (INC-04).
**Rationale.** Removes the second source of truth for ownership; makes cross-project/cross-workspace links impossible at the database level, with service checks returning friendly 422s first.

## ADR-012 — Membership removal, ownership transfer, assignee eligibility **(directed: removal)**
**Decision.** Removing a workspace member (or self-deactivation) in one transaction: WorkspaceMember → REMOVED (`removedAt`); all their ProjectMember rows in that workspace → REMOVED; their open issues (not DONE, not deleted) are unassigned with IssueActivity; their IssueWatcher rows deleted; AuditLog written. Comments, attachments, activity, reporter references, notifications history and audit rows are kept; UI shows the user as "former member". Re-invitation reactivates the existing WorkspaceMember row; project memberships are **not** restored automatically. Removing only a ProjectMember applies the same unassign/unwatch within that project. Ownership transfer: target must be ACTIVE and verified; target → OWNER, former Owner → ADMIN (INC-11). **Assignee eligibility (INC-21):** the assignee must have current project access — ACTIVE ProjectMember, or ACTIVE workspace Owner/Admin; else 422 ASSIGNEE_NOT_ELIGIBLE.
**Rationale.** Revokes access immediately without destroying history; avoids orphaned assignments on inaccessible users.

## ADR-013 — Invitation lifecycle; account-neutral registration **(directed: lifecycle)**
**Decision.** Roles ADMIN or MEMBER only (Admins may invite Admins). Token 256-bit, hashed, unique, 7-day expiry. States PENDING → ACCEPTED | EXPIRED | REVOKED (all terminal). One PENDING per workspace + normalized email (partial unique). **Resend** = revoke current + create new invitation in one TX (rate-limited). **Revoke** by Owner/Admin. Expiry applied lazily on access and by the hourly sweep (ADR-018). **Accept:** caller must be signed in with a verified email equal to the invitation email → else 403 INVITATION_EMAIL_MISMATCH; inactive invitation → 410; existing ACTIVE membership → 409; REMOVED membership is reactivated. New invitees register with the prefilled email, verify, and return to the token. No invitations to, or acceptance in, a suspended workspace. Columns added: `createdAt, acceptedAt, acceptedById, revokedAt, revokedById`. **Registration (INC-20):** duplicate email returns the same 202 and sends an "account already exists / reset password" email.

## ADR-014 — Archive vs soft delete; comment moderation **(directed: moderation)**
**Decision.** *Archive* applies to projects only: visible, read-only, reversible (`POST /projects/:pid/unarchive`, Owner/Admin). *Soft delete* applies to issues and comments: hidden, retained. Issue `archivedAt` renamed `deletedAt` + `deletedById`; `DELETE /issues/:iid` soft-deletes (PM+), removes the issue from any PLANNED/ACTIVE sprint (history `removedAt`), and `POST /issues/:iid/restore` returns it to the backlog. Deleted issues return 404 to Members and appear in a "Deleted" filter for PM+. Comments: author edits within 15 min (`PATCH /comments/:cid`), author soft-deletes any time (`DELETE /comments/:cid`); Owner, Admin and the project's PM may moderate any comment (`POST /comments/:cid/moderate`, reason 1–500 chars) → `deletedAt`, `deletedById`, `moderationReason`, AuditLog. Deleted comment bodies are never returned (placeholder "Comment removed"). **No workspace archive state in R1.0 (INC-13)**; Arch §7 tests target suspended workspaces instead.

## ADR-015 — HTTP status-code contract
| Code | Meaning (error.code examples) |
|---|---|
| 401 | No valid session of the required kind |
| 403 | Authenticated and resource visible, action denied: FORBIDDEN, FIELD_FORBIDDEN, CSRF_FAILED, WORKSPACE_SUSPENDED, INVITATION_EMAIL_MISMATCH, TENANT_CONTENT_DENIED |
| 404 | Absent or not visible: cross-tenant, non-project member, soft-deleted issue for non-PM |
| 409 | VERSION_CONFLICT, uniqueness, state: PROJECT_ARCHIVED, INVALID_SPRINT_STATE, ACTIVE_SPRINT_EXISTS, ISSUE_IN_OTHER_SPRINT, OWNER_PROTECTED, ALREADY_MEMBER, INVITE_EXISTS |
| 410 | TOKEN_EXPIRED, INVITATION_INACTIVE (expired, revoked, used) |
| 422 | VALIDATION_ERROR, INVALID_HIERARCHY, ASSIGNEE_NOT_ELIGIBLE, NOT_WORKSPACE_MEMBER, DESTINATION_REQUIRED, FILE_REJECTED |
| 429 | RATE_LIMITED + Retry-After |

## ADR-016 — Kanban transitions and ranking
**Decision.** Any-to-any status transitions (no workflow editor in scope). Status is independent of sprint membership; adding to a sprint does not change status; the Backlog screen lists issues with `sprintId IS NULL` and status ≠ DONE. Reopen (DONE → any) is allowed. Subtask status is independent of its parent. Rank: `text` fractional key (LexoRank-style base-36, collation "C"), one rank per issue used for both backlog and board order within a status; insert between neighbours under row locks; if a key exceeds 64 characters the column is rebalanced in the same transaction (INC-17).

## ADR-017 — Sprint lifecycle edge cases **(directed)**
**Decision.** `SprintStatus = PLANNED | ACTIVE | COMPLETED | CANCELLED`. An issue may be in at most one PLANNED/ACTIVE sprint (`Issue.sprintId` + partial unique open history row); adding one from another open sprint → 409 ISSUE_IN_OTHER_SPRINT (remove it first). Edits: PLANNED — name, goal, startAt, endAt; ACTIVE — name, goal, endAt; COMPLETED/CANCELLED immutable. `POST /sprints/:sid/cancel` only from PLANNED: issues return to backlog (`removedAt`), status CANCELLED, `cancelledAt`. ACTIVE cannot be cancelled; COMPLETED cannot be reopened. Issues may be added/removed during ACTIVE (scope change per ADR-003). Completion requires an explicit destination for unfinished issues (backlog or one PLANNED sprint of the same project); carried issues get `removedAt` in the old sprint and a new history row (`addedAt` = completion time) in the target. Starting an empty sprint is allowed; start is permitted before `startAt` (actual time in `startedAt`).

## ADR-018 — Reporting timezone and scheduled jobs **(directed: timezone)**
**Decision.** `Workspace.timezone` (IANA, default = creator's timezone, else UTC; editable by Owner/Admin). All report day boundaries (burndown days, overdue "today", velocity/workload date ranges) use it; responses include `{timezone, from, to}`. Changing the timezone affects future computations; stored metrics are recomputed for ACTIVE sprints only. `apps/worker` hosts a scheduler (single leader via Postgres advisory lock): hourly — compute `SprintDailyMetric` for each ACTIVE sprint for every completed local day (idempotent upsert on `(sprintId, metricDate)`), and expire PENDING invitations past `expiresAt`; at sprint completion a final metric is written synchronously.

## ADR-019 — Foreign keys, deletion behaviour, indexes; API completion **(directed)**
**Decision.** Every `*Id` column is a declared FK (Arch v3 §4 marks all 46). `onDelete: Restrict`, `onUpdate: Restrict` everywhere except `IssueLabel.labelId → Label` (`Cascade`, label deletion by PM+). No hard deletes of users, workspaces, projects, issues, comments, attachments, activity or audit rows; `AuditLog.targetId` stays polymorphic text. Unique and partial-unique indexes and secondary indexes as listed in Arch v3 §8 / ERD page 4. Missing endpoints added to Arch v3 §6: profile/preferences/password/deactivate, resend verification, member role/removal, ownership transfer, invitation resend/revoke/preview, project unarchive, project member update/remove, label CRUD, issue delete/restore/children/activity/labels, comment edit/delete/moderate, attachment download, watchers, rank, backlog, sprint get/patch/cancel/report, workload, unread/unread-count, platform auth/detail/audit.

## ADR-020 — Member-list visibility; matrix clean-up; deliverable mapping
**Decision.** All ACTIVE workspace members see the member list with names, avatars and roles (needed for mentions and assignment); emails and pending invitations only for Owner/Admin. Project member roster: project members and Owner/Admin. SRS matrix row "billing/ownership" → "Transfer workspace ownership" (billing is out of scope, INC-22). Deliverables (INC-27): Plan #04→`01_system_workflow.drawio`, #05→`02_user_flows.drawio`, #06→`03_database_erd.drawio`, #07→`PERMISSION_MATRIX_v3.csv` + `04_role_permissions.drawio`; new #12–#15 for navigation, ADR log, register and traceability report.
