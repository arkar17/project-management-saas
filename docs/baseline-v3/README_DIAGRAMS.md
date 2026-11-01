# Diagram & Specification Package — Project Management SaaS, Release 1.0 (Baseline 3.0)

**Status:** Approved for implementation. All 27 inconsistencies from the Baseline 2.0 review are resolved (INCONSISTENCY_REGISTER_v3.md); decisions are recorded in ADR_LOG_v3.md. The diagrams reflect SRS v3 and Architecture & Data Model v3 exactly; no open-decision nodes remain.

## Package contents

| File | Content |
|---|---|
| `01_Software_Requirements_Specification_v3.docx` | SRS revised in place: roles, matrix, 57 FRs (8 new), invariants, screens, 20 acceptance scenarios |
| `02_Technical_Architecture_and_Data_Model_v3.docx` | 22 entities, cardinality, full route inventory, status-code contract, composite keys, FK/delete rules, decided ADR table |
| `03_Implementation_Quality_and_Documentation_Plan_v3.docx` | Gates, slices, test strategy incl. traceability, deliverable mapping, checklist |
| `ADR_LOG_v3.md` | ADR-001…ADR-020 (context, decision, rationale) |
| `INCONSISTENCY_REGISTER_v3.md` | INC-01…27 with decision, ADR and updated artifacts — all resolved |
| `TRACEABILITY_REPORT_v3.md` | Requirement → entity → API → flow → test case (94 TC IDs) |
| `PERMISSION_MATRIX_v3.csv` | Capability × role matrix + issue field rules (source for policy tests) |
| `01_system_workflow.drawio` | 8 pages: architecture, request pipeline, workspace/invitation lifecycle, project & issue, Kanban, sprint, notifications, exception map |
| `02_user_flows.drawio` | 6 pages: common auth, Super Admin, Owner, Admin, PM, Member |
| `03_database_erd.drawio` | 5 pages: conceptual, logical (22 entities), isolation, enums/constraints, v2→v3 change log |
| `04_role_permissions.drawio` | 6 pages: hierarchy, effective role, matrix, field rules, cross-workspace checks, forbidden actions |
| `05_navigation_sitemap.drawio` | 3 pages: sitemap & routes, role-restricted screens, desktop/mobile navigation |

## Opening and editing

Open any `.drawio` file in diagrams.net (web or desktop) or the VS Code *Draw.io Integration* extension. Pages are tabs along the bottom. Files are uncompressed mxGraph XML, so they diff cleanly in Git. Everything is native and editable: ERD entities are stack-layout containers (add a row by copying one), swimlane lanes are real containers (moving a lane moves its nodes), and connectors are attached to shapes, so they re-route automatically when shapes move. Connector routes were left to draw.io's orthogonal router; after a large edit, *Arrange → Layout* or a manual nudge may tidy crossings.

## Visual conventions (identical in all files)

| Element | Meaning |
|---|---|
| Green ellipse | Start / end |
| Blue rounded box | Process / service step |
| Yellow diamond | Decision / guard |
| Red rounded box | Exception / error response |
| Orange dashed box / arrow | Asynchronous path (outbox, worker) |
| Purple cylinder | Persistent store |
| Yellow note | Rule, assumption or explanation |

**Role colours:** Super Admin purple · Owner dark blue · Admin blue · Project Manager green · Member grey · Workspace member without project row light grey · Public gold.

**ERD header colours (tenant-isolation class):** dark blue = tenant root (`Workspace`) · green = carries `workspaceId` · light blue = tenant via immutable FK ancestry · grey = global (not tenant-owned).
**ERD edges:** thick dark blue = tenant-ancestry FK · thin grey = reference to `User` · orange = other FK · dashed = nullable FK. Crow's-foot ends: `‖` mandatory one, `o|` optional one, `o<` zero-to-many, `|<` one-to-many.

## Modelling policies

- **Fields:** the logical ERD contains exactly the attributes of Architecture v3 §4 (automated set-equality check, 22 entities).
- **Types:** `uuid` → Prisma `String @db.Uuid`; `timestamptz` → `DateTime @db.Timestamptz` (UTC); `date` → `DateTime @db.Date`; `jsonb` → `Json`; enums → Prisma `enum`; `rank` → `String` (collation C, ADR-016).
- **Composite FKs** (ADR-011) map to Prisma `@relation(fields: [a, b], references: [x, y])` with `@@unique([x, y])` on the target; partial unique indexes require raw SQL in the migration.
- **Deletes:** `onDelete: Restrict` everywhere except `IssueLabel.labelId` (`Cascade`) — ADR-019.
- **Routes** in the sitemap are the frontend URL scheme for Release 1.0; API routes are those of Architecture v3 §6.

## Validation performed (single combined run after all Baseline 3.0 changes)

| Check | Result |
|---|---|
| Word documents: XSD validation against originals (docx skill validator) | 3 / 3 pass |
| draw.io XML well-formedness (`xmllint`) | 5 / 5 pass |
| mxGraph structure: pages, root cells, unique IDs, parent chains | pass |
| Connectors: existing vertex source and target | 621 edges, 0 errors |
| Geometry valid; no overlapping sibling shapes | 2,031 vertices, 0 errors |
| Arch v3 §4 ⟷ ERD attribute sets | 22 / 22 entities equal |
| `*Id` columns modelled as relationships and declared FK in Arch v3 | 46 / 46 |
| Requirement / ADR IDs referenced by diagrams | 107 / 107 |
| Open-decision nodes or `TBD` cells left in diagrams | 0 |
| Traceability: FRs with entity, endpoint, flow, test | 57 / 57; 97 endpoint references all found in Arch v3 §6 |

Stats: 01 — 8 pages / 468 shapes / 254 connectors · 02 — 6 / 386 / 177 · 03 — 5 / 439 / 104 · 04 — 6 / 459 / 29 · 05 — 3 / 279 / 57.
Rendering inside the draw.io application itself could not be tested here (no draw.io runtime); the files use only built-in shapes.

## Development readiness

1. G0 complete: SRS v3, Architecture v3, Plan v3, ADR log, register and diagrams are consistent; no critical or authorization decision is open.
2. G1 starts with the Prisma schema generated from ERD page 2 + page 4 (composite FKs, partial indexes in raw SQL) and the PlatformAdmin seed.
3. Keep the ERD, Architecture §4 and Prisma schema in sync on every change and re-run the cross-check (Plan v3 §9).

No application code, migrations, database changes or deployments were produced for this package.
