# Traceability Report — Baseline 3.0

**Chain:** Requirement → Database entity → API endpoint → User flow / workflow → Test case. Generated from SRS v3, Architecture v3 and the Baseline 3.0 diagrams, with automated verification (below). Test case IDs (`TC-<FR>-n`) are the names CI must use (Plan v3 §4).

**Flow codes:** `UF pN-X` = 02_user_flows page N, pool X · `WF pN[-X]` = 01_system_workflow page N, section X · `NAV pN` = 05_navigation_sitemap page N. **Test types:** U unit · I integration · Sec security · E2E end-to-end · A11y accessibility · Ops operational.

## Verification results

| Check | Result |
|---|---|
| Every SRS v3 FR has a trace row | 57 / 57 |
| Every SRS v3 acceptance scenario mapped to FRs and tests | 20 / 20 |
| Every cited entity exists in the ERD / Arch v3 §4 (22 entities) | pass |
| Every cited endpoint exists in Arch v3 §6 route inventory | 97 references, 0 missing |
| Every cited flow page exists in the .drawio files | pass |
| Every FR has ≥ 1 test case | pass |

## 1. Functional requirements

| Requirement | Entities | API endpoints | User flow / workflow | Test cases |
|---|---|---|---|---|
| **FR-AUTH-001** | User, VerificationToken | `POST /auth/register; POST /auth/verify-email` | UF p0-A; WF p2 | TC-AUTH-001-1, TC-AUTH-001-2, TC-AUTH-001-3 |
| **FR-AUTH-002** | Session | `POST /auth/login; POST /auth/logout; GET /auth/me` | UF p0-B; WF p2 | TC-AUTH-002-1, TC-AUTH-002-2, TC-AUTH-002-3 |
| **FR-AUTH-003** | VerificationToken, Session | `POST /auth/forgot-password; POST /auth/reset-password` | UF p0-C | TC-AUTH-003-1, TC-AUTH-003-2, TC-AUTH-003-3 |
| **FR-AUTH-004** | User, WorkspaceMember | `GET /users/me; PATCH /users/me/preferences; POST /users/me/password; POST /users/me/deactivate` | UF p2-C | TC-AUTH-004-1, TC-AUTH-004-2, TC-AUTH-004-3 |
| **FR-AUTH-005** | Session | `POST /auth/login; POST /workspaces/:wid/invitations` | UF p0-B; WF p2 | TC-AUTH-005-1, TC-AUTH-005-2 |
| **FR-AUTH-006** | VerificationToken | `POST /auth/resend-verification` | UF p0-A | TC-AUTH-006-1 |
| **FR-TEN-001** | Workspace, WorkspaceMember, AuditLog | `POST /workspaces` | UF p2-A; WF p3-A | TC-TEN-001-1, TC-TEN-001-2 |
| **FR-TEN-002** | WorkspaceInvitation, OutboxEvent, AuditLog | `POST /workspaces/:wid/invitations; /invitations/:invId/resend; /invitations/:invId/revoke` | UF p2-A; WF p3-B/C | TC-TEN-002-1, TC-TEN-002-2, TC-TEN-002-3, TC-TEN-002-4 |
| **FR-TEN-003** | WorkspaceInvitation, WorkspaceMember | `GET /invitations/preview; POST /invitations/accept` | UF p0-B; WF p3-B | TC-TEN-003-1, TC-TEN-003-2, TC-TEN-003-3 |
| **FR-TEN-004** | WorkspaceMember, ProjectMember, Issue, IssueWatcher, AuditLog | `GET /workspaces/:wid/members; PATCH/DELETE /workspaces/:wid/members/:mid` | UF p3-B; WF p3-D | TC-TEN-004-1, TC-TEN-004-2, TC-TEN-004-3 |
| **FR-TEN-005** | WorkspaceMember | `GET /workspaces; GET /workspaces/:wid` | UF p0-B; UF p5-C; WF p2 | TC-TEN-005-1, TC-TEN-005-2 |
| **FR-TEN-006** | WorkspaceMember, AuditLog | `POST /workspaces/:wid/transfer-ownership` | UF p2-B; WF p3-D | TC-TEN-006-1, TC-TEN-006-2 |
| **FR-TEN-007** | Workspace | `PATCH /workspaces/:wid` | UF p2-C | TC-TEN-007-1 |
| **FR-TEN-008** | WorkspaceMember, WorkspaceInvitation | `GET /workspaces/:wid/members; GET/POST /workspaces/:wid/invitations` | NAV p2 | TC-TEN-008-1 |
| **FR-PRJ-001** | Project, AuditLog | `POST /workspaces/:wid/projects` | UF p3-A; WF p4-A | TC-PRJ-001-1, TC-PRJ-001-2 |
| **FR-PRJ-002** | Project, ProjectMember | `GET/POST /workspaces/:wid/projects; GET/PATCH /projects/:pid` | UF p5-C | TC-PRJ-002-1 |
| **FR-PRJ-003** | ProjectMember, WorkspaceMember, Issue, IssueWatcher | `GET/POST /projects/:pid/members; PATCH/DELETE /projects/:pid/members/:pmid` | UF p3-A; UF p4-C; WF p4-A | TC-PRJ-003-1, TC-PRJ-003-2 |
| **FR-PRJ-004** | Project, AuditLog | `POST /projects/:pid/archive, /projects/:pid/unarchive` | UF p3-C; WF p4-A | TC-PRJ-004-1, TC-PRJ-004-2 |
| **FR-PRJ-005** | Issue, Sprint | `GET /projects/:pid/reports/overview` | UF p4-C | TC-PRJ-005-1 |
| **FR-ISS-001** | Issue, Project | `GET/POST /projects/:pid/issues` | UF p4-A; WF p4-B | TC-ISS-001-1, TC-ISS-001-2 |
| **FR-ISS-002** | Issue | `GET/PATCH /issues/:iid` | UF p4-A | TC-ISS-002-1 |
| **FR-ISS-003** | Issue, IssueLabel | `GET/POST /projects/:pid/issues` | UF p5-C | TC-ISS-003-1 |
| **FR-ISS-004** | Issue | `GET /issues/:iid/children; GET/PATCH /issues/:iid` | UF p4-A; WF p4-B | TC-ISS-004-1, TC-ISS-004-2 |
| **FR-ISS-005** | Label, IssueLabel, IssueComment, AuditLog | `GET/POST /projects/:pid/labels; PATCH/DELETE /labels/:lid; PUT /issues/:iid/labels; PATCH/DELETE /comments/:cid; POST /comments/:cid/moderate` | UF p5-B; WF p4-D | TC-ISS-005-1, TC-ISS-005-2, TC-ISS-005-3, TC-ISS-005-4 |
| **FR-ISS-006** | Attachment | `GET/POST /issues/:iid/attachments; GET /attachments/:aid/download` | UF p5-B; WF p4-D | TC-ISS-006-1, TC-ISS-006-2 |
| **FR-ISS-007** | Issue, IssueActivity, SprintIssueHistory, AuditLog | `DELETE /issues/:iid (soft); POST /issues/:iid/restore; GET /issues/:iid/activity` | WF p4-D | TC-ISS-007-1, TC-ISS-007-2 |
| **FR-ISS-008** | Issue | `GET/PATCH /issues/:iid` | UF p4-A; WF p2 | TC-ISS-008-1 |
| **FR-ISS-009** | Issue, ProjectMember, WorkspaceMember | `GET/PATCH /issues/:iid` | WF p4-B | TC-ISS-009-1, TC-ISS-009-2 |
| **FR-ISS-010** | IssueWatcher | `GET /issues/:iid/watchers; POST/DELETE /issues/:iid/watch` | UF p5-B | TC-ISS-010-1, TC-ISS-010-2 |
| **FR-BRD-001** | Issue | `PATCH /issues/:iid/status` | WF p5 | TC-BRD-001-1 |
| **FR-BRD-002** | Issue, IssueActivity | `PATCH /issues/:iid/status; GET/PATCH /issues/:iid` | UF p5-A; WF p5 | TC-BRD-002-1, TC-BRD-002-2 |
| **FR-BRD-003** | Issue | `PATCH /issues/:iid/rank (PM+); GET /projects/:pid/board, /projects/:pid/backlog` | UF p4-A; WF p5 | TC-BRD-003-1, TC-BRD-003-2 |
| **FR-BRD-004** | Issue | `GET /projects/:pid/board` | NAV p3 | TC-BRD-004-1 |
| **FR-SPR-001** | Sprint, SprintIssueHistory, Issue | `GET/POST /projects/:pid/sprints; PUT /sprints/:sid/issues` | UF p4-B; WF p6-A | TC-SPR-001-1, TC-SPR-001-2 |
| **FR-SPR-002** | Sprint | `POST /sprints/:sid/start` | UF p4-B; WF p6-B | TC-SPR-002-1 |
| **FR-SPR-003** | SprintIssueHistory | `POST /sprints/:sid/start, /sprints/:sid/complete` | WF p6-B/C | TC-SPR-003-1 |
| **FR-SPR-004** | Issue, SprintIssueHistory | `POST /sprints/:sid/start, /sprints/:sid/complete` | UF p4-C; WF p6-C | TC-SPR-004-1 |
| **FR-SPR-005** | Sprint, SprintIssueHistory | `GET /sprints/:sid/burndown, /sprints/:sid/report` | UF p4-C | TC-SPR-005-1 |
| **FR-SPR-006** | Sprint, SprintIssueHistory | `GET/PATCH /sprints/:sid; POST /sprints/:sid/cancel` | WF p6 | TC-SPR-006-1, TC-SPR-006-2 |
| **FR-RPT-001** | Issue, Project | `GET /workspaces/:wid/overview` | UF p2-C | TC-RPT-001-1 |
| **FR-RPT-002** | Issue | `GET /projects/:pid/reports/overview` | UF p4-C | TC-RPT-002-1 |
| **FR-RPT-003** | SprintDailyMetric, SprintIssueHistory | `GET /sprints/:sid/burndown` | WF p6-D | TC-RPT-003-1 |
| **FR-RPT-004** | SprintIssueHistory, Sprint | `/reports/velocity` | UF p4-C | TC-RPT-004-1 |
| **FR-RPT-005** | Issue | `/reports/workload` | UF p4-C | TC-RPT-005-1 |
| **FR-RPT-006** | Workspace, SprintDailyMetric | `GET /sprints/:sid/burndown, /sprints/:sid/report` | WF p6-D | TC-RPT-006-1 |
| **FR-NTF-001** | Notification, OutboxEvent, IssueWatcher | `GET /notifications` | WF p7 | TC-NTF-001-1 |
| **FR-NTF-002** | Notification | `GET /notifications, /notifications/unread-count; PATCH /notifications/:nid/read, /notifications/:nid/unread; POST /notifications/read-all` | UF p5-A; WF p7 | TC-NTF-002-1, TC-NTF-002-2 |
| **FR-NTF-003** | AuditLog | `GET /platform/audit` | WF p7 | TC-NTF-003-1 |
| **FR-NTF-004** | Notification, OutboxEvent | `GET /notifications` | WF p7 | TC-NTF-004-1 |
| **FR-ADM-001** | PlatformAdmin, Session | `POST /platform/auth/login, /platform/auth/logout; GET /platform/auth/me` | UF p1-A | TC-ADM-001-1, TC-ADM-001-2 |
| **FR-ADM-002** | Workspace, AuditLog | `POST /platform/workspaces/:wid/suspend, /platform/workspaces/:wid/reactivate` | UF p1-B; WF p3-E | TC-ADM-002-1 |
| **FR-ADM-003** | PlatformAdmin | `GET /platform/workspaces, /platform/workspaces/:wid` | UF p1-A | TC-ADM-003-1 |
| **FR-ADM-004** | Workspace, WorkspaceMember, OutboxEvent | `/platform/metrics` | UF p1-A | TC-ADM-004-1 |
| **FR-UX-001** | — | — | NAV p3 | TC-UX-001-1 |
| **FR-UX-002** | User | `PATCH /users/me/preferences` | NAV p3 | TC-UX-002-1 |
| **FR-UX-003** | — | — | WF p8; NAV p1 | TC-UX-003-1 |
| **FR-UX-004** | all | — | WF p1 | TC-UX-004-1 |

