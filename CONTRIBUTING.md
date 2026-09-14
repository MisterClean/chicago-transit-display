# Contributing

Welcome. Small, focused pull requests are easiest to review. Include the user-visible problem, the resulting behavior, and the checks you ran.

Use Node 22.12+ and current stable Rust. Follow the quick start in README.md. Run the frontend build/tests and Rust format/clippy/tests before submitting; CI also runs browser tests.

Keep provider formats inside Rust adapters and validate JSON at the browser boundary. Never turn unknown counts into zero, stale observations into fresh observations, an absent prediction into “on time,” or demo data into a live fallback. Scope provider failures to their own cards. Keep map content available in a keyboard-accessible list.

New feeds need documented terms/attribution, bounded requests, freshness/expiry rules, and representative sanitized fixtures. Include tests for malformed and partial data. Do not add an operator merely because a public URL exists. Never commit credentials or location histories, and do not load-test public provider APIs.

Configuration changes need a deliberate version/migration decision. Shared links are public copies; don't add private labels, raw addresses, or secrets to them. UI changes should be checked at 1920×1080 and 1080×1920 and with keyboard navigation/reduced motion. Add meaningful behavioral tests for new failure modes.

The original product specification is a proposal. Discuss changes that introduce accounts, server-side board persistence, new externally hosted services, or a different licensing model before expanding the MVP.
