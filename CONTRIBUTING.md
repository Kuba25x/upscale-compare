# Contributing

Contributions are welcome. Discuss substantial product or architecture changes in an issue before implementation. Bug fixes, accessibility improvements, image alignment improvements, and security tests are especially useful.

1. Fork the repository and create a descriptive feature branch.
2. Follow the README local setup. Use Node.js 22.12+ and `npm ci`.
3. Keep code, comments, documentation, UI strings, and commit messages in English.
4. Preserve the deliberately minimal two-state layout and the large comparison surface. Put advanced options in dialogs rather than sidebars.
5. Keep original image bytes intact. Never silently normalize resolutions or encode new JPEG/WebP copies.
6. Add meaningful regression tests for changed image coordinates, sharing behavior, security, or navigation.
7. Run `npm run build`, `npm test`, and `npm run test:e2e`. Describe actual results and any unavailable checks in the PR.
8. Update documentation and PROGRESS.md when behavior or continuation steps change.

Do not include screenshots containing private information in fixtures. Generated pixel patterns make alignment tests reproducible. Do not commit `.env`, `.dev.vars`, tokens, uploaded images, local R2/D1 data, generated builds, or private deletion keys.

Dependencies must have AGPL-compatible licenses. Prefer browser or Cloudflare platform APIs over large libraries. Keep frontend, shared schemas, and Worker concerns separate.

By contributing, you agree that your contribution is distributed under AGPL-3.0. Do not report exploitable vulnerabilities publicly; follow SECURITY.md.