## 2. Acceptance scenarios

| AC | Scenario (SRS v3) | Covered by FRs | E2E / integration test cases |
|---|---|---|---|
| **AC-01** | User registers/verifies, creates Workspace A and invites two teammates. | FR-AUTH-001, FR-TEN-001, FR-TEN-002 | E2E-AC-01; TC-AUTH-001-1, TC-TEN-001-1, TC-TEN-002-1 |
| **AC-02** | User belongs to two workspaces; cross-workspace issue URL/API calls return 404/403 without data leakage. | FR-TEN-005 | E2E-AC-02; TC-TEN-005-1 |
| **AC-03** | Owner makes an Admin; Admin creates Project WEB and assigns PM and Member. | FR-TEN-004, FR-PRJ-001, FR-PRJ-003 | E2E-AC-03; TC-TEN-004-1, TC-PRJ-001-1, TC-PRJ-003-1 |
| **AC-04** | PM creates epic/story/bug/subtask (invalid hierarchy rejected 422); Member edits only allowed fields of own assigned/reported issues. | FR-ISS-004, FR-BRD-002 | E2E-AC-04; TC-ISS-004-1, TC-BRD-002-1 |
| **AC-05** | Concurrent issue creation yields distinct WEB-### identifiers. | FR-ISS-001 | E2E-AC-05; TC-ISS-001-1 |
| **AC-06** | PM board drag/drop persists order; Member status change on own issue succeeds via board and form, on others' issue → 403; Member rank-only change → 403. | FR-BRD-002, FR-BRD-003 | E2E-AC-06; TC-BRD-002-1, TC-BRD-003-1 |
| **AC-07** | PM starts sprint; second simultaneous start rejected; adding an issue from another open sprint rejected; finish snapshots story points and carry-over. | FR-SPR-001, FR-SPR-002, FR-SPR-004 | E2E-AC-07; TC-SPR-001-1, TC-SPR-002-1, TC-SPR-004-1 |
| **AC-08** | Dashboard and sprint burndown reconcile with underlying issue histories. | FR-RPT-003 | E2E-AC-08; TC-RPT-003-1 |
| **AC-09** | Member comments/uploads attachment; non-project member cannot download it. | FR-ISS-006 | E2E-AC-09; TC-ISS-006-1 |
| **AC-10** | Assignment/mention notification delivered once and hidden after access revoked. | FR-NTF-002 | E2E-AC-10; TC-NTF-002-1 |
| **AC-11** | Owner transfer and workspace suspension enforce their business invariants. | FR-TEN-006, FR-ADM-002 | E2E-AC-11; TC-TEN-006-1, TC-ADM-002-1 |
| **AC-12** | Fresh clone + documented env starts Docker stack, migrates/seeds, passes CI checks. | FR-UX-004 | E2E-AC-12; TC-UX-004-1 |
| **AC-13** | Removing a workspace member revokes project access, unassigns open issues and removes watches; their comments and activity remain visible to others. | FR-TEN-004 | E2E-AC-13; TC-TEN-004-1 |
| **AC-14** | Invitation resend invalidates the old token; revoked/expired token → 410; accepting with a different verified email → 403 and no membership. | FR-TEN-002, FR-TEN-003 | E2E-AC-14; TC-TEN-002-1, TC-TEN-003-1 |
| **AC-15** | Platform Super Admin signs in via /platform and suspends a workspace with reason; cannot read any issue, comment or attachment; holds no workspace membership. | FR-ADM-001, FR-ADM-003 | E2E-AC-15; TC-ADM-001-1, TC-ADM-003-1 |
| **AC-16** | Linking a sprint, parent or label from another project, or a notification across workspaces, is rejected (422 at API, FK violation at DB). | FR-ISS-004, FR-SPR-001 | E2E-AC-16; TC-ISS-004-1, TC-SPR-001-1 |
| **AC-17** | A watcher gets one notification per watched-issue update, none for own changes and none after access is revoked. | FR-ISS-010, FR-NTF-004 | E2E-AC-17; TC-ISS-010-1, TC-NTF-004-1 |
| **AC-18** | Cancelling a PLANNED sprint returns its issues to backlog; mid-sprint scope added/removed appears in burndown; velocity uses completedPoints. | FR-SPR-006, FR-RPT-004 | E2E-AC-18; TC-SPR-006-1, TC-RPT-004-1 |
| **AC-19** | Reports computed with workspace-timezone day boundaries reconcile with fixtures in two different timezones. | FR-RPT-006 | E2E-AC-19; TC-RPT-006-1 |
| **AC-20** | Ownership transfer makes the target Owner and the former Owner Admin; an Admin attempt to transfer or demote the Owner → 403. | FR-TEN-006 | E2E-AC-20; TC-TEN-006-1 |

