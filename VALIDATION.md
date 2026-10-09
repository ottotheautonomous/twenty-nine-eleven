# Verification — 9 October 2026

The Threshold revision replaces the tape field and shelter mark with a raymarched smoked-glass doorway, dawn behind it and a floor plan beneath it. It was planned and reviewed by Claude Fable and implemented by Claude Opus. Prior versions remain in Git history.

- Production frontend build: passed. One JS bundle, about 100 kB (36 kB gzip). No new dependencies; `motion/three` ships with the installed `motion`.
- Backend tests: 18 passed, using stubbed email delivery. No test email sent.
- Form validation, payload, submission, success/error copy and "Send another" are byte-identical to the previous revision. Dialog markup is unchanged.
- Every scene input is a uniform written by Motion (`threeEffect` on a bare uniforms object); the render loop runs on Motion's `frame.render`. No `requestAnimationFrame` in the source.
- WebGL2 renders were inspected at 1440×900, 390×844 and 320×568 through SwiftShader: door centred on its DOM anchor, warm light only through the opening, ink room, the grid limited to the door's surroundings, no horizontal overflow, both capability rows on one line.
- Pointer: the camera orbits on a heavy spring, the glass glint and floor pool follow, and the wordmark parallaxes opposite. Hover and focus brighten the dawn through `u_engage`. A press sends a pulse through the door.
- Modal: the panel grows from the door, the camera dollies back and the dawn dims; the loop stops once the panel has settled. Native dialog focus, Escape, backdrop dismissal and focus restoration were rechecked.
- Fallbacks were forced in a test browser: without WebGL the Canvas2D renderer projects the same door, opening, shaft and grid; without any canvas the inline still door and a CSS glow are shown and the pause control is hidden. The real in-app browser (no WebGL) uses the Canvas2D path.
- Reduced motion: no entrance, idle drift, camera motion or pulse; one composed still frame with final uniform values; the pause control is hidden. Pause stops the loop, idle drift and pulse, and resumes cleanly.
- Keyboard: tab order runs through the capabilities and contact control; focus rings are warm and visible on the dark floor.
- The WebGL1 path is a source translation of the same shader. It compiles in code review but was not exercised on hardware.

**Not yet measured on real GPUs.** SwiftShader screenshots verify the image, not the frame rate. Open the site with `?debug` on a typical laptop and phone: expect about 60 fps at a backing scale of 1.0 or more on desktop. The adaptive governor lowers resolution if frames run long.

**Live email delivery remains unverified.** Cloudflare authentication, destination verification and domain onboarding must be completed, followed by an authorized real enquiry and inbox readback. The visible website and email delivery have separate deployment states.
