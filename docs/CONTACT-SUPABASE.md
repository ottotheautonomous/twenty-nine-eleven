# Contact enquiries in Supabase: setup, verification and care

**Status: nothing below has been done yet.** No Supabase project, key, Cloudflare Worker or secret has been created by the
code change on branch `contact-supabase`. The **owner** signs in and handles the keys; the **lead** runs the commands with the
owner present, from the root of a checkout of this repository. This repository is public, so it names no account address,
computer or local file: those details live in the lead's untracked notes and the owner's password manager.

## What this builds

The page's contact form already posts to the Cloudflare Worker at `https://contact.twentynineeleven.net/api/contact`. The
Worker keeps every protection it had (origin allow-list incl. `www`, per-IP and shared rate limits, Turnstile (section 8),
validation, honeypot, body caps, fail-closed 503s) and, instead of sending an email, makes **one** call to one database
function in the owner's own Free Supabase project. Nothing about DNS or mail changes.

| Piece | What it is |
|---|---|
| `intake.contact_submissions` | The enquiries: `id`, `request_id`, `created_at`, `name`, `email`, `message`, `source` (the page's host, e.g. `www.twentynineeleven.net`). No IP address, no user agent, no other header. |
| `intake` schema | Private: never listed under the Data API's exposed schemas. RLS enabled **and forced** on every table, no policies, no grant to `PUBLIC`, `anon`, `authenticated` or `service_role`, now or by default later. |
| `public.submit_enquiry(...)` | The only write path. SECURITY DEFINER, `search_path = ''`, re-validates every field, stores once per `request_id`, refuses new enquiries once 300 arrived in the last 24 hours, returns nothing. Only `service_role` (the Worker's `sb_secret_` key) may call it. |
| `public.contact_keepalive()` | Stamps one non-personal row three times a day (Worker Cron Trigger) so the Free project is not paused. Same grant rule. |
| Worker secrets | `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, held only by Cloudflare. Never in the page, the repository, a file, a log or chat. |

Who can do what once this is live:

| Who | Read enquiries | Store an enquiry | Change or delete enquiries |
|---|---|---|---|
| A visitor, or anyone on the internet without a key | no | only through the Worker, after all its checks | no |
| Anyone holding the publishable key | no | no | no |
| Anyone holding the Worker's secret key (if it ever leaked) | **no** | yes, junk rows, until the key is rotated (section 9) | **no** |
| The owner, signed in to the Supabase Dashboard (role `postgres`) | yes | yes | yes |

Supabase itself (its staff and internal roles) can technically reach any hosted database, as with every hosted service.

Files: the migration `supabase/migrations/20261013120000_contact_intake.sql`; the read-only live checks
`supabase/verify/live_checks.sql`; the key-free live probe `supabase/verify/live_api_probe.sh`; the offline proof
`supabase/verify/offline-pg16.sh` (needs only the local PostgreSQL 16 binaries).

## 0. Tools

- Supabase CLI: if it is needed at all, use the pinned `npx supabase@2.120.0 ...` (an older global install may be present).
  It reports usage to Supabase unless told not to, so in every shell used for this: `export SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1`.
- Wrangler 4.149.0: `npx wrangler ...` in the repository checkout (`npm ci` first if `node_modules` is missing).
- Never pass a password or key as a command-line argument (`--password`, `-p`, `-H "apikey: ..."`): other users and programs
  on the same computer can read process arguments. Every step below uses hidden prompts or pipes instead.

## 1. First: database password hygiene (owner)

The project's database password belongs in a password manager and nowhere else. If a copy exists in a plain file, a note or
a chat (the lead's untracked notes list any known on this computer), do this before anything else:

1. Restrict the file at once (`chmod 600 <file>`), copy the value into a password-manager entry named "Supabase
   twenty-nine-eleven contact: database password", and remove the file (`shred -u <file>`).

The Worker never uses this password; only the optional CLI path (appendix A) might ask for it.

## 2. Supabase account (owner)

1. Sign in at https://supabase.com/dashboard with the owner's chosen account. Its exact address is recorded in the password
   manager entry, not in this repository.
2. Account settings: turn on **multi-factor authentication** (authenticator app). Store the recovery codes in the password manager.
3. Organization → Team: the owner is the only member. No invitations. (Enforcing MFA for a whole organization is a paid
   feature; with one member, the owner's own MFA is the control.)
4. The project in section 3 is for the contact form alone. Never put anything else in it: the migration removes PUBLIC's
   default EXECUTE on new functions project-wide, which is right for this project and would surprise another app.

## 3. Create and configure the project (owner, Dashboard)

If a project for this already exists, use it and only check the settings below.

1. **New project** in the owner's organization: name `twenty-nine-eleven-contact`; region **West US (Oregon)** unless the
   owner prefers East US (only the Worker's one database call crosses it); database password: **Generate**, straight into the
   password manager. Never into a file, a note or chat.
2. **Data API** (Integrations → Data API, or Project Settings → Data API): keep it **enabled** (the Worker uses it). **Exposed
   schemas: `public` and `graphql_public` only. Never add `intake`.** If there is an option to expose new tables and
   functions automatically, leave it **off** (the default for projects created since 2026-05-30).
3. **Authentication** (unused here): Sign In / Providers → turn off **Allow new users to sign up** and the Email provider.
   Leave every other provider off. Anonymous sign-ins off.
4. **Database settings**: **Enforce SSL on incoming connections: on.** **Network restrictions**, if the section is offered on
   this plan: allow no address (or, only while appendix A's optional CLI path is in use, the lead's current IP, removed right
   after). These restrictions
   cover direct Postgres and pooler connections only, not the HTTPS Data API, which keys and grants protect.
5. Leave **pg_graphql** disabled (Database → Extensions; off by default on new projects).
6. Note the **project ref** (the 20 characters in the Dashboard URL) and the project URL `https://<ref>.supabase.co`.

## 4. Apply the migration (lead, owner present)

### 4a. The SQL Editor (the default: no password, no CLI, no access token)

Dashboard → SQL Editor → New query → paste the whole of `supabase/migrations/20261013120000_contact_intake.sql` → **Run**. The
SQL Editor runs as `postgres`, which the migration requires (its first statement refuses any other role and creates nothing).
Expect success with no rows. If the editor warns about a potentially destructive statement, read it: the file only creates
objects and removes privileges; confirm for this file only. Run it **once**: a second run stops at `schema "intake" already
exists` and changes nothing.

### 4b. No CLI needed

Nothing in this runbook needs the Supabase CLI: the SQL Editor (4a), the Dashboard's Security Advisor (4c) and a Dashboard
copy of the secret key (section 6) cover every step, and none of them leaves a credential on this computer. The CLI's only
extra is a row in Supabase's migration history. If that is wanted anyway, use appendix A, which never runs `supabase login`.

### 4c. Database checks straight after

1. Paste `supabase/verify/live_checks.sql` into the SQL Editor and Run. One row per check. **Acceptance: rows 1-14 PASS, no
   FAIL** (row 14 is the daily cap: `daily_cap=300, PT429`). Read the INFO rows: 15 (exposed schemas as recorded on the role;
   otherwise confirm the Dashboard setting from section 3; the live proof is the probe in section 7 step 2), 16 (roles that
   bypass RLS: `postgres`, `service_role` and Supabase's internal roles), 17 (`enquiries=0, last_24h=0`).
2. **Security Advisor**: Dashboard → Advisors → Security Advisor → Rerun. **Acceptance: 0 ERROR, 0 WARN.** Expected and
   accepted by design: two INFO `rls_enabled_no_policy` findings, one per `intake` table (RLS with no policy is exactly
   "nobody but the owner"). The same linter reports exactly that on the offline stand-in. The Dashboard's Security Advisor
   can also list Auth-configuration findings that are not about the database (for example leaked-password protection, which
   may need a paid plan). Fix any that the plan allows. If one cannot be fixed on Free, the owner decides whether to accept
   it (Auth is unused, sign-ups are off), and the lead records the finding, the reason and the owner's initials in
   `VALIDATION.md`. Any database-level WARN or ERROR is a stop: do not continue.

## 5. The Worker's secret key (owner, Dashboard)

1. Project Settings → **API Keys** → Secret keys → **Create new secret key**, name `contact_worker`. This key is for the Worker
   only. Its only home is the Cloudflare secret in section 6: not the password manager, not a file, not chat. The Dashboard
   can show it again, and rotation (section 9) replaces it.
2. API Keys → Legacy API keys → **disable** the legacy `anon` and `service_role` JWT keys. Supabase: legacy keys "stay valid
   until you disable them". The Worker refuses legacy keys anyway.
3. Note the **publishable key** (`sb_publishable_...`). It is designed to be public; the lead uses it for the probe in section 7.

## 6. Cloudflare: secrets, then deploy (lead, owner present)

```sh
npx wrangler login && npx wrangler whoami         # the owner signs in: the account that holds twentynineeleven.net
npx wrangler secret put SUPABASE_URL              # 1st time: "There doesn't seem to be a Worker called twenty-nine-eleven-contact.
                                                  #  Do you want to create a new Worker with that name and add secrets to it?" -> y
                                                  #  then paste https://<ref>.supabase.co at the hidden prompt
npx wrangler secret put SUPABASE_SECRET_KEY       # the OWNER copies the key from the Dashboard and pastes it at the hidden prompt
npx wrangler secret list                          # names only: SUPABASE_SECRET_KEY, SUPABASE_URL
npm run check && npm run contact:check && npm run contact:deploy
npx wrangler logout                               # revokes the session: none stays on this computer
```

- The order matters. `wrangler.jsonc` lists both names under `secrets.required`, so `wrangler deploy` refuses to deploy
  without them, and for a Worker that does not exist yet it refuses outright ("This Worker does not exist yet, so secrets
  cannot be set in advance ... supply them via a secrets file"). We never put the key in a file. Instead, `secret put` first
  creates a placeholder Worker that only holds the secrets, and the real deploy then inherits them.
- After pasting the key: if a clipboard manager is running, delete the entry, then copy something harmless.
- `SUPABASE_URL` is not a credential, but the repository is public, so the project ref stays out of it.
- The deploy creates the custom domain `contact.twentynineeleven.net` (as before) and one Cron Trigger (`17 3,11,19 * * *`
  UTC). Cron changes can take up to 15 minutes to take effect.
- Later redeploys: `npm run contact:deploy`, or **Actions → Deploy contact service to Cloudflare** once `CLOUDFLARE_API_TOKEN`
  (scoped to this account's Workers and this zone) and `CLOUDFLARE_ACCOUNT_ID` are repository secrets. Secrets carry over to
  each new version. The Supabase key never goes to GitHub.
- If appendix A's CLI path was used, finish its cleanup (appendix A step 4) now. `supabase logout` alone revokes nothing.

## 7. LIVE verification (lead; all of it, in order)

Record the date and the outcome of each step in `VALIDATION.md`. The form is not operational until steps 1-5 pass **and
Turnstile is on (section 8, required)**.

1. **Database checks**: re-run `supabase/verify/live_checks.sql` (section 4c). No FAIL.
2. **No key, publishable key, and a made-up secret key all fail**:
   `REF=<ref> bash supabase/verify/live_api_probe.sh` (asks for the publishable key without echo). Every line must be `ok`,
   exit code 0. It tries to select, insert, update and delete the table (through `public` and through the `intake` profile)
   and to call both functions, with no key, with the publishable key as `apikey` and as a Bearer token, and with a random
   `sb_secret_` key. It checks that the OpenAPI description and GraphQL show nothing of the intake, and that the Worker refuses
   foreign origins and is configured (bad JSON from `www` gives 400; a 503 there means a secret is missing or malformed). It
   prints status codes and PostgREST error codes only, and stores nothing.
   **This is the live proof that `intake` is not exposed:** with the publishable key, every request that switches to the
   `intake` profile must answer exactly `406 PGRST106` (PostgREST: the schema "is not present in the db-schemas configuration
   variable"). A `401 42501` on such a line means `intake` **is exposed** (the request reached the privilege check): stop,
   remove `intake` from Exposed schemas (section 3 step 2), and run the probe again. With the key also sent as a Bearer
   token, a 401 before any schema is chosen is accepted; the apikey-only lines carry the proof.
3. **The secret key stores exactly one test row**: from https://www.twentynineeleven.net send one enquiry the owner authorizes:
   name `Smith, John`, the owner's own email, a two-line message with an emoji. The page must show its thank-you state. The
   Worker is the only holder of the key, so this is the secret-key RPC test; the key never comes to this machine. In the SQL Editor:
   `select id, created_at, name, email, char_length(message) as chars, source from intake.contact_submissions order by id desc limit 3;`
   Expect one row with `source = www.twentynineeleven.net`, and the name and message exactly as typed.
4. **Still nothing readable through the API with a row present**: run step 2 again (identical result) and
   `live_checks.sql` (row 17 now says `enquiries=1, last_24h=1`).
5. **Advisors**: Security Advisor shows 0 ERROR and 0 WARN (section 4c, including any recorded owner acceptance).
6. **Keep-alive**: after the next 03:17, 11:17 or 19:17 UTC, `select beat_at from intake.keepalive;` has moved, and the
   Worker's Cron Triggers page in the Cloudflare dashboard shows a successful run.
7. **Account hygiene**, ticked by the owner: Supabase MFA on; organization = owner only; Enforce SSL on; network restrictions set
   (or recorded as not offered on Free); the database password only in the password manager, no plain-text copy left; legacy JWT
   keys disabled; Auth sign-ups off; exposed schemas = `public, graphql_public`; Cloudflare account MFA on; Wrangler logged out on
   this computer; **Supabase Account → Access Tokens (https://supabase.com/dashboard/account/tokens) lists no token created for
   this setup** (no `cli_…` token from a `supabase login`, no token from appendix A), and the checkout has no `supabase/.temp`.
8. Optional: delete the test row in the SQL Editor (`delete from intake.contact_submissions where id = <n>;`; only the owner
   can). Then add a dated line to `VALIDATION.md`: "live enquiry storage verified".

## 8. Turnstile: required before the form is called operational

Without Turnstile, a script can send valid-looking enquiries, and the Worker's rate limits do not stop a determined one:
Cloudflare's rate-limit binding is "local to the Cloudflare location" and "permissive, eventually consistent", and a few
addresses (or one IPv6 /62) can keep the shared 20-a-minute cap busy all day. The database's own cap (300 new enquiries per
24 hours, section 9) keeps such a flood from filling the Free plan's 500 MB, but junk can still use up the cap and lock real
visitors out until it is deleted or ages out. Turnstile makes every enquiry carry a fresh, single-use proof from a real browser.

1. As in `DEPLOY.md` section 3: create the widget (hostnames: `www.twentynineeleven.net`, `twentynineeleven.net`, plus any
   GitHub Pages host still in use; they must match `TURNSTILE_HOSTNAMES` in `wrangler.jsonc`), set the repository variable
   `TURNSTILE_SITE_KEY`, and republish the page.
2. Only once the page with the site key is live: `npx wrangler secret put TURNSTILE_SECRET` (the owner pastes the secret at
   the hidden prompt). Before that, real visitors would be refused.
3. `npx wrangler secret list` shows `SUPABASE_SECRET_KEY`, `SUPABASE_URL` and `TURNSTILE_SECRET`. Re-run section 7 step 2,
   then send one more authorized enquiry from the live page (it must reach the thank-you state) and confirm its row as in
   section 7 step 3. Record "Turnstile on" with the date in `VALIDATION.md`.

## 9. Rotating the secret key, and what to do if it leaks

What a leaked `sb_secret_` key allows: calling `submit_enquiry` without the Worker's rate limits, i.e. inserting junk rows (up
to about 18 kB each with indexes, measured on PostgreSQL 16; at most 300 new rows per rolling 24 hours, about 5 MB a day,
because the function refuses more), stamping the keep-alive, and Supabase's admin APIs for Auth (no users, sign-ups off) and
Storage (no buckets). It does **not** allow reading, changing or deleting any enquiry: `service_role` has no privilege on
`intake`, the function returns nothing, the schema is not exposed, and RLS is forced. It gives no direct database access (that
needs the database password).

Routine rotation (no downtime):

1. Project Settings → API Keys → Create new secret key `contact_worker_2`.
2. `npx wrangler secret put SUPABASE_SECRET_KEY`: the owner pastes the new key at the hidden prompt. Wrangler deploys a new
   version at once.
3. Send one authorized enquiry from the live page and confirm the row (section 7 step 3).
4. Delete `contact_worker` in the Dashboard. Supabase: deleting a secret key "can't be undone", so do it only after step 3.

Suspected leak: delete the old key **first** (enquiries fail with the page's "could not be sent" message, and the visitor's
draft stays in the form), then steps 1-3. Afterwards look for junk rows (`select id, created_at, source from
intake.contact_submissions order by id desc limit 50;`) and delete them. If the database password may also have leaked: Project
Settings → Database → reset the password, into the password manager.

**The daily cap, and the public form.** Without the cap, about 29,500 maximal rows would fill Free's 500 MB, after which the
project "enters read-only mode" and every enquiry fails. That needs no leaked key: before Turnstile, a script sending
valid-looking enquiries through the public form could add roughly 28,800 a day per Cloudflare location. The cap bounds both
routes to about 5 MB a day (a measured flood of 1,000 maximal enquiries stored 300, about 5 MB, and refused 700). Its cost: junk
can use the cap up, and then visitors see the page's "could not be sent. Please try again shortly" message (the draft stays in
the form) until older rows leave the 24-hour window. To reopen the form at once, delete the junk (`select count(*) from
intake.contact_submissions where created_at > now() - interval '24 hours';` shows how many count). The number is the `daily_cap`
line in `public.submit_enquiry`; changing it is a reviewed migration (owner decision, section 12). If the database ever does
turn read-only, Supabase's way back, in the SQL Editor: `set session characteristics as transaction read write;`, delete the
junk, `vacuum;`, then `set default_transaction_read_only = 'off';`.

Related exposures to keep closed: anyone who can deploy this Worker (the Cloudflare account, or GitHub write access plus the
repository's Cloudflare token) could change what it does with **future** enquiries. They still cannot read stored ones. Keep
MFA on Cloudflare and GitHub and write access to the owner.

## 10. Reading, exporting, deleting, keeping

- **Read**: Dashboard → Table Editor → schema selector `intake` → `contact_submissions`, newest first by `created_at`; or a saved
  SQL Editor query. If the Dashboard suggests exposing the table to the API or adding a policy, decline: both would undo the
  lockdown. Supabase sends no notification of new rows. A content-free "new enquiry" ping can be added later (owner's choice).
- **Treat contents as untrusted text**: anyone can type anything into a contact form. When exporting to CSV and opening it in
  a spreadsheet, a message starting with `=`, `+`, `-` or `@` can run as a formula: import as text. Messages can contain
  invisible Unicode, so be careful when pasting them into other tools, AI assistants included.
- **Export**: Table Editor → export as CSV, or SQL Editor → Run → download CSV. Free has no backups, so the owner exports
  regularly into private storage. Never into this repository or a shared folder.
- **Delete one**: `delete from intake.contact_submissions where id = <n>;` in the SQL Editor.
- **Retention (owner decision)**: the default is to keep enquiries until deleted by hand. For an automatic limit, enable
  `pg_cron` (Database → Extensions), then run this once in the SQL Editor (12 months is the suggestion; 6 months leans
  further toward privacy):
  `select cron.schedule('contact-retention', '23 4 * * *', $$delete from intake.contact_submissions where created_at < now() - interval '12 months'$$);`
  The job runs as `postgres`, which bypasses RLS, so no grant changes are needed. Remove it with `select cron.unschedule('contact-retention');`.

## 11. Troubleshooting

`npx wrangler tail` (logged in) shows one line per failed database call: `contact: supabase submit_enquiry status <n>`. The
Worker logs nothing else: no contents, no key, no database body.

| Symptom | Meaning | Fix |
|---|---|---|
| 503 and no log line | `SUPABASE_URL` or `SUPABASE_SECRET_KEY` missing or malformed (URL must be `https://<20 chars>.supabase.co`, key must start `sb_secret_`), or the rate-limit binding missing | `npx wrangler secret list`; `secret put` again |
| status 401 | key wrong, deleted, or a legacy JWT | section 9, steps 1-3 |
| status 404 | migration not applied, or the API schema cache is stale | apply section 4; or run `notify pgrst, 'reload schema';` in the SQL Editor |
| status 540, or status 0 with DNS errors | the Free project is paused | Dashboard → Resume; check the keep-alive (section 7 step 6) |
| status 0 | timeout or network error (one retry already happened) | Supabase status page; try again |
| status 400 | the function refused a field the Worker accepted (should not happen) | report it with the time; no contents are logged |
| status 429 | the daily cap was reached (300 new enquiries in 24 hours), or Supabase rate-limited the call; the page shows "please try again" | count the last 24 hours (section 9); if junk, delete it and the form accepts again at once; otherwise wait |

## 12. Owner decisions still open

1. Keep-alive Cron Trigger (built, recommended) or accept pauses and resume by hand after Supabase's warning email.
2. Region: West US (Oregon) or East US.
3. Retention: keep until deleted by hand (default), 12 months, or 6 months.
4. The exact Supabase sign-in address.
5. Optional: one line in the contact dialog such as "Your details are stored privately so we can reply; nothing else is
   recorded." (not required: the page makes no storage claim), and an optional content-free new-enquiry ping.
6. Accepting an Auth-configuration Security Advisor WARN that the Free plan cannot fix, if one appears (section 4c).
7. The daily cap: 300 new enquiries per rolling 24 hours (shipped), or another number (section 9).

## Appendix A. Optional: the Supabase CLI with a short-lived, project-scoped token

Use this only if the migration must be recorded in Supabase's history. Every CLI command runs with a personal access token,
and while that token exists it can run SQL on the database, which means reading every enquiry. So:

- **Never run `supabase login`.** Supabase: its browser flow "still creates an account-level token", valid across all the
  owner's organizations until it expires or is deleted. `supabase logout` is "Log out and delete access tokens locally": it
  removes the local copy and revokes nothing.
- Pause other automated tools on this computer for the whole window: any program running as the same user can read the
  token from the shell's environment while it exists. Keep the window short.

1. The owner creates a token at https://supabase.com/dashboard/account/tokens: **this project only**; Database
   **read-write** (needed by `db push`) and nothing else; expiry: the shortest preset (one day). Supabase shows the value
   once. It goes straight into the hidden prompt below: never a file, the password manager or chat.
2. In one shell, with the token only in that shell's environment (the CLI reads `SUPABASE_ACCESS_TOKEN`; nothing is written
   to disk):

   ```sh
   export SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
   read -r -p 'Project ref: ' REF
   read -rs -p 'Supabase access token (not echoed): ' SUPABASE_ACCESS_TOKEN; echo; export SUPABASE_ACCESS_TOKEN
   npx supabase@2.120.0 link --project-ref "$REF"    # if it asks for the database password, the owner types it at the hidden prompt
   npx supabase@2.120.0 db push --linked --dry-run   # expect: would push 20261013120000_contact_intake.sql
   npx supabase@2.120.0 db push --linked
   npx supabase@2.120.0 db query --linked -f supabase/verify/live_checks.sql              # same as 4c step 1
   npx supabase@2.120.0 db advisors --linked --type security --level info --fail-on warn  # 4c step 2; exit code 0 required
   ```

   If a command is refused for lack of permission, use its Dashboard equivalent instead of widening the token.
   Tested offline against a Supabase-like PostgreSQL 16 with CLI 2.120.0: `db push` switches to `postgres` before applying
   (a role that cannot is refused at connect), applies the file atomically, records it in
   `supabase_migrations.schema_migrations`, and a failed run leaves no objects and no history row. No `supabase/config.toml`
   is needed. `link` writes `supabase/.temp/` (git-ignored).
3. Optional, clipboard-free transfer of the Worker key (section 6), only if the token at step 1 was also allowed to read this
   project's API keys. That widens the token, so the Dashboard copy stays the default. Check the field names with the masked
   listing (`npx supabase@2.120.0 projects api-keys --project-ref "$REF" -o json`), then, with `jq` installed and Wrangler
   logged in:
   `set -o pipefail; npx supabase@2.120.0 projects api-keys --project-ref "$REF" --reveal -o json | jq -er '.[] | select(.name == "contact_worker") | .api_key' | npx wrangler secret put SUPABASE_SECRET_KEY`
4. Cleanup, straight after the last command:

   ```sh
   unset SUPABASE_ACCESS_TOKEN REF
   rm -rf supabase/.temp
   ```

   Then the owner **deletes the token** at https://supabase.com/dashboard/account/tokens (the one-day expiry is a backstop,
   not the cleanup). If anyone ran `supabase login` after all, delete its `cli_<user>@<host>_<time>` token on the same page
   too, then run `npx supabase@2.120.0 logout` to remove the local copy. Remove any network-restriction exception added for
   this (section 3 step 4). Section 7 step 7 checks the result.

## Sources

- Supabase, API keys ("Send publishable and secret keys on the `apikey` header, not on `Authorization: Bearer`"; browser-like
  User-Agents get 401; secret keys act through `service_role`, which "has the `BYPASSRLS` attribute"; deleting a secret key
  "can't be undone"; legacy keys "stay valid until you disable them"): https://supabase.com/docs/guides/api/api-keys
- Supabase, Hardening the Data API ("RLS doesn't apply to functions, so grant `EXECUTE` only to the roles that need to call
  them"): https://supabase.com/docs/guides/database/hardening-data-api
- Supabase, Row Level Security ("On Supabase the owner is `postgres`, which has `bypassrls`"): https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, Database roles (the Dashboard runs queries as `postgres`): https://supabase.com/docs/guides/database/postgres/roles
- Supabase changelog, tables not exposed to the Data API automatically: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- Supabase, Database linter (0008 INFO; 0011, 0028, 0029 WARN; 0013 ERROR): https://supabase.com/docs/guides/database/database-linter
- Supabase, Free project pausing ("low activity over a 7-day period"; "a few user requests to the database each day";
  warning "roughly one week before"): https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase, HTTP status codes (540: project paused): https://supabase.com/docs/guides/troubleshooting/http-status-codes
- Supabase, Network restrictions ("They don't apply to HTTPS APIs such as PostgREST, Storage, and Auth"): https://supabase.com/docs/guides/platform/network-restrictions
- Supabase, SSL enforcement: https://supabase.com/docs/guides/platform/ssl-enforcement
- Supabase changelog, scoped personal access tokens (2026-10-06: tokens limited to selected projects, per-capability
  read or read-write, chosen expiry; "The browser flow for `supabase login` still creates an account-level token"):
  https://supabase.com/changelog/scoped-personal-access-tokens-ga.md
- Supabase CLI 2.120.0, read offline: `logout` is "Log out and delete access tokens locally" (no revoke call); the CLI takes
  a token from "the SUPABASE_ACCESS_TOKEN environment variable".
- Supabase, Multi-factor authentication for your account: https://supabase.com/docs/guides/platform/multi-factor-authentication
- Supabase, Backups (Free: export regularly): https://supabase.com/docs/guides/platform/backups
- PostgreSQL, Row security policies ("Superusers and roles with the BYPASSRLS attribute always bypass the row security system";
  FORCE ROW LEVEL SECURITY; default deny): https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL, ALTER DEFAULT PRIVILEGES ("you cannot revoke privileges per-schema if they are granted globally"): https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
- PostgREST, functions and errors (void functions answer 204; 42501 → "if authenticated 403, else 401"; PGRST106 → 406 for
  a schema not in db-schemas): https://docs.postgrest.org/en/latest/references/api/functions.html · https://docs.postgrest.org/en/latest/references/errors.html
- Cloudflare, Secrets (`secrets.required`; `wrangler secret put` deploys a new version): https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare, Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare, Rate Limiting binding ("local to the Cloudflare location"; "permissive, eventually consistent"):
  https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Supabase, Database size (Free projects "enter read-only mode when your database size exceeds 500 MB"; the SQL to leave
  it): https://supabase.com/docs/guides/platform/database-size
- PostgREST, raising `PTxyz` sets the HTTP status (`PT429` → 429): https://docs.postgrest.org/en/latest/references/errors.html
- Wrangler 4.149.0 source, read offline: the first-deploy refusal with required secrets, and the placeholder Worker that
  `secret put` offers to create.
- Design notes: the lead's review notes (not in the repository). Offline proof: `supabase/verify/offline-pg16.sh`.
