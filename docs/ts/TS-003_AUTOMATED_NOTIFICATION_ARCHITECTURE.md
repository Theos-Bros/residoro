# TS-003 — Automated Notification Architecture (pg_cron + Edge Functions)

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Document the one architectural pattern reused three times in this codebase for time-based
automated checks (contract expiry, training reminders, listing-authority expiry) — established
deliberately with the intent that future time-based checks reuse it rather than invent a fourth
variant. Written from a 2026-07-27 birds-eye technical review.

---

## Scope

Covers `supabase/functions/contract-expiry-check`, `training-reminder-check`,
`listing-authority-expiry-check`, and the `pg_cron`/`pg_net` dispatch mechanism. Does not cover
each function's specific business logic in detail (see DS-006 for Contract/Training rationale,
DS-004 for Listing authority) or the migration pipeline's own architecture (TS-004).

---

## Architecture

**SQL stays a thin dispatcher.** The only existing precedent for "real logic in SQL" in this
schema (`handle_new_user()`, DD-001) was treated by its own authors as an uncomfortable
exception, not a pattern to grow — this architecture deliberately avoids a second one. Each
check is: a `pg_cron` job, scheduled daily (`0 1 * * *` for contract-expiry and
training-reminder; `0 2 * * *` for listing-authority-expiry, offset to avoid contention), that
calls `net.http_post` to invoke a Supabase Edge Function. All actual logic — querying which
rows need action, composing and sending email via Resend, writing state back — lives in
TypeScript inside the Edge Function.

**Auth**: `verify_jwt = false` in `supabase/config.toml` for all three — deliberate, not an
oversight (inline comment confirms). Instead, each function checks a custom `CRON_SECRET`
bearer token, read from Supabase Vault at cron-call time (`vault.decrypted_secrets`), never
committed to any migration file. All three currently reuse one Vault secret name
(`contract_expiry_cron_secret`) even for non-contract-expiry jobs — functionally a project-wide
cron secret, confirmed intentional reuse, though the name is a bit confusing for what it's
become.

**Idempotency**: every warning type tracks its own `*_sent_at` timestamp column (e.g.
`workspaces.warning_7d_sent_at`, `listings.authority_warning_7d_sent_at`,
`training_sessions.reminder_sent_at`) — a warning fires at most once per threshold per period,
and is reset to null on the relevant renewal event so a future re-approach re-warns. This exact
idempotency-flag shape is the second half of the reused pattern, alongside the dispatcher
architecture itself.

**Service-role dependency**: all three functions read `SUPABASE_SERVICE_ROLE_KEY` via the
platform's automatic Edge Function environment injection — none of them set it explicitly via
`supabase secrets set`. This is the specific blocker tracked in RFC-003 (Supabase project
migration): legacy API keys can't be disabled project-wide while these three functions depend on
that auto-injection.

---

## Instances

| Function | Schedule | Warning tiers | Idempotency column |
|---|---|---|---|
| `contract-expiry-check` | Daily, 01:00 UTC | 30d / 7d / 1d, then `access_state` transitions | `workspaces.warning_30d/7d/1d_sent_at` |
| `training-reminder-check` | Daily, 01:00 UTC | Single tier, 3 days before | `training_sessions.reminder_sent_at` |
| `listing-authority-expiry-check` | Daily, 02:00 UTC | Single tier, 7 days before | `listings.authority_warning_7d_sent_at` |

---

## Related Documents

- DS-006 — Client Lifecycle Operations (Contract/Training business rationale)
- DS-004 — Listings & Docket Sharing (authority-expiry business rationale)
- DD-001 — Workspaces & Profiles, DD-009 — Training Sessions
- RFC-001 — Pre-Scaling Infrastructure Readiness
- RFC-003 — Supabase Project Migration Plan (the service-role secret this pattern depends on)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review. |