## 3. Non-functional requirements

| NFR | Verified by |
|---|---|
| NFR-01 | TC-TEN-005-*, TC-ISS-006-2, TC-NTF-002-2, TC-RPT-001-1 (cross-tenant suite) |
| NFR-02 | TC-AUTH-001-1, TC-AUTH-005-2 (Argon2id, log redaction) |
| NFR-03 | TC-AUTH-002-1/2/3 |
| NFR-04 | TC-ISS-002-1, TC-ISS-003-1 (Zod, bounds, sanitisation) |
| NFR-05 | Perf run on seed data at G5 (measured, documented) |
| NFR-06 | TC-BRD-004-1, TC-UX-002-1 |
| NFR-07 | Ops: fresh migrate + seed + restore drill |
| NFR-08 | CI pipeline gate |
| NFR-09 | Log assertions: requestId present, secrets redacted |
| NFR-10 | TC-UX-004-1; upload/email restrictions in demo config |

## 4. Test case catalogue

| Test case | Requirement | Description | Type |
|---|---|---|---|
| TC-AUTH-001-1 | FR-AUTH-001 | Register normalises email, hashes password, sends verify email | I |
| TC-AUTH-001-2 | FR-AUTH-001 | Duplicate email gets identical 202 + 'account exists' email | I/Sec |
| TC-AUTH-001-3 | FR-AUTH-001 | Unverified user blocked from workspace actions (403) | I |
| TC-AUTH-002-1 | FR-AUTH-002 | Login sets HttpOnly/Secure/SameSite cookie and rotates id | I/Sec |
| TC-AUTH-002-2 | FR-AUTH-002 | CSRF header + Origin required on mutations | Sec |
| TC-AUTH-002-3 | FR-AUTH-002 | APP session rejected on /platform, PLATFORM on tenant routes (401) | Sec |
| TC-AUTH-003-1 | FR-AUTH-003 | Account-neutral forgot response | Sec |
| TC-AUTH-003-2 | FR-AUTH-003 | Token single-use, 1 h expiry → 410 | I |
| TC-AUTH-003-3 | FR-AUTH-003 | Reset revokes all sessions | I |
| TC-AUTH-004-1 | FR-AUTH-004 | Profile/theme/timezone update | I |
| TC-AUTH-004-2 | FR-AUTH-004 | Deactivate blocked while Owner (409) | I |
| TC-AUTH-004-3 | FR-AUTH-004 | Deactivate revokes sessions and runs removal cascade | I |
| TC-AUTH-005-1 | FR-AUTH-005 | Auth and invite endpoints return 429 + Retry-After | I |
| TC-AUTH-005-2 | FR-AUTH-005 | Failed attempts logged without secrets | Sec |
| TC-AUTH-006-1 | FR-AUTH-006 | Resend invalidates previous token; account-neutral; rate limited | I |
| TC-TEN-001-1 | FR-TEN-001 | Create → sole ACTIVE OWNER in same TX | I |
| TC-TEN-001-2 | FR-TEN-001 | Duplicate slug → 409 | I |
| TC-TEN-002-1 | FR-TEN-002 | Invite role OWNER rejected (422) | I |
| TC-TEN-002-2 | FR-TEN-002 | Second PENDING for same email → 409 | I |
| TC-TEN-002-3 | FR-TEN-002 | Resend revokes old token, issues new | I |
| TC-TEN-002-4 | FR-TEN-002 | Invite in suspended workspace → 403 | I |
| TC-TEN-003-1 | FR-TEN-003 | Accept with matching verified email creates/reactivates member | I |
| TC-TEN-003-2 | FR-TEN-003 | Email mismatch → 403, no membership | I/Sec |
| TC-TEN-003-3 | FR-TEN-003 | Expired/revoked/used → 410; already ACTIVE → 409 | I |
| TC-TEN-004-1 | FR-TEN-004 | Removal cascade: project access revoked, open issues unassigned, watches deleted | I |
| TC-TEN-004-2 | FR-TEN-004 | History (comments, activity) retained after removal | I |
| TC-TEN-004-3 | FR-TEN-004 | Admin cannot change/remove Owner (403) | I |
| TC-TEN-005-1 | FR-TEN-005 | Switch re-authorises; cross-workspace ID → 404 | I/Sec |
| TC-TEN-005-2 | FR-TEN-005 | Client workspaceId in body ignored | Sec |
| TC-TEN-006-1 | FR-TEN-006 | Transfer: target OWNER, former ADMIN, one ACTIVE OWNER | I |
| TC-TEN-006-2 | FR-TEN-006 | Concurrent transfers → exactly one succeeds | I |
| TC-TEN-007-1 | FR-TEN-007 | Timezone change by Owner/Admin only; IANA validated | I |
| TC-TEN-008-1 | FR-TEN-008 | Member sees names/roles, no emails; invitations hidden from non-admins | I/Sec |
| TC-PRJ-001-1 | FR-PRJ-001 | Key format/uniqueness; status default ACTIVE; start ≤ target | I |
| TC-PRJ-001-2 | FR-PRJ-001 | PATCH cannot change key (422) | I |
| TC-PRJ-002-1 | FR-PRJ-002 | List returns only accessible projects | I/Sec |
| TC-PRJ-003-1 | FR-PRJ-003 | Non-workspace user → 422 | I |
| TC-PRJ-003-2 | FR-PRJ-003 | Project-member removal unassigns + unwatches | I |
| TC-PRJ-004-1 | FR-PRJ-004 | Archived project mutations → 409 PROJECT_ARCHIVED | I |
| TC-PRJ-004-2 | FR-PRJ-004 | Unarchive by Owner/Admin restores writes; audited | I |
| TC-PRJ-005-1 | FR-PRJ-005 | Overview counts/progress/overdue match fixtures | U |
| TC-ISS-001-1 | FR-ISS-001 | All five types creatable; key immutable | I |
| TC-ISS-001-2 | FR-ISS-001 | projectId in PATCH rejected for every role | I |
| TC-ISS-002-1 | FR-ISS-002 | Markdown sanitised; priority default MEDIUM; points 0–100 | U/I |
| TC-ISS-003-1 | FR-ISS-003 | Filters/search/pagination bounded (max 100) | I |
| TC-ISS-004-1 | FR-ISS-004 | Hierarchy matrix incl. BUG/SUBTASK no children | U |
| TC-ISS-004-2 | FR-ISS-004 | Cross-project parent rejected (422 + DB FK) | I |
| TC-ISS-005-1 | FR-ISS-005 | Label CRUD PM+; delete cascades IssueLabel | I |
| TC-ISS-005-2 | FR-ISS-005 | Comment edit > 15 min → 403; author delete | I |
| TC-ISS-005-3 | FR-ISS-005 | Moderation requires reason, audited, body never returned | I/Sec |
| TC-ISS-005-4 | FR-ISS-005 | Mention of non-viewer: no notification | I |
| TC-ISS-006-1 | FR-ISS-006 | MIME sniff + 10 MB limit → 422 | I/Sec |
| TC-ISS-006-2 | FR-ISS-006 | Non-project member download → 404; URL expires 5 min | Sec |
| TC-ISS-007-1 | FR-ISS-007 | Soft delete hides issue (404 for Member), removes from open sprint | I |
| TC-ISS-007-2 | FR-ISS-007 | Restore by PM+ only | I |
| TC-ISS-008-1 | FR-ISS-008 | Stale version → 409 VERSION_CONFLICT | I |
| TC-ISS-009-1 | FR-ISS-009 | Assignee without project access → 422 | I |
| TC-ISS-009-2 | FR-ISS-009 | Member create: assignee self/none only | I |
| TC-ISS-010-1 | FR-ISS-010 | Auto-watch reporter/assignee; watch requires view access | I |
| TC-ISS-010-2 | FR-ISS-010 | Watch rows removed on access revocation | I |
| TC-BRD-001-1 | FR-BRD-001 | Any-to-any transitions accepted; sprint unaffected | U/I |
| TC-BRD-002-1 | FR-BRD-002 | Member status on own assigned/reported via board and form | I |
| TC-BRD-002-2 | FR-BRD-002 | Member on others' issue → 403 | I |
| TC-BRD-003-1 | FR-BRD-003 | Concurrent rank inserts stay ordered; rebalance in TX | I |
| TC-BRD-003-2 | FR-BRD-003 | Member rank-only change → 403; Member move appends | I |
| TC-BRD-004-1 | FR-BRD-004 | Keyboard 'Move to…' fallback works without drag | E2E/A11y |
| TC-SPR-001-1 | FR-SPR-001 | startAt < endAt; PM+ only | I |
| TC-SPR-001-2 | FR-SPR-001 | Issue in another open sprint → 409 | I |
| TC-SPR-002-1 | FR-SPR-002 | Two concurrent starts → one 409 ACTIVE_SPRINT_EXISTS | I |
| TC-SPR-003-1 | FR-SPR-003 | committedPoints frozen at start; completedPoints at completion | I |
| TC-SPR-004-1 | FR-SPR-004 | Destination required → 422; carry-over history rows correct | I |
| TC-SPR-005-1 | FR-SPR-005 | Completed sprint report immutable | I |
| TC-SPR-006-1 | FR-SPR-006 | Edit rules per state; cancel PLANNED only; no reopen | I |
| TC-SPR-006-2 | FR-SPR-006 | Mid-sprint add/remove recorded as scope change | I |
| TC-RPT-001-1 | FR-RPT-001 | Overview aggregates only authorised projects | I/Sec |
| TC-RPT-002-1 | FR-RPT-002 | Overdue excludes DONE, deleted, archived projects | U |
| TC-RPT-003-1 | FR-RPT-003 | Burndown reconciles with history fixtures incl. scope added | U |
| TC-RPT-004-1 | FR-RPT-004 | Velocity = Σ completedPoints last 6; cancelled excluded | U |
| TC-RPT-005-1 | FR-RPT-005 | Workload counts open issues in non-archived projects | U |
| TC-RPT-006-1 | FR-RPT-006 | Day boundaries in two timezones match fixtures; response states tz | U |
| TC-NTF-001-1 | FR-NTF-001 | Assignment/mention/invite-accepted/watched events delivered once | I |
| TC-NTF-002-1 | FR-NTF-002 | Read/unread/read-all and badge count | I |
| TC-NTF-002-2 | FR-NTF-002 | Hidden after access revoked | I/Sec |
| TC-NTF-003-1 | FR-NTF-003 | Every listed sensitive action writes one AuditLog row in TX | I |
| TC-NTF-004-1 | FR-NTF-004 | Dedupe on retry; no self-notification | I |
| TC-ADM-001-1 | FR-ADM-001 | Login requires ACTIVE PlatformAdmin; PLATFORM session issued | I/Sec |
| TC-ADM-001-2 | FR-ADM-001 | PlatformAdmin implies no workspace membership | Sec |
| TC-ADM-002-1 | FR-ADM-002 | Suspend requires reason; tenant calls → 403 WORKSPACE_SUSPENDED | I |
| TC-ADM-003-1 | FR-ADM-003 | No platform endpoint returns issue/comment/attachment content | Sec |
| TC-ADM-004-1 | FR-ADM-004 | Metrics: counts and job health incl. DEAD outbox events | I |
| TC-UX-001-1 | FR-UX-001 | Layouts at 390/768/desktop without clipping | E2E |
| TC-UX-002-1 | FR-UX-002 | Theme switching; keyboard and focus checks | A11y |
| TC-UX-003-1 | FR-UX-003 | Loading/empty/error/403/404/410/archived/suspended states render | E2E |
| TC-UX-004-1 | FR-UX-004 | Seed creates fictional multi-workspace demo idempotently | Ops |

**Totals:** 57 functional requirements · 20 acceptance scenarios · 94 test cases · 22 entities · all endpoints from Arch v3 §6.

## 5. Remaining unresolved issues

None architectural or authorization-related. Non-blocking implementation choices (email provider, object-store vendor, demo host, final MIME list, measured NFR-05 values, documented WCAG gaps) are listed in INCONSISTENCY_REGISTER_v3.md and scheduled at G1/G3/G5.
