# Known gaps (carry-forward list)

Open items to close before release (CLAUDE.md §4). Remove an entry when it is fixed.

| ID     | Area          | Gap                                                                                                                                                                                                                                          | Planned                 |
| ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| GAP-01 | API quality   | G2-A workspace/member/invitation endpoints build responses with typed mappers but do not Zod-validate them (`sendDto`, used by project endpoints since G2-B1).                                                                               | Final quality pass (G5) |
| GAP-03 | Email         | Auth and invitation emails are sent directly, not through the outbox (ADR-005).                                                                                                                                                              | G4                      |
| GAP-04 | Jobs          | Invitation expiry is lazy only; the hourly sweep (ADR-018) needs `apps/worker`.                                                                                                                                                              | G4                      |
| GAP-05 | Docs          | OpenAPI 3.1 contract not yet written.                                                                                                                                                                                                        | G5                      |
| GAP-06 | Auth          | FR-AUTH-004 (profile, password change, deactivation), forgot/reset-password screens and the platform login screen.                                                                                                                           | G4/G5                   |
| GAP-07 | Testing       | No browser E2E or CI smoke E2E yet; CI integration job needs `RUN_INTEGRATION=true`.                                                                                                                                                         | G5                      |
| GAP-09 | Notifications | Mentions, assignment and watched-issue changes are written to `OutboxEvent` (`issue.commented`, `issue.assigned`, `issue.updated`) in the same transaction, but nothing delivers them yet (TC-ISS-005-4 checks who the recipients would be). | G4                      |

## Resolved

| ID     | Resolution                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-02 | `Project.status` default changed to `ACTIVE` (migration `20261024120000_project_status_default_active`, applied to `pm_test` only).                                                           |
| GAP-08 | Attachments implemented in G3-B: private S3 adapter (MinIO locally), 5-minute signed PUT/GET, 10 MB limit, ADR-004 allow-list with content sniffing, confirm-before-row; TC-ISS-006-1/2 pass. |
| GAP-10 | Board reordering (`PATCH /issues/:iid/rank`), anchor-based inserts, project-global appends and transactional rebalance (>64 chars) implemented in G3-A.                                       |
