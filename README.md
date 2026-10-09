# twenty nine eleven

A single page for security and bespoke systems. Warm ivory, ink, a custom celestial mark, self-hosted typography and subtle [Motion](https://motion.dev/) transitions. One services line. One contact form.

**Website:** [ottotheautonomous.github.io/twenty-nine-eleven](https://ottotheautonomous.github.io/twenty-nine-eleven/)

The form submits directly to a Cloudflare Worker. It delivers to `contact@twentynineeleven.net` with the visitor's email as Reply-To. Visitors stay on the page. Success appears only after Cloudflare accepts the message; errors retain the draft. No email-app handoff, analytics or third-party font requests.

**Delivery status:** the frontend is ready; live email delivery requires Cloudflare account setup. See [DEPLOY.md](DEPLOY.md) for the shortest path. Do not call the form operational until a real submission arrives in the inbox.

## Run locally

```sh
npm ci
npm run dev
```

Node.js 22.12 or later is required. Production checks:

```sh
npm run check
npm run contact:check
npm run build
```

`check` exercises the contact backend with stubbed email; `contact:check` packages the Worker without publishing. Neither sends messages. `build` produces the static site in `dist/`.

## Hosting

- The GitHub Pages workflow builds and publishes `dist/` on pushes to `main`.
- The Cloudflare Worker lives in `worker/index.mjs`; its root `wrangler.jsonc` fixes the endpoint to `contact.twentynineeleven.net/api/contact`.
- Set the GitHub repository variable `CONTACT_ENDPOINT` if you choose a different contact hostname, then rerun the Pages workflow.
- No custom domain is attached to Pages yet. Domain DNS remains a separate setup step.

## Share with Michael

Open this repository while signed in as `MichaelJamesHofer` and choose **Fork**. In the new repository, open **Settings → Pages → Source → GitHub Actions**, then run **Actions → Publish GitHub Pages → Run workflow**. Relative assets and both accounts' contact origins are already supported. No transfer or Cloudflare change is required to preview from Michael's fork.

Once the fork is authoritative, use that copy for future changes and Cloudflare deployment. The contact server needs only one deployment.

## Adjust

- `index.html`: company copy, services and form labels.
- `src/style.css`: composition, type and color.
- `src/main.js`: Motion transitions, validation and submission states.
- `wrangler.jsonc`: email destination restrictions, endpoint and allowed origins.
- [worker/README.md](worker/README.md): backend details, prerequisites and limitations.

Fonts are Cormorant Garamond and Manrope, distributed under their respective SIL Open Font Licenses through Fontsource. Dependencies are locked; font files ship with the page. Motion respects the visitor's reduced-motion preference. At narrow widths the services remain one horizontally scrollable line, with keyboard access.
