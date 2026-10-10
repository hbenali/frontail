# Releasing Frontail

Releases are driven by a git tag: pushing a tag makes GitHub Actions publish to npm, build and push
the Docker image (Docker Hub + GHCR) and build the standalone binaries, which are attached to a **draft**
GitHub release. Releases are **immutable** once published (assets and tag can't change afterwards), so the
workflow never publishes by itself: you wait for the draft, write the notes and publish it. Tags have **no `v` prefix**
(`2.29`, not `v2.29`).

1. Make sure `master` is up to date, clean, and CI is green.

    ```sh
    git checkout master && git pull --rebase origin master
    npm test && npm run lint
    ```

1. Bump the version and the image tags in the README, then commit and push.

    ```sh
    npm version X.Y.Z --no-git-tag-version
    sed -i 's#hbenali/frontail:<old>#hbenali/frontail:X.Y#g' README.md
    git commit -am "chore: bump version to X.Y.Z"
    git push origin master
    ```

1. Create a **signed** tag (`-s`; plain `git tag` makes an unsigned one) and push it. This triggers the publish workflow.

    ```sh
    git tag -s X.Y -m "X.Y" && git push origin X.Y
    ```

1. Wait for the workflow to finish: it creates a **draft** release with the five binaries attached.
   Then write the notes (security fixes first) and publish it. The `gh` token needs the `workflow` scope.

    ```sh
    gh release edit X.Y --title X.Y --notes-file notes.md --draft=false
    ```

1. Verify the artifacts exist: `npm view @hbenali/frontail version`, the
   Docker job, and the five binaries attached to the release.

1. Bump the base image pin in `Dockerfile.demo` (`FROM hbenali/frontail:X.Y@sha256:...`) in a
   follow-up commit.

To build binaries locally: `npm run pkg` (output in `dist/`).
