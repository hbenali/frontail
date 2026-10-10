# Releasing Frontail

Releases are driven by a git tag: pushing a tag makes GitHub Actions publish to npm, build and push
the Docker image (Docker Hub + GHCR) and build the standalone binaries. Tags have **no `v` prefix**
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

1. Create the GitHub release (the `gh` token needs the `workflow` scope), with notes that call out
   security fixes first.

    ```sh
    gh release create X.Y --verify-tag --title X.Y --notes "..."
    ```

1. Verify the workflow finished and the artifacts exist: `npm view @hbenali/frontail version`, the
   Docker job, and the five binaries attached to the release.

1. Bump the base image pin in `Dockerfile.demo` (`FROM hbenali/frontail:X.Y@sha256:...`) in a
   follow-up commit.

To build binaries locally: `npm run pkg` (output in `dist/`).
