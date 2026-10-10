# Finish contact delivery

The page and contact service are separate: GitHub Pages hosts the page; Cloudflare receives the form and sends the email. The account steps below are the only remaining connection work.

## 1. Prepare email in Cloudflare

Sign in to the Cloudflare account containing `twentynineeleven.net`.

- Open **Compute → Email Service** and verify `contact@twentynineeleven.net` as a destination address using its verification email.
- Onboard `twentynineeleven.net` as the sending domain, so the Worker can send from `enquiry@twentynineeleven.net`.
- If your mailbox already uses another provider, use **Email Sending** onboarding and preserve the existing receiving MX records. Email Routing onboarding changes those MX records. See Cloudflare's [domain instructions](https://developers.cloudflare.com/email-service/configuration/domains/).

Mail to a verified destination is supported on all Cloudflare plans. See [current pricing](https://developers.cloudflare.com/email-service/platform/pricing/). Email Sending availability and any account activation are determined by Cloudflare.

## 2. Deploy the contact endpoint

The easiest browser route imports this repository into Cloudflare Workers:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fottotheautonomous%2Ftwenty-nine-eleven)

Select the account owning the domain. The root `wrangler.jsonc` and `npm run deploy` are prepared for Workers deployment. This button deploys the **contact backend**; GitHub Pages already handles the visible page. Cloudflare may ask you to connect GitHub. Use Michael's fork as the source if that is your permanent repository.

If you prefer to deploy from this checkout, use:

```sh
npm ci
npm run contact:login
npm run contact:deploy
```

The deployment creates only the Worker and `contact.twentynineeleven.net` custom hostname. It does not change the website's apex or `www` records. If `contact` already has a DNS record, inspect its use before changing it; choose a free hostname and update `wrangler.jsonc` plus the GitHub `CONTACT_ENDPOINT` variable instead.

For later deployment from GitHub, store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository **Secrets** and run **Actions → Deploy contact service to Cloudflare → Run workflow**. Use a token scoped to the account's Workers and this zone's needed DNS/domain permissions. Tokens never belong in page code, repository files, or chat.

## 3. Turn on the bot check (Cloudflare Turnstile)

The form is built for [Turnstile](https://developers.cloudflare.com/turnstile/), Cloudflare's invisible bot check. It stays off until both keys exist; with them, Cloudflare's script loads only when the contact panel opens, and the Worker refuses any enquiry without a valid, single-use token.

1. In Cloudflare, open **Turnstile → Add widget**. Name it `twenty nine eleven contact`, add the hostnames that serve the page (e.g. `ottotheautonomous.github.io`, and later `twentynineeleven.net`), and choose **Invisible** (or Managed). Copy the **site key** and the **secret key**.
2. Give the Worker the secret (never commit it): `npx wrangler secret put TURNSTILE_SECRET`. `wrangler.jsonc` already lists the accepted page hostnames in `TURNSTILE_HOSTNAMES`; keep it matching the widget's hostnames (it is checked only once the secret exists).
3. Give the page the site key (public): in the GitHub repository, **Settings → Secrets and variables → Actions → Variables**, add `TURNSTILE_SITE_KEY`. The Pages build passes it as `VITE_TURNSTILE_SITE_KEY`, and the page's Content-Security-Policy then allows `challenges.cloudflare.com` for its script and frame only.
4. Redeploy the Worker and republish the page, then send a test enquiry (step 4).

Without the secret the Worker accepts enquiries without a token (rate limits, the honeypot and validation still apply). Set the secret only after the page with the site key is live, or real visitors will be refused. For more protection without Turnstile, add a Cloudflare rate-limiting rule on `contact.twentynineeleven.net/api/contact` and turn on Bot Fight Mode for the zone.

The `GLOBAL_LIMITER` cap (20 enquiries a minute) counts per Cloudflare location, not worldwide, and only spends on enquiries that passed validation and, once the secret is set, the bot check. Without Turnstile, a script sending valid-looking enquiries can still use it up for visitors near the same location; the rate-limiting rule above is the platform-level answer, and it also protects the Workers free plan's daily request allowance.

## 4. Verify the real form

Open the live page and send an enquiry you authorize for the contact inbox. Confirm the on-page thank-you state **and** the actual inbox receipt; Reply should address the email supplied in the form. Use a name with a comma, such as `Smith, John`, to confirm the Reply-To display name arrives intact. If sending fails, your message stays in the form. Until this check succeeds, email delivery remains unverified.

## Use the company domain later

Keep Pages as the site host. In the final repository's **Settings → Pages**, add `twentynineeleven.net` as the custom domain. Then configure Cloudflare DNS following [GitHub's domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site): apex records point to GitHub Pages; `www` points to the final GitHub account's Pages hostname. Start with DNS-only records while GitHub validates the domain and issues its certificate; enable HTTPS in Pages once available. Preserve mail records and the contact Worker hostname.

No apex or `www` DNS change has been made for this build.
