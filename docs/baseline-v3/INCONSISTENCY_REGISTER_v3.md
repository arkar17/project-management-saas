# Inconsistency Register — Baseline 3.0 (Resolved)

Supersedes *Architecture Inconsistencies & Unresolved Decisions* (Baseline 2.0). All 27 original IDs are kept. **Status: 27 / 27 RESOLVED.** "Directed" = decision given by the product owner; otherwise chosen as the safest, simplest Release 1.0 option (rationale in the ADR).

Artifact codes: **SRS** = SRS v3 · **ARCH** = Architecture v3 · **PLAN** = Plan v3 · **WF/UF/ERD/RP/NAV** = diagrams 01–05 (`pN` = page) · **CSV** = PERMISSION_MATRIX_v3.csv.

| ID | Sev. | Original issue | Decision (summary) | ADR | Updated artifacts | Status |
|---|---|---|---|---|---|---|
| INC-01 | Critical | `SUBTASK` missing from issue types | Fifth type SUBTASK; EPIC→STORY/TASK/BUG, STORY/TASK→SUBTASK; BUG/SUBTASK no children; depth ≤ 2 *(directed)* | 006 | SRS FR-ISS-001/004, AC-04 · ARCH §4 Issue · ERD p4/p5 · WF p4 · RP p4 | Resolved |
| INC-02 | Major | Watched-issue notifications without watcher model | `IssueWatcher` entity, watch/unwatch/list routes, auto-watch reporter + assignee *(directed)* | 010 | SRS FR-ISS-010, FR-NTF-001, AC-17 · ARCH §4, §6 · ERD p1–p5 · WF p7 · UF p5 · NAV p1/p2 | Resolved |
| INC-03 | Critical | Platform Super Admin identity not modelled | `PlatformAdmin` linked to User; PLATFORM session kind; no workspace access *(directed)* | 007, 001 | SRS §3, FR-ADM-001, FR-AUTH-002, AC-15 · ARCH §1, §4, §6, §7 · ERD · WF p1/p2 · UF p1 · RP p1/p6 · NAV p1 | Resolved |
| INC-04 | Major | Arch §5 cardinality wrong/incomplete | §5 rewritten: owner via membership; all actor FKs; Issue 1:N history/watchers; User 1:0..1 PlatformAdmin | 011 | ARCH §5 · ERD p1/p5 | Resolved |
| INC-05 | Major | Redundant `ownerUserId` and `Issue.key` | `ownerUserId` removed (owner = ACTIVE OWNER member, partial unique); `Project.key` immutable so `Issue.key` cannot drift | 011 | SRS §3, §6, FR-PRJ-001 · ARCH §4 Workspace/Project · ERD · WF p3 | Resolved |
| INC-06 | Critical | Member board move vs status edit conflict | One rule: Member changes status of own assigned **or** reported issue via form or board; Member moves append to column end; ranking PM/Admin/Owner only *(directed)* | 008 | SRS §4, FR-BRD-002/003, AC-06 · ARCH §6 Board · WF p5 · UF p5 · RP p3/p4 · CSV | Resolved |
| INC-07 | Major | Comment moderation role; soft-delete naming | Owner/Admin/PM moderate with reason (audited); author delete any time; Issue `archivedAt`→`deletedAt`+`deletedById`; archive = projects only *(directed: moderation)* | 014 | SRS §4, FR-ISS-005/007, FR-NTF-003 · ARCH §4, §6 · ERD · WF p4 · RP p3 | Resolved |
| INC-08 | Major | REST route inventory gaps | 40+ endpoints added (list in ADR-019) *(directed)* | 019 | ARCH §6 · WF p3/p4/p7 · traceability report §2 | Resolved |
| INC-09 | Major | Same-project integrity not enforceable | Composite FKs for parent, sprint, labels, history, notifications, issue tenant key *(directed)* | 011 | SRS §6, AC-16 · ARCH §4, §7, §8 · ERD p2/p3/p4 · RP p5 | Resolved |
| INC-10 | Major | Effect of workspace-member removal | One TX: memberships REMOVED, open issues unassigned, watches deleted, history kept; re-invite reactivates workspace row only *(directed)* | 012 | SRS FR-TEN-004, FR-PRJ-003, AC-13 · ARCH §4 · ERD · WF p3 · UF p3 | Resolved |
| INC-11 | Minor | Former owner's role after transfer | Former Owner becomes ADMIN | 012 | SRS §3, FR-TEN-006, AC-20 · WF p3 · UF p2 | Resolved |
| INC-12 | Major | Invitation rules incomplete | ADMIN/MEMBER only; unique hashed token, 7 days; resend = revoke + reissue; revoke; email must match (403); 410 inactive; reactivation; audit columns *(directed)* | 013 | SRS FR-TEN-002/003, AC-14 · ARCH §4, §6 · ERD · WF p3 · UF p2 · NAV p1 | Resolved |
| INC-13 | Minor | "Archived workspace" tested but undefined | No workspace archive in R1.0; tests target suspended workspaces | 014 | ARCH §7 · ERD p4 enum · WF p3 | Resolved |
| INC-14 | Critical | Missing project fields / enum values / timestamps | Project status + dates; archival separate; priorities; createdAt/updatedAt; integer points 0–100; unarchive *(directed)* | 009 | SRS FR-PRJ-001/004, FR-ISS-002 · ARCH §4 · ERD · WF p4 | Resolved |
| INC-15 | Major | HTTP status codes undefined | Contract 401/403/404/409/410/422/429; non-project member and deleted issue → 404; archived → 409 | 015 | ARCH §6 · WF p2/p8 · RP p2/p5 · PLAN §4 | Resolved |
| INC-16 | Major | Kanban transitions & BACKLOG semantics | Any-to-any; status independent of sprint; reopen allowed | 016 | SRS FR-BRD-001 · WF p5 | Resolved |
| INC-17 | Minor | Rank storage type | Text fractional (LexoRank-style), collation C, rebalance > 64 chars | 016 | SRS FR-BRD-003 · ERD p2 · WF p5 | Resolved |
| INC-18 | Major | Sprint edge cases | One open sprint per issue (409); edit rules; cancel PLANNED → CANCELLED; no cancel ACTIVE / reopen COMPLETED; mid-sprint scope change; explicit carry-over *(directed)* | 017, 003 | SRS FR-SPR-001…006, AC-07, AC-18 · ARCH §4, §6 · ERD · WF p6 · UF p4 | Resolved |
| INC-19 | Major | Daily-metric runner & report timezone | `Workspace.timezone` drives report day boundaries; worker scheduler hourly, idempotent *(directed)* | 018 | SRS FR-TEN-007, FR-RPT-002/006, AC-19 · ARCH §1, §4 · ERD · WF p1/p6 | Resolved |
| INC-20 | Minor | Duplicate-email registration response | Same 202 + "account exists" email (account-neutral) | 013 | SRS FR-AUTH-001 · UF p0 | Resolved |
| INC-21 | Major | Assignee eligibility | Must have project access (ACTIVE ProjectMember or ws Owner/Admin) else 422; Member self/none on create *(directed)* | 012, 008 | SRS FR-ISS-009 · WF p4 · RP p4/p5 · UF p5 | Resolved |
| INC-22 | Minor | Matrix row mentions excluded billing | Row renamed "Transfer workspace ownership" | 020 | SRS §4 · RP p3 · CSV | Resolved |
| INC-23 | Minor | Member-list visibility | Names/roles visible to all members; emails + invitations Owner/Admin; project roster to project members | 020 | SRS FR-TEN-008, FR-PRJ-002, §4 · RP p3 · NAV p1/p2 | Resolved |
| INC-24 | Minor | Member edit of type/parent/labels | Not after creation; Member sets them on create only | 008 | SRS §4 footnote · RP p4/p6 · CSV | Resolved |
| INC-25 | Critical | PM may change issue project vs immutable keys | Issue project immutable for all roles; no cross-project moves *(directed)* | 006 | SRS §4 footnote, FR-ISS-001, §6 · RP p4/p6 | Resolved |
| INC-26 | Major | Implicit FKs and delete behaviour | All 46 `*Id` columns declared FK; RESTRICT everywhere except IssueLabel.labelId CASCADE; no hard deletes *(directed)* | 019 | ARCH §4, §8 · ERD p2/p4 | Resolved |
| INC-27 | Minor | Deliverable numbering / matrix format | Mapping fixed in Plan §6; CSV matrix delivered | 020 | PLAN §6 · CSV | Resolved |

## Verification of closure
- Automated: Architecture v3 §4 ⟷ ERD attribute sets equal for all **22** entities; all 46 FK columns modelled and declared `FK` in Arch v3 (previously 10 implicit).
- No diagram contains an open-decision (pink dashed) node or a `TBD` cell; the only remaining `INC-` mentions are on ERD page 5 (change log, historical reference).
- Every ADR-001…020 and every SRS v3 FR/NFR/AC ID is referenced by at least one diagram page (107 / 107).

## Remaining open items (non-blocking, not architectural)
| Item | Why non-blocking | Owner / gate |
|---|---|---|
| Production email provider, object-store vendor, demo host | Behind adapters (ADR-004/005); dev defaults defined | Delivery, G1 |
| Exact MIME allow-list extensions beyond ADR-004 list | Config value, not schema | Security, G3 |
| WCAG 2.2 AA known gaps | Documented at G5 per NFR-06 | QA, G5 |
| Measured p95 numbers (NFR-05) | Measured on seeded data at G5 | QA, G5 |

No critical or authorization decision remains open.
