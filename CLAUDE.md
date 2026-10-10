# frontail

Node.js app that streams log files (or `docker`/`podman` container logs, or stdin) to a browser,
`tail -F` with a UI. Fork of mthenw/frontail, published as `@hbenali/frontail`, Docker image
`hbenali/frontail`. Requires **Node >= 22.12**.

## Commands

```sh
npm test        # mocha -r should test/*.js   (starts a real server in test/socket_auth.js)
npm run lint    # eslint 10, flat config in eslint.config.js
npm run typecheck  # tsc --noEmit over index.js + lib/ (JSDoc types, checkJs); keep it at 0 errors
npm run pkg     # standalone binaries via @yao-pkg/pkg into dist/
node bin/frontail -p 9001 some.log   # run locally
```

Run `npm test`, `npm run lint` and `npm run typecheck` before committing; CI (`.github/workflows/push.yml`) runs them on Node 22 and 24.

## Layout

- `bin/frontail` -> `index.js`: wiring only. Parses options, builds the HTTP app, attaches socket.io, streams `tail` lines to clients.
- `lib/options_parser.js`: commander. Exports `(argv) => options object` (plus `args`), a fresh `Command` per call. Also loads `--config` JSON (CLI flags win; unknown keys throw).
- `lib/metrics.js`: tiny Prometheus text registry behind `--metrics` (`/metrics`, mounted after auth in `connect_builder.js`).
- `lib/origin.js`: Origin check for socket.io handshakes (CSWSH guard); `--allowed-origin` extends it.
- `lib/credentials.js`: Basic Auth credentials from flags > `--password-file` > `FRONTAIL_USER`/`FRONTAIL_PASSWORD`.
- `lib/connect_builder.js`: connect middleware (health, security headers, auth, session, static, index, downloads).
- `lib/sources.js`: pure builders for command-backed sources (`--journal`, `--journal-unit`, `--ssh`): `{ name, type, follow, read }`, with input validation (option/shell-injection safe). `index.js` resolves/validates them up front.
- `lib/tail.js`: spawns `tail -F` / container log commands, keeps a line buffer. `lib/daemonize.js`: `-d` mode.
- `lib/untildify.js`, `lib/command_exists.js`: tiny in-repo replacements for ESM-only/abandoned packages.
- `web/assets/app.js`: the whole browser UI (one file, ES5-style `var`, no build step). `web/index.html` is a template with `__TITLE__`/`__THEME__`/... placeholders.
- `preset/`: highlight and colorizing presets. `demo/`: public-demo log generator.

## Conventions and gotchas

- **Source indexing:** `fileIndex` in `read-from-start` indexes `tailer.getSources()` (containers first, then files, then journal/ssh), the same list sent as `options:sources`. The client resolves it from the selected source name.
- **Child stderr is chunked arbitrarily:** read it with `byline`, never `on('data')` + string tests, or messages split mid-line.

- **Never put the Basic Auth password in argv.** Daemon mode hands credentials to the child through env vars. Compare credentials with `crypto.timingSafeEqual` (see `safeEqual`).
- **socket.io middleware is per namespace.** `io.use()` guards only `/`; logs stream on `/<md5 of files>`, so `requireSession` is applied to that namespace too. `test/socket_auth.js` guards this; do not remove it.
- **Log-format rules see HTML-escaped text.** `ansi_up.escape_for_html` turns `"` into `&quot;`, `<`/`>`/`&` likewise, *before* `_FORMAT_RULES` run in `web/assets/app.js`. Match `&quot;`, not `"`, and test by emitting a line through `window.App` (see "log format colorizing" in `test/app.js`).
- Adding a log format: add a `{ regex, render }` entry to `_FORMAT_RULES` (specific before generic), reuse existing `log-fc-*` CSS classes, add a case to the table in `test/app.js`, list it in the README "Recognised formats".
- Module system is CommonJS. commander 15 / cookie 2 / jsdom 30 are ESM or Node-22-only, which is why `engines` is `>=22.12`; `require()` of them works on Node >= 22.12. Check `npm run pkg` still produces a working binary after bumping them.
- Tests use mocha + `should` (BDD `should`, not `expect`), sinon stubs, supertest, jsdom `new JSDOM(...)` with `runScripts: 'outside-only'` for the UI.
- Style: single quotes, `prefer-const`, `eqeqeq`; optional `catch {}` when the error is unused; attach `{ cause }` when rethrowing.
- Keep dependencies minimal; prefer a small in-repo helper over a new package.

## Security checks and GitHub config

- `.github/workflows/codeql.yml` + `.github/codeql/codeql-config.yml`: explicit CodeQL (javascript-typescript and the Actions workflows, `security-extended`, vendored files ignored). The repo's *default setup* is switched off, since advanced and default setup can't coexist.
- `.github/workflows/trivy.yml` + `.trivyignore.yaml`: Trivy fs/image reporting; exceptions need a written reason.
- `SECURITY.md`: policy and reporting (GitHub private vulnerability reporting is enabled). Issue/PR templates live in `.github/`.
- Always check open Dependabot and code-scanning alerts before and after releases.
- Socket auth: `lib/session_auth.js` requires a signed cookie AND `session.authenticated === true` in the shared store; `connect_builder.authorize()` sets that flag. Never use `cookieParser.signedCookie()` alone (it returns unsigned values unchanged).

## Releasing

1. Bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and the image tags in `README.md`; commit `chore: bump version to X.Y.Z`; push to `master`.
2. Create a **signed** tag, **without** a `v` prefix (`git tag -s 2.29 -m 2.29 && git push origin 2.29`): the tag triggers npm publish, Docker (Docker Hub + GHCR) and binary builds.
3. The tag workflow creates a **draft** release with the binaries (GitHub releases are immutable once published, so assets can't be added later). When it finishes, publish with notes: `gh release edit 2.29 --title 2.29 --notes-file notes.md --draft=false` (the `gh` token needs the `workflow` scope). Never `gh release create` (published) before the workflow attached the binaries.
4. Afterwards `Dockerfile.demo` pins the base image (`FROM hbenali/frontail:X.Y@sha256:...`); a follow-up commit bumps that pin.

`RELEASING.md` describes the same procedure.
