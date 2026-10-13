# Finish contact delivery

The page and contact service are separate: GitHub Pages hosts the page; a Cloudflare Worker receives the form and stores each
enquiry in the owner's private Supabase database. No DNS or mail settings change. The account steps below are the only
remaining connection work; the full runbook, with every command, the lockdown checks and key rotation, is
[docs/CONTACT-SUPABASE.md](docs/CONTACT-SUPABASE.md). Both services run on their free plans.

## 1. Prepare the Supabase project

The owner signs in; the lead runs the commands with the owner present (runbook sections 1-5):

- Keep the database password only in a password manager: no copy in a plain file, note or chat. If a copy ever existed,
  reset the password (runbook section 1).
- Turn on MFA for the Supabase account with a second authenticator factor on a different device or app (Supabase issues no
  recovery codes); keep the organization to the owner.
- Create a dedicated Free project. Data API exposed schemas stay `public, graphql_public` (never `intake`); Auth sign-ups off;
  Enforce SSL on. Network restrictions: an empty list lets every address connect, so add the two documentation entries
  `192.0.2.1/32` and `2001:db8::1/128` (or a "restrict all" control if offered), confirm they show as applied, then check that
  `select 1;` still runs in the SQL Editor (runbook section 3 step 4; if it does not, or the section is not offered, revert
  and record why).
- Run `supabase/migrations/20261013120000_contact_intake.sql` once in the SQL Editor, then `supabase/verify/live_checks.sql`:
  no FAIL row. The Security Advisor must show no ERROR or WARN. No Supabase CLI is needed; if it is used anyway, follow
  runbook appendix A (a one-day, project-only token, deleted afterwards; never `supabase login`).
- Create one secret key named `contact_worker` for the Worker and disable the legacy JWT keys.

## 2. Deploy the contact endpoint

Before the merge, create the Turnstile widget and set the repository variable `TURNSTILE_SITE_KEY` (step 3), so the form
never accepts an enquiry without the bot check. Then merge `contact-supabase` into `main`: the Pages workflow republishes
the page with the site key. Until `main` contains this branch, do not run the GitHub Actions deploy: it would redeploy the
old email Worker and every enquiry would fail with 503. Once the page with the site key is live (runbook section 6 step 2
has a key-free check), deploy from an up-to-date checkout of `main`. The secrets must exist before the first deploy
(`wrangler.jsonc` requires the two Supabase ones), and each value is typed at a hidden prompt, never into a file or a command
line:

```sh
npm ci
npx wrangler login
npx wrangler secret put SUPABASE_URL           # answer y to create the Worker; then https://<project-ref>.supabase.co
npx wrangler secret put SUPABASE_SECRET_KEY    # the owner pastes the contact_worker key
npx wrangler secret put TURNSTILE_SECRET       # the page with the site key is already live; the owner pastes the widget's secret
npx wrangler secret list                       # names only: SUPABASE_SECRET_KEY, SUPABASE_URL, TURNSTILE_SECRET
npm run check && npm run contact:check && npm run contact:deploy
npx wrangler logout
```

The deployment creates only the Worker, the `contact.twentynineeleven.net` custom hostname and one Cron Trigger that keeps the
Free database from pausing. It does not change the website's apex or `www` records. If `contact` already has a DNS record,
inspect its use before changing it; choose a free hostname and update `wrangler.jsonc` plus the GitHub `CONTACT_ENDPOINT`
variable instead.

For later deployment from GitHub (only once `main` contains this branch), store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository **Secrets** and run
**Actions → Deploy contact service to Cloudflare → Run workflow**; the Worker's secrets carry over to each new version. Use a
token scoped to the account's Workers and this zone's needed DNS/domain permissions. Tokens, the Supabase key and the Turnstile
secret never belong in page code, repository files, or chat.

## 3. The bot check (Cloudflare Turnstile): before the merge in step 2

The form is built for [Turnstile](https://developers.cloudflare.com/turnstile/), Cloudflare's invisible bot check. With both keys, Cloudflare's script loads only when the contact panel opens, and the Worker refuses any enquiry without a valid, single-use token. It is set up before the first deploy so the live form never runs without it (runbook sections 6 and 8):

1. In Cloudflare, open **Turnstile → Add widget**. Name it `twenty nine eleven contact`, add exactly the hostnames listed in `TURNSTILE_HOSTNAMES` in `wrangler.jsonc` (the Worker checks the token's hostname against that list), and choose **Managed** (Invisible would need Cloudflare's Turnstile privacy addendum cited in a privacy policy, which the site does not have). The **secret key** goes only to the hidden prompt of `npx wrangler secret put TURNSTILE_SECRET` in step 2's session; never commit or store it.
2. Give the page the **site key** (public): in the GitHub repository, **Settings → Secrets and variables → Actions → Variables**, add `TURNSTILE_SITE_KEY`. The Pages build passes it as `VITE_TURNSTILE_SITE_KEY`, and the page's Content-Security-Policy then allows `challenges.cloudflare.com` for its script and frame only. The merge in step 2 republishes the page with it.

The site key goes live before the secret is set: the Worker ignores the token while `TURNSTILE_SECRET` is unset, so a page with the site key is always safe, while a secret without that page would refuse every visitor. Turnstile is required because, without it, junk sent by a script could use up the database's cap (300 new enquiries in 24 hours, which stops a flood from filling the Free plan's 500 MB) and lock real visitors out until it is deleted. For more protection, also add a Cloudflare rate-limiting rule on `contact.twentynineeleven.net/api/contact` and turn on Bot Fight Mode for the zone.

The `GLOBAL_LIMITER` cap (20 enquiries a minute) counts per Cloudflare location, not worldwide, and only spends on enquiries that passed validation and the bot check. The rate-limiting rule above is the platform-level answer to a determined script, and it also protects the Workers free plan's daily request allowance.

## 4. Verify the real form

Run the live verification in [docs/CONTACT-SUPABASE.md](docs/CONTACT-SUPABASE.md) section 7. In short: the live checks and
the key-free API probe pass; then send one enquiry you authorize from the live page, using a name with a comma such as
`Smith, John` and a two-line message. Confirm the on-page thank-you state **and** the stored row in the Supabase Table Editor
(schema `intake`, table `contact_submissions`). If storing fails, your message stays in the form. Until this check succeeds,
enquiry storage remains unverified.

## Use the company domain later

Keep Pages as the site host. In the final repository's **Settings → Pages**, add `twentynineeleven.net` as the custom domain. Then configure Cloudflare DNS following [GitHub's domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site): apex records point to GitHub Pages; `www` points to the final GitHub account's Pages hostname. Start with DNS-only records while GitHub validates the domain and issues its certificate; enable HTTPS in Pages once available. Preserve mail records and the contact Worker hostname.

No apex or `www` DNS change has been made for this build.
