# Known gaps (carry-forward list)

Open items to close before release (CLAUDE.md §4). Remove an entry when it is fixed.

| ID     | Area        | Gap                                                                                                                                                                                                     | Planned                 |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| GAP-01 | API quality | G2-A workspace/member/invitation endpoints build responses with typed mappers but do not Zod-validate them (`sendDto`, used by project endpoints since G2-B1).                                          | Final quality pass (G5) |
| GAP-02 | Schema      | `Project.status` DB default is `PLANNED`; SRS FR-PRJ-001 says `ACTIVE`. The API always sets the status explicitly, so behaviour is correct; the default needs a one-line migration (approval required). | Next approved migration |
| GAP-03 | Email       | Auth and invitation emails are sent directly, not through the outbox (ADR-005).                                                                                                                         | G4                      |
| GAP-04 | Jobs        | Invitation expiry is lazy only; the hourly sweep (ADR-018) needs `apps/worker`.                                                                                                                         | G4                      |
| GAP-05 | Docs        | OpenAPI 3.1 contract not yet written.                                                                                                                                                                   | G5                      |
| GAP-06 | Auth        | FR-AUTH-004 (profile, password change, deactivation), forgot/reset-password screens and the platform login screen.                                                                                      | G4/G5                   |
| GAP-07 | Testing     | No browser E2E or CI smoke E2E yet; CI integration job needs `RUN_INTEGRATION=true`.                                                                                                                    | G5                      |
