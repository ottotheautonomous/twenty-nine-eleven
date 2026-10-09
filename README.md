# twenty nine eleven

A centered single page for security and bespoke technology. An open architectural shelter frames a path toward dawn, surrounded by a visitor-responsive surface field. Self-hosted typography and [Motion](https://motion.dev/) springs connect the artwork, lettering, capability controls and contact modal. Two capability rows. No header or footer.

The scene is a design interpretation of the owner's Jeremiah 29:11 naming and helping-people brief: supportive protection, hope and a way forward. The quiet “Hope & a future” reference draws from [Jeremiah 29:11](https://www.biblegateway.com/passage/?search=Jeremiah+29%3A11&version=NIV). It expresses the supplied values without adding other beliefs or promises.

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
- `src/main.js`: continuous Motion, dialog transitions, validation and submission states.
- `src/cipher.js`: authored shelter, dawn/path geometry and favicon.
- `src/background.js`: viewport surface field, WebGL/Canvas rendering and activity controls.
- `wrangler.jsonc`: email destination restrictions, endpoint and allowed origins.
- [worker/README.md](worker/README.md): backend details, prerequisites and limitations.

Fonts are Space Grotesk and IBM Plex Mono, distributed under their respective SIL Open Font Licenses through Fontsource. Dependencies are locked; font files ship with the page. The sculpture stays grounded while its protective shoulders part slightly, its dawn/path light responds to intent, and the shared camera reacts to the visitor. Typography receives the same moving light and restrained depth response.

The whole viewport renders a continuous folded surface field, using WebGL2 when available and shaded Canvas2D ribbons otherwise. Motion-smoothed pointer and touch position bend its geometry, shift localized reflections and release a restrained tap impulse. Keyboard focus gives equivalent lighting/intent feedback. Backing resolution is capped at 2.8 million pixels. Pause/reduced motion stop spatial and ambient animation while retaining immediate color feedback. Ambient motion also pauses while contact is open or the tab is hidden. Touch scrolling is preserved. Compact labels keep each capability row on one line on mobile.

Each capability label can open the native contact dialog from that control and prefill an empty message with the chosen topic. Existing drafts are preserved. The dialog traps keyboard focus and restores it to the originating control. Drafts and pending requests survive closing/reopening. Browser checks use a local email fixture; the real backend activation remains separate.
