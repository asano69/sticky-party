#!/usr/bin/env bash

set -euo pipefail

########################################
# settings
########################################

VERSION_FILE="cmd/web-anno/main.go"
REMOTE="origin"
BRANCH="main"
COMMIT_PREFIX="release:"

########################################
# extract version
########################################

CURRENT_VERSION=$(
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+' "$VERSION_FILE" |
    head -1
)

if [[ -z "$CURRENT_VERSION" ]]; then
  echo "version not found"
  exit 1
fi

########################################
# increment beta number
########################################

BASE_VERSION="${CURRENT_VERSION%-beta.*}"
BETA_NUMBER="${CURRENT_VERSION##*.}"

NEW_BETA=$((BETA_NUMBER + 1))
NEW_VERSION="${BASE_VERSION}-beta.${NEW_BETA}"

########################################
# replace file
########################################

sed -i.bak \
  "s/${CURRENT_VERSION}/${NEW_VERSION}/g" \
  "$VERSION_FILE"

rm -f "${VERSION_FILE}.bak"

########################################
# git
########################################

git add "$VERSION_FILE"

git commit -m "${COMMIT_PREFIX} ${NEW_VERSION}"

git tag -a "v${NEW_VERSION}" \
  -m "Release ${NEW_VERSION}"

git push "$REMOTE" "$BRANCH"

git push "$REMOTE" "v${NEW_VERSION}"

echo ""
echo "released: ${NEW_VERSION}"
