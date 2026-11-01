# Deployment

Status: **prepared, not deployed.** The Docker images and Compose stack below have not been built
or run yet (no container runtime in the development session). Nothing has been provisioned.

## Recommended low-cost setup (~€5/month)

| Piece                        | Recommendation                                                                               | Why                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API, worker, web, PostgreSQL | One small VPS (2 vCPU / 4 GB, e.g. Hetzner CX22 ≈ €4–5/mo) running `docker-compose.prod.yml` | Fixed price; the worker and Postgres need always-on processes, which are what make "free" PaaS tiers costly or sleepy |
| HTTPS                        | Caddy (in the stack) with automatic Let's Encrypt certificates                               | Free, zero manual renewal                                                                                             |
| Attachments                  | Cloudflare R2 private bucket (free tier: 10 GB, no egress fees)                              | S3-compatible, matches the existing adapter                                                                           |
| Email                        | A transactional SMTP free tier (e.g. Brevo 300/day or Resend 3 000/month)                    | The mail adapter is plain SMTP                                                                                        |
| Backups                      | Nightly `pg_dump` to the same R2 account (cron on the VPS)                                   | Pennies; restorable                                                                                                   |

A domain name (~€10/year) is the only other cost.

## Architecture on one host

```
Internet ──443──▶ Caddy (web image: React build + /api/* reverse proxy)
                     └──▶ api:4000 (Express)   ──▶ postgres:5432 (internal only)
                          worker (outbox + hourly jobs) ──▶ postgres, SMTP
                          browser ──signed URL (5 min)──▶ R2 private bucket
```

The SPA and the API share one origin, so `Secure; HttpOnly; SameSite=Lax` session cookies and the
CSRF Origin check work without CORS. Set `TRUST_PROXY=1` so rate limits see client IPs.

## Steps

1. **Server:** Ubuntu LTS VPS, Docker Engine + Compose plugin, firewall allowing 22/80/443 only.
   Point the domain's A/AAAA records at it.
2. **Storage:** create a private R2 bucket and an API token limited to it. Add a CORS rule allowing
   `PUT, GET` from `https://<APP_DOMAIN>` with headers `content-type, x-amz-meta-*`.
   Run `apps/api/scripts/verify-s3.ts` against it before go-live (real S3 verification is pending, GAP-11).
3. **SMTP:** create provider credentials and verify the sender domain (SPF/DKIM).
4. **Config:** `cp .env.production.example .env.production`, fill every value with real secrets
   (long random passwords; never commit the file).
5. **Build and migrate:**
   ```sh
   docker compose -f docker-compose.prod.yml --env-file .env.production build
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
   ```
   Migrations are committed and applied only with `prisma migrate deploy` (never `db push` or `migrate dev`).
6. **Platform admin (once):**
   `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx tsx prisma/seed.ts`
   with `PLATFORM_ADMIN_EMAIL/PASSWORD` set, then remove those two values from the env file.
7. **Start:** `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`
8. **Check:** `curl https://<APP_DOMAIN>/api/v1/health` (liveness) and `/api/v1/health/ready`
   (database). The API container also has a Docker `HEALTHCHECK` on `/health/ready`.

Do not run `npm run db:seed:demo` in production; it is for empty demo databases only.

## Upgrades

`git pull`, rebuild, run the `migrate` service, then `up -d`. Migrations are additive and
committed; take a `pg_dump` first.

## Environment variables

See `.env.production.example`. Required: `DATABASE_URL`, `WEB_ORIGINS`, `APP_BASE_URL`,
`SMTP_*`, `MAIL_FROM`, `S3_*`. The worker reads the database, SMTP and `APP_BASE_URL` values.
