# Contact intake Worker

The page submits JSON directly to `https://contact.twentynineeleven.net/api/contact`. This Worker validates the enquiry and stores it in the owner's private Supabase database through one server-only database function; nothing is emailed and no mail settings are involved. Visitors stay on the site. There is no email-client handoff and no pretend success response.

## Before deployment

1. Use the Cloudflare account that controls `twentynineeleven.net` and its DNS. The deployment identity needs permission to deploy Workers and configure the custom Worker domain. Keep authentication in the local Wrangler profile or the deployment environment; never put tokens in the frontend or commit them.
2. Prepare the Supabase project and apply `supabase/migrations/20261013120000_contact_intake.sql` as described in [docs/CONTACT-SUPABASE.md](../docs/CONTACT-SUPABASE.md). The enquiry table lives in the private `intake` schema, which the Data API never exposes; the Worker can only call `public.submit_enquiry` (and the keep-alive `public.contact_keepalive`), and nothing it holds can read a stored enquiry.
3. Set the two required secrets before the first deploy, each at Wrangler's hidden prompt: `npx wrangler secret put SUPABASE_URL` (`https://<project-ref>.supabase.co`) and `npx wrangler secret put SUPABASE_SECRET_KEY` (an `sb_secret_` key created for this Worker alone; legacy JWT keys are refused). `wrangler.jsonc` lists both under `secrets.required`, so a deploy without them fails. Never create a `.dev.vars` file with real values.
4. Check that `contact.twentynineeleven.net` is available for the Worker custom domain. The root `wrangler.jsonc` publishes only that hostname and disables the public `workers.dev` endpoint and preview URLs.
5. Use Wrangler **4.36.0 or newer** (the repository pins 4.149.0). The rate-limit namespace `2911001` must be unique within the Cloudflare account unless sharing counters is intentional. It permits five requests per IP per 60 seconds per Cloudflare location. The native rate limiter is approximate and location-scoped; it is an abuse deterrent, not a strict global quota.

Workers Free is enough: no email binding is used. One Cron Trigger (`17 3,11,19 * * *`, UTC) calls `public.contact_keepalive()` so the Free database sees activity and is not paused; a failed call shows as a failed run in the Cloudflare dashboard.

## Local verification

From the repository root:

```sh
node --test worker/contact.test.mjs
```

The tests stub the database call, Turnstile and rate limiting; they store nothing and need no Supabase or Cloudflare credentials (the test key is an obvious placeholder). They cover the exact database request (URL, method, the three headers, the five body fields, no redirect following), success sequencing, every database status (2xx stored; 429 busy; definite failures not retried; 5xx, network errors and timeouts retried once inside a 12-second budget), unread and cancelled database bodies, configuration that fails closed before the rate limiter, the keep-alive handler, origins and preflight, rate limits, bounded body streaming, invalid JSON/UTF-8, lone surrogates, payload validation and header injection. Every test also fails if any console line contains the key, a database body or a field of the enquiry.

For Wrangler packaging validation:

```sh
npm run contact:check
```

Dry-run builds the Worker without publishing it. Ignore or remove `worker/.dry-run` before committing. `wrangler dev` is not needed for this Worker; it would call the real database if real secrets were supplied.

The database side has its own offline proof on a throwaway local PostgreSQL 16: `bash supabase/verify/offline-pg16.sh`.

## Deployment and browser connection

After the prerequisites are fulfilled:

```sh
npm run contact:deploy
```

No Cloudflare account ID, API token, Supabase project URL or key is embedded in this repository. The deployment command uses the selected local Cloudflare identity, and the Worker reads the Supabase URL and key from its Cloudflare secrets.

The frontend build must set `VITE_CONTACT_ENDPOINT` to this Worker URL, or use its matching default. Allowed origins already include Otto's and Michael's GitHub Pages origins and the apex/`www` company domain. Origins contain scheme and hostname, never a repository path. Localhost is deliberately absent from the production allowlist; add an explicit local origin to local-development configuration when needed.

Submit:

```json
{
  "name": "Jane Example",
  "email": "jane@example.com",
  "message": "I would love to discuss a new website.",
  "hp_ref": "",
  "requestId": "21f5d5dc-0896-4c55-9b85-fd756e532ea2"
}
```

`requestId` should come from `crypto.randomUUID()`. Limits are 120 characters for name, 254 for email, 10–5,000 for message, and 16 KiB for the complete UTF-8 request body. The `hp_ref` honeypot (older pages send `website`) must be empty. Unknown fields are ignored: nothing in the request can choose the database, the function or the stored columns.

The Worker returns HTTP 200 with `{"ok":true}` only after Supabase confirms the enquiry is stored (a 2xx from the database function). Missing configuration, a database failure or a timeout return HTTP 503 with a safe `error` message; the page must retain the draft and display the failure. HTTP 400, 413, 415, 429 and 403 indicate invalid input, body size, content type, throttling and rejected origin respectively. Verify one authorized real submission in the owner's table before declaring the form operational.

The Worker stores exactly five things per enquiry: name, email address, message, the browser's random request id and the host of the page that sent it (one of the allowed origins, or nothing if the origin is not a plain host name). It stores no IP address, user agent or other header, keeps no drafts and logs no enquiry contents (only the HTTP status of a failed database call). The request id makes retries safe: the database keeps the first enquiry stored under an id and ignores later copies, so the Worker's single automatic retry after a timeout cannot create a duplicate. A visitor who edits the text and re-sends after an ambiguous failure keeps the same id until "Send another", so the first stored version wins. CORS/origin checking protects browser access but does not authenticate visitors: non-browser clients can imitate an Origin header. The body limits, honeypot, edge rate limiters, Turnstile (required before the form is called operational) and the single write-only database function limit misuse without adding visible form steps. The database function also refuses new enquiries once 300 arrived in the last 24 hours (HTTP 429 from Supabase, which the Worker answers with 503 and `Retry-After`), so neither a flood through the form nor a leaked key can fill the Free plan's 500 MB.

## Official references

- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase: hardening the Data API](https://supabase.com/docs/guides/database/hardening-data-api)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgREST functions (RPC)](https://docs.postgrest.org/en/latest/references/api/functions.html)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
