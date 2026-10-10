# Contributing to frontail

Thanks for helping. Bug reports, log-format samples, documentation fixes and code are all welcome.

## Before you start

- **Found a bug or want a feature?** [Open an issue](https://github.com/hbenali/frontail/issues/new/choose) using the template. For "no logs show up" and proxy problems, check the [Troubleshooting page](https://github.com/hbenali/frontail/wiki/Troubleshooting) first.
- **Security problem?** Don't open an issue or PR; follow [SECURITY.md](SECURITY.md).
- **Larger change?** Open an issue first so we can agree on the approach before you invest time.

## Development setup

```bash
git clone https://github.com/hbenali/frontail && cd frontail
npm install           # Node 22.12+ (see .nvmrc)
npm test              # mocha; some tests start a real server
npm run lint          # eslint
npm run typecheck     # tsc over lib/ and index.js (JSDoc types)
node bin/frontail -p 9001 some.log
```

All three checks must pass; CI runs them on Node 22 and 24. The architecture, conventions and the gotchas that have bitten us are in [CLAUDE.md](CLAUDE.md) and the wiki's [Contributing page](https://github.com/hbenali/frontail/wiki/Contributing).

## Making a change

1. Branch from `master`; keep the change focused.
2. Add or update tests. A new log format needs a case in `test/app.js` and unit tests in `test/formats.js`.
3. Update the docs in [`docs/wiki/`](docs/wiki) (published to the wiki automatically) and the README if options changed. Don't edit the wiki UI directly: it is overwritten.
4. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`; `fix(security):` for security fixes), with the reason in the body.
5. Open a pull request and fill in the template. Maintainers sign release tags; signed commits are appreciated but not required.

## Principles

- **Secure by default.** Nothing may make logs readable without the configured authentication; credentials never go on the command line when avoidable; anything that reaches a shell or `ssh` is validated.
- **Few dependencies.** Prefer a small in-repo helper to a new package.
- **Tests for security behaviour.** Fixes for auth, injection or resource limits come with a regression test that fails without the fix.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## License

Contributions are accepted under the project's [MIT license](LICENSE).
