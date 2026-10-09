# Verification — 9 October 2026

The centered cipher redesign replaces the first ivory layout. The previous source remains in Git history.

- Production frontend build: passed.
- Worker packaging dry-run: passed; not deployed.
- Backend tests: 18 passed, using stubbed email delivery. No test email sent.
- Desktop, 320×568 mobile and 390×500 short viewport inspected. No horizontal overflow. The services stay on one line; the modal scrolls internally on short screens.
- Native dialog checks passed: first-field focus, forward/backward keyboard wrapping, Escape, close button, genuine backdrop dismissal, and focus restoration.
- Contact checks against a local fixture passed: validation, provider failure, retained draft, rate limiting, disabled pending fields, close/reopen during a pending request, confirmed success and new-message reset.
- Continuous arc rotation and travelling SVG stroke observed after entrance. Pause stops both; opening the modal pauses ambient motion.
- Independent source review completed for animation races, reduced-motion startup and preference changes, pending requests and focus behavior. Success-reveal controls participate in live reduced-motion cleanup.
- Font assets and Motion bundled locally. No runtime third-party font requests.

**Live email delivery remains unverified.** Cloudflare authentication, destination verification and domain onboarding must be completed, followed by an authorized real enquiry and inbox readback. The visible website and email delivery have separate deployment states.
