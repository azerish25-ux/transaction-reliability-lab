#!/bin/sh
# Reproducible Maven bootstrap for LedgerGuard. The downloaded Apache Maven
# distribution is authenticated by the SHA-256 in maven-wrapper.properties.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROPERTIES="$ROOT/.mvn/wrapper/maven-wrapper.properties"
[ -f "$PROPERTIES" ] || { echo "Missing $PROPERTIES" >&2; exit 1; }

read_property() {
  sed -n "s/^$1=//p" "$PROPERTIES" | tail -n 1 | tr -d '\r'
}

URL=$(read_property distributionUrl)
EXPECTED=$(read_property distributionSha256Sum)
[ -n "$URL" ] && [ -n "$EXPECTED" ] || { echo "Incomplete Maven wrapper properties" >&2; exit 1; }

ARCHIVE=${URL##*/}
DIST=${ARCHIVE%-bin.zip}
CACHE=${MAVEN_USER_HOME:-"$HOME/.m2"}/wrapper/dists/$DIST/ledgerguard
MAVEN_HOME="$CACHE/$DIST"

verify() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    echo "sha256sum or shasum is required" >&2
    exit 1
  fi
  [ "$actual" = "$EXPECTED" ] || { echo "Maven distribution checksum mismatch" >&2; exit 1; }
}

if [ ! -x "$MAVEN_HOME/bin/mvn" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT HUP INT TERM
  mkdir -p "$CACHE"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error "$URL" --output "$tmp/$ARCHIVE"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$tmp/$ARCHIVE"
  else
    echo "curl or wget is required to bootstrap Maven" >&2
    exit 1
  fi
  verify "$tmp/$ARCHIVE"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$tmp/$ARCHIVE" -d "$tmp"
  else
    echo "unzip is required to bootstrap Maven" >&2
    exit 1
  fi
  rm -rf "$MAVEN_HOME"
  mv "$tmp/$DIST" "$MAVEN_HOME"
fi

exec "$MAVEN_HOME/bin/mvn" "$@"
