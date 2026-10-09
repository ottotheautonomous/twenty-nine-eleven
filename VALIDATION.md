# Verification — 9 October 2026

The immersive surface revision extends the centered cipher design across the entire viewport. Prior versions remain in Git history.

- Production frontend build: passed.
- Worker packaging dry-run: passed; not deployed.
- Backend tests: 18 passed, using stubbed email delivery. No test email sent.
- Desktop and 320×568 mobile inspected for this revision. No horizontal overflow. Both capability rows stay on one line, including Design. The existing short-screen modal behavior remains intact.
- Native dialog checks passed: first-field focus, forward/backward keyboard wrapping, Escape, close button, genuine backdrop dismissal, and focus restoration.
- Contact checks against a local fixture passed: validation, provider failure, retained draft, rate limiting, disabled pending fields, close/reopen during a pending request, confirmed success and new-message reset.
- Continuous viewport surfaces, arc rotation and travelling SVG stroke observed after entrance. The pause control stops field and glyph loops together; opening contact pauses the field, and dismissal resumes it.
- SVG pivot correction verified in the browser: animated groups compute to `transform-box: view-box` and `transform-origin: 160px 160px`, overriding Motion's injected fill-box behavior. The eleven-sector geometry and bearing have centered bounds; the rune stays centered.
- The actual in-app browser uses Canvas2D. Its six smooth shaded surfaces, continuous highlights and reading recess were visually inspected. WebGL2 compilation and renderer lifecycle were checked independently; backing resolution remains capped at 2.8 million pixels.
- Independent source review completed for animation races, reduced-motion startup and preference changes, pending requests and focus behavior. Success-reveal controls participate in live reduced-motion cleanup.
- Font assets and Motion bundled locally. No runtime third-party font requests.

**Live email delivery remains unverified.** Cloudflare authentication, destination verification and domain onboarding must be completed, followed by an authorized real enquiry and inbox readback. The visible website and email delivery have separate deployment states.
