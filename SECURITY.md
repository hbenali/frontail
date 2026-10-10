# Security policy

## Supported versions

Only the latest release receives security fixes. Please upgrade before reporting an issue you found in an older version.

| Version | Supported |
| --- | --- |
| Latest release ([npm](https://www.npmjs.com/package/@hbenali/frontail) / [Docker Hub](https://hub.docker.com/r/hbenali/frontail) / [GitHub releases](https://github.com/hbenali/frontail/releases/latest)) | yes |
| Anything older | no |

## Reporting a vulnerability

**Please don't open a public issue or pull request for a security problem.** Report it privately, either:

- through GitHub: **[Report a vulnerability](https://github.com/hbenali/frontail/security/advisories/new)** (private vulnerability reporting), or
- by email to **contact@hbenali.ovh** with the subject `frontail security`.

Include what you can of:

- the affected version (`frontail -V`) and how it is run (npm, Docker, binary; flags such as `-U/-P`, `--url-path`, a reverse proxy);
- what an attacker can do and what they need (network access, valid credentials, ...);
- steps or a proof of concept to reproduce it.

## What to expect

- an acknowledgement within **3 working days**;
- an assessment and, if it is a vulnerability, a fix plan within **10 working days**;
- a fix released as soon as it is ready and verified, with the release notes describing the problem and how to mitigate it, crediting you if you wish;
- coordinated disclosure: please keep details private until a fixed release is available.

This is a volunteer-maintained project; there is no bug bounty.

## Scope

In scope: the frontail server and web UI, the Docker image, and the release artifacts (npm package, binaries). Typical findings: authentication or authorization bypass, cross-site attacks (XSS, CSRF, cross-site WebSocket), injection (shell, ssh, HTML), path traversal through the download endpoints, denial of service from a single unauthenticated request, secrets handling.

Out of scope: issues that require an already-compromised host or the ability to run arbitrary commands as the frontail user; frontail serving logs to anyone who can reach it when **no authentication is configured** (that is how it works without `-U/-P`; see below); missing hardening that has no concrete impact; vulnerabilities in third-party dependencies with no demonstrated impact on frontail (report those upstream; Dependabot and Trivy track them here).

## Running frontail safely

frontail shows whatever it is pointed at, so treat access to it like access to those logs. At minimum:

- enable Basic Auth with `-U` and `--password-file` (not `-P`, which is visible in `ps`) and serve over HTTPS or behind a TLS-terminating reverse proxy;
- bind to loopback (`-h 127.0.0.1`) when a proxy is in front, and don't expose it to the internet without authentication;
- run it as a non-root user with read access only to the logs it needs.

The wiki's **[Security](https://github.com/hbenali/frontail/wiki/Security)** page covers authentication, HTTPS, the cross-site Origin check (`--allowed-origin`), response headers, resource limits and remote sources in detail.

## How security is checked here

CodeQL (code scanning), Trivy (dependencies, secrets, Dockerfile and image) and Dependabot run on every push and on a schedule; results are in the repository's Security tab. Releases are tagged with signed git tags.

## Past security fixes

Fixed vulnerabilities are described in the [release notes](https://github.com/hbenali/frontail/releases). Notable ones:

| Release | Issue |
| --- | --- |
| 2.35 | Log socket accepted connections that had not passed Basic Auth (high, affects installations using `-U/-P`) |
| 2.34 | Unbounded concurrent full-log reads per browser |
| 2.31 | Cross-site WebSocket access; Content-Security-Policy added |
