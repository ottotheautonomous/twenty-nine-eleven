# twenty nine eleven

A centered single page for security, bespoke technology and multidisciplinary design. **Sentinel**: a geodesic perimeter of cold silver light, ten great circles woven into a cage with real gaps, held around one small warm ember. The cage is the perimeter; the ember is what is kept. The visitor's cursor is the probe: where it rests, the lattice notices it; where it sweeps, the lattice tears open in fluid streams and the ember's warmth leaks through the breach; where it settles, hairlines lock onto nearby nodes and print what a penetration tester would read there (documentation-range addresses only). Integrity is a ledger: one fast pass costs about 0.11, a sustained attack can drive it below 0.2. A second after the hand stops, the perimeter re-forms: the readings retract, the deficit holds, releases once and then the corner instrument climbs slowly back to `INTEGRITY 0.998`. Once per visit, after two tears, one reading turns red: a finding on a test range.

Every scene input is a [Motion](https://motion.dev/) value and the render loop runs on Motion's frame scheduler. The capability rows are plain text with per-letter light that the scene answers; text never moves. No header or footer. The closing colophon, “Plans for hope and a future”, references Jeremiah 29:11; clicking it opens the full verse (New International Version; Biblica's copyright notice is in `public/third-party-notices.txt`) in a panel that springs from the ember. The ember exists before the walls and every tear heals.

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

- `index.html`: company copy, services, form labels, the corner instrument and the static poster.
- `src/style.css`: composition, type scale, colour tokens, readouts and fallback states.
- `src/main.js`: entrance, pointer/touch/keyboard/idle, press and tap, rows feeding the scene, pause, one dialog controller for the contact ("authorize") and verse ("purpose") panels, validation and submission.
- `src/verse-light.js`: wraps the verse into words so light can read across it.
- `src/scene-state.js`: the shader uniforms and the Motion values bound to them.
- `src/scene/constants.js`: every tuning constant (lag chain, exposure, orbit, ember, integrity, colours).
- `src/scene/shape.js`: the lattice (R2 order), the 64 nodes, their seven classes (one per row-1 word, anchored under it) and their readouts.
- `src/scene/model.js`: the GL-free interaction model (lag chain, trail grid, integrity, exposure, plexus, greet/lose, dwell, finding).
- `src/scene/webgl.js`, `particles.js`, `fluid.js`, `bloom.js`, `glsl/*`: the WebGL2 pipeline (fluid, GPGPU particles, trail, ember, bloom, composite).
- `src/scene/canvas2d.js`: the same scene drawn with Canvas2D sprites when WebGL2 is unavailable.
- `src/scene/sentinel.js`: tier selection, resolution budget and governor, the Motion frame loop, context loss.
- `src/text-motion.js`: per-letter Motion waves, label illumination, underlines and separator feedback.

QA flags: `?debug` (readout and `window.__tne`), `?gl=force` (use WebGL even on software renderers), `?tier=xe|uhd|android|iphone|c2d`, `?still=1` (the composed still), `?quality` (disable the governor), `?shape=0` (six-circle lattice).

The static poster `public/sentinel-still.webp` is the real settled WebGL frame, rendered headlessly with `?gl=force&still=1` and cropped to the anchor box plus 13 %. Regenerate it after changing the look.

Performance has not been measured on a real GPU yet. Open `tools/bench.html` on a typical laptop and phone (serve the folder, or open the file directly on the laptop) and run the quick sweep; its `points`-vs-count and `fluid`-vs-iterations rows set the start tiers in `src/scene/sentinel.js`. Third-party licences for the scene code are in `public/third-party-notices.txt`.
