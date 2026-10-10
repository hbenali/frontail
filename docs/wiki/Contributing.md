# Contributing

## Setup

```bash
git clone https://github.com/hbenali/frontail && cd frontail
npm install
npm test        # mocha; some tests start a real server
npm run lint    # eslint 10 (flat config)
npm run typecheck  # tsc over lib/ and index.js (JSDoc types)
node bin/frontail -p 9001 some.log
```

Requires Node 22.12+. Run `npm test`, `npm run lint` and `npm run typecheck` before opening a pull request; CI runs them on Node 22 and 24.

## Architecture in one minute

- `index.js`: wiring. Parses options, builds the HTTP app, attaches socket.io, streams lines to browsers.
- `lib/options_parser.js`: commander options and `--config`. `lib/credentials.js`: Basic Auth sources.
- `lib/connect_builder.js`: middleware (health, security headers, auth, metrics, static, index, downloads).
- `lib/tail.js` + `lib/sources.js`: spawn `tail -F`, container engines, `journalctl` and `ssh`, and keep the line buffer.
- `lib/origin.js`, `lib/metrics.js`, `lib/daemonize.js`: Origin check, Prometheus registry, daemon mode.
- `web/assets/app.js`: the browser UI (one file, no build step). `web/assets/formats.js`: log-format detection and colorizing, a pure module that also runs in Node tests.

More detail and the gotchas that bit us (socket.io middleware is per namespace, rules receive HTML-escaped text, child stderr arrives in arbitrary chunks) are in [`CLAUDE.md`](https://github.com/hbenali/frontail/blob/master/CLAUDE.md).

## Adding a log format

1. Add a `{ regex, render }` entry to `_FORMAT_RULES` in `web/assets/formats.js`, specific formats before general ones. Remember rules see **escaped** text (`&quot;`, not `"`).
2. Reuse the existing `log-fc-*` CSS classes.
3. Add a case to the table in `test/app.js` (and unit tests in `test/formats.js`), and list the format in [Log formats](Log-formats) (`docs/wiki/Log-formats.md`).

## Documentation

These wiki pages live in `docs/wiki/` and are published to the wiki automatically when they change on `master`. Edit them there, in a pull request, not in the wiki UI.

## Releasing

1. Make sure `master` is green. Bump the version: `npm version X.Y.Z --no-git-tag-version`, update the image tags in the README, commit `chore: bump version to X.Y.Z`, push.
2. Create a **signed** tag **without** a `v` prefix and push it: `git tag -s X.Y -m "X.Y" && git push origin X.Y`. The tag triggers the npm publish, the Docker images (Docker Hub and GHCR) and the standalone binaries.
3. Create the GitHub release with notes, security fixes first: `gh release create X.Y --verify-tag ...`.
4. Verify: `npm view @hbenali/frontail version`, the workflow run, and the five binaries on the release.
5. Bump the base-image pin in `Dockerfile.demo` in a follow-up commit.

## Reporting issues and security problems

[Open an issue](https://github.com/hbenali/frontail/issues/new) for bugs and ideas. For vulnerabilities see [Security](Security) and [`SECURITY.md`](https://github.com/hbenali/frontail/blob/master/SECURITY.md): please report them privately, not in a public issue.
