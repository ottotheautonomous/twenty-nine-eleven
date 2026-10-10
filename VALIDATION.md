# Verification — 10 October 2026

The Sentinel revision replaces the Threshold doorway and grid floor with a geodesic perimeter of light around an ember, an interaction model built on igloo.inc's documented pointer behaviour, and non-interactive capability rows. Direction: a Fable-overseen research team, four competing Fable concepts, two judges and a Fable spec; implementation by Claude Opus. Prior versions remain in Git history.

- Production build: passed. One JS bundle, about 64 kB gzip (spec budget 75 kB). No new npm dependencies; the scene code is raw WebGL2 lifted from a reviewed kit with its licences in `public/third-party-notices.txt`.
- Backend tests: 18 passed, with stubbed email delivery. No test email sent.
- Form validation, payload, submission, success/error copy and "Send another" are byte-identical to the previous revision. Dialog markup is unchanged.
- Every scene input is a uniform written by Motion (`threeEffect`) or by the CPU model; the loop runs on Motion's `frame.update`/`frame.render`. No `requestAnimationFrame` in the source.
- WebGL2 (SwiftShader, `?gl=force`) and Canvas2D renders were inspected at 1440×900, 390×844 and 320×568: lattice centred on the DOM anchor, ember at the centre, no floor or grid, type on ink, no horizontal overflow, both rows on one line.
- Pointer: hairlines lock onto at most four nodes; at most three readouts decode in, unique, from the documentation-range pool only; the corner line switches to `TRACKING` and integrity dips and recovers. Row hover keeps its letter wave, underline and separator response, sends a ripple through the lattice, lights the asset class (row 1) or tightens the lattice (row 2).
- Rows: plain `span`s, `tabIndex -1`, no click handler; a click opens nothing; tab order is contact → pause.
- Modal: the panel springs from the ember; the lattice breathes, dims and draws back; no slot or gate opens.
- Fallbacks forced in a test browser: without WebGL the Canvas2D tier draws the same lattice, ember, links and response; without any canvas the WebP poster of the real settled frame is shown and the pause control is hidden.
- Reduced motion: no entrance, idle, camera motion or pulses; one composed still; pause control hidden. Pause stops everything and resumes cleanly.
- Review round (Fable-overseen; 21 findings, each confirmed by an adversarial verifier, plus a Fable creative review) applied in 6837707: presence-gated proximity (the idle frame is at rest), tear = one fast pass (pure-model simulation: two fast swipes earn the finding at 60 and 30 Hz; slow 1.5 s sweeps never tear and integrity stays 0.998), unique readouts capped at three with AA plates, gesture uniforms that restart from keyframes, a governor that starts at the DPR cap and reads the real refresh, still frames that are seeded and clean, pinch-zoom kept, cheaper resize and style work.

**Not yet measured on real GPUs.** SwiftShader verifies the image, not the frame rate. Run `tools/bench.html` on a typical laptop and phone, and open the site with `?debug` to read fps, tier, backing scale and particle rows. The governor lowers resolution, then particle count, if frames run long.

**Live email delivery remains unverified.** Cloudflare authentication, destination verification and domain onboarding must be completed, followed by an authorized real enquiry and inbox readback.
