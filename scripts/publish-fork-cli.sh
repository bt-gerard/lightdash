#!/usr/bin/env bash
# Publish the fork CLI (@lightdash/cli + @lightdash/common + @lightdash/warehouses)
# to the lightdash-npm Artifact Registry repo. See FORK.md "Publishing the CLI".
#
# Usage: scripts/publish-fork-cli.sh <lod-suffix>
#   scripts/publish-fork-cli.sh 1   ->  2.203.0-lod.1
#
# Needs: clean tree, Node from .nvmrc, gcloud login with artifactregistry.writer
# on playvalve-data-dev. Versions are immutable: a rebuild needs a new suffix.
set -euo pipefail

REGISTRY="https://us-east1-npm.pkg.dev/playvalve-data-dev/lightdash-npm/"
PACKAGE_JSONS=(
    packages/common/package.json
    packages/warehouses/package.json
    packages/cli/package.json
)

suffix="${1:?usage: $0 <lod-suffix>}"
cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet HEAD; then
    echo "Working tree is not clean; commit or stash first." >&2
    exit 1
fi

want_node="$(cut -d. -f1 .nvmrc)"
have_node="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$want_node" != "$have_node" ]]; then
    echo "Node $have_node is active but .nvmrc wants $want_node (run: fnm use)." >&2
    exit 1
fi

base="$(node -p "require('./packages/cli/package.json').version")"
base="${base%%-*}"
version="${base}-lod.${suffix}"
tag="cli-${version}"

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    echo "Tag ${tag} already exists; pick a new suffix." >&2
    exit 1
fi

workdir="$(mktemp -d)"
npmrc="${workdir}/.npmrc"
cleanup() {
    # Local pnpm may also stamp packageManagerDependencies into the lockfile.
    git checkout -- "${PACKAGE_JSONS[@]}" pnpm-lock.yaml
    rm -rf "$workdir"
}
trap cleanup EXIT

echo "==> Auth to ${REGISTRY}"
printf '@lightdash:registry=%s\n' "$REGISTRY" >"$npmrc"
npx -y google-artifactregistry-auth --repo-config="$npmrc" --credential-config="$npmrc" >/dev/null

echo "==> Version ${version}"
for pj in "${PACKAGE_JSONS[@]}"; do
    (cd "$(dirname "$pj")" && npm pkg set version="$version")
done

echo "==> Build"
CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile
pnpm common-build
pnpm warehouses-build
pnpm cli-build

echo "==> Publish"
# pnpm rewrites workspace:* to the exact version in the published manifests.
NPM_CONFIG_USERCONFIG="$npmrc" pnpm \
    --filter @lightdash/common \
    --filter @lightdash/warehouses \
    --filter @lightdash/cli \
    publish --no-git-checks --tag latest

echo "==> Verify install from the registry"
mkdir "${workdir}/verify"
(
    cd "${workdir}/verify"
    cp "$npmrc" .npmrc
    npm init -y >/dev/null
    npm install --no-audit --no-fund "@lightdash/cli@${version}" >/dev/null
    got="$(npx lightdash --version | head -1)"
    common="$(node -p "require('@lightdash/common/package.json').version")"
    [[ "$got" == "$version" ]] || { echo "CLI reports ${got}, want ${version}" >&2; exit 1; }
    [[ "$common" == "$version" ]] || { echo "common is ${common}, want ${version}" >&2; exit 1; }
    grep -rqs ignoreDimensions node_modules/@lightdash/common/dist \
        || { echo "ignoreDimensions missing from @lightdash/common" >&2; exit 1; }
)

echo "==> Tag ${tag}"
git tag -a "$tag" -m "Fork CLI ${version}"
git push origin "$tag"

echo "Published @lightdash/cli@${version} (+ common, warehouses)."
