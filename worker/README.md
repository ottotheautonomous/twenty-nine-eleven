# Contact delivery Worker

The page submits JSON directly to `https://contact.twentynineeleven.net/api/contact`. This Worker sends the enquiry to `contact@twentynineeleven.net` using Cloudflare's native Email Service binding. Visitors stay on the site. There is no email-client handoff and no pretend success response.

## Before deployment

1. Use the Cloudflare account that controls `twentynineeleven.net` and its DNS. The deployment identity needs permission to deploy Workers and configure the custom Worker domain. Keep authentication in the local Wrangler profile or the deployment environment; never put tokens in the frontend or commit them.
2. Verify that `contact@twentynineeleven.net` is a functioning receiving address. Add it under **Compute → Email Service → Email Routing → Destination Addresses** and complete the verification email. The exact recipient is fixed in both the code and the binding.
3. Ensure `twentynineeleven.net` is onboarded as an Email Routing domain, or onboard it for Email Sending. The sender `enquiry@twentynineeleven.net` must belong to the onboarded domain. Sending to a verified destination is free on all plans, including accounts with only Email Routing. Sending to an arbitrary unverified address requires Workers Paid and sending-domain onboarding.
4. Inspect the current mail setup before onboarding Email Routing: it changes the root MX records and cannot coexist with an external receiving mail server on the same domain. If the contact mailbox already uses Google Workspace or another provider, preserve those MX records and use Email Sending onboarding instead; its bounce records use the `cf-bounce` subdomain. Review any existing DMARC policy before onboarding. If `contact@` is a routing alias, make sure forwarding is working before verifying it as a destination.
5. Check that `contact.twentynineeleven.net` is available for the Worker custom domain. The root `wrangler.jsonc` publishes only that hostname and disables the public `workers.dev` endpoint and preview URLs.
6. Use Wrangler **4.36.0 or newer**. The rate-limit namespace `2911001` must be unique within the Cloudflare account unless sharing counters is intentional. It permits five requests per IP per 60 seconds per Cloudflare location. The native rate limiter is approximate and location-scoped; it is an abuse deterrent, not a strict global quota.

The old Email Routing `send-email-workers` documentation now redirects to the Email Service Workers API. This implementation uses its current structured `send()` API, so no MIME-building dependency is needed.

## Local verification

From the repository root:

```sh
node --test worker/contact.test.mjs
```

The tests stub email delivery and rate limiting; they send no email and require no Cloudflare credentials. They cover acceptance sequencing, fixed recipients, delivery errors, missing bindings, origins and preflight, rate limits, bounded body streaming, invalid JSON/UTF-8, payload validation and header injection.

For Wrangler packaging validation, after installing an approved local Wrangler version:

```sh
npm run contact:check
```

Dry-run builds the Worker without publishing it. Ignore or remove `worker/.dry-run` before committing. `wrangler dev` simulates email locally unless the binding is explicitly made remote; do not set `remote: true` just to validate code because it sends actual emails.

## Deployment and browser connection

After the prerequisites are fulfilled:

```sh
npm run contact:deploy
```

No Cloudflare account ID, API token or destination-verification action is embedded in this repository. The deployment command uses the selected local Cloudflare identity.

The frontend build must set `VITE_CONTACT_ENDPOINT` to this Worker URL, or use its matching default. Allowed origins already include Otto's and Michael's GitHub Pages origins and the apex/`www` company domain. Origins contain scheme and hostname, never a repository path. Localhost is deliberately absent from the production allowlist; add an explicit local origin to local-development configuration when needed.

Submit:

```json
{
  "name": "Jane Example",
  "email": "jane@example.com",
  "message": "I would love to discuss a new website.",
  "website": "",
  "requestId": "21f5d5dc-0896-4c55-9b85-fd756e532ea2"
}
```

`requestId` should come from `crypto.randomUUID()`. Limits are 120 characters for name, 254 for email, 10–5,000 for message, and 16 KiB for the complete UTF-8 request body. The optional `website` honeypot must be empty. Unknown fields cannot change the sender, destination, subject or content type.

The Worker returns HTTP 200 with `{"ok":true}` only after Email Service supplies an acceptance ID. Missing bindings, provider failure or missing acceptance return HTTP 503 with a safe `error` message; the page must retain the draft and display the failure. HTTP 400, 413, 415, 429 and 403 indicate invalid input, body size, content type, throttling and rejected origin respectively. The successful response confirms service acceptance, not final inbox placement. Verify one authorized real submission and inbox receipt before declaring email delivery operational.

The Worker does not store drafts, log contact contents or automatically retry email delivery. The request UUID is a reference included in the mail, not a durable idempotency key; a manual retry after an ambiguous network failure can generate a duplicate. CORS/origin checking protects browser access but does not authenticate visitors: non-browser clients can imitate an Origin header. The body limits, fixed destination, honeypot and edge rate limiter limit misuse without adding visible form steps.

## Official references

- [Workers Email Service API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Destination verification](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Domain configuration and existing mail](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Email Service sending limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
