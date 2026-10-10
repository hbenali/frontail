# Test-only image: the shipped Dockerfile only bundles the docker CLI, so
# --container-engine podman needs the podman CLI added on top just to
# exercise this scenario. Built from the published image rather than the
# local build context since this scenario tests engine plumbing, not
# whatever's currently being worked on.
FROM hbenali/frontail:2.35@sha256:926ed94b0b336c87e921235884724eb572853db2a09899bba840e249054d1fed
USER root
RUN apk add --no-cache podman
