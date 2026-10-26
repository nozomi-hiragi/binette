#!/usr/bin/env bash
# 依存の順に公開する。レジストリが E404 か空を返したときだけ「未公開」とみなす。
set -euo pipefail

PACKAGES=(
  "packages/core:@binette/core"
  "packages/regie:@binette/regie"
  "packages/scene:@binette/scene"
  "packages/coulisses:@binette/coulisses"
  "packages/replique:@binette/replique"
)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

for entry in "${PACKAGES[@]}"; do
  dir="${entry%%:*}"
  name="${entry##*:}"
  pkg_dir="$ROOT/$dir"
  version="$(node -p 'require(process.argv[1]).version' "$pkg_dir/package.json")"

  if npm view "$name@$version" version --json --registry=https://registry.npmjs.org >"$TEMP_DIR/result" 2>"$TEMP_DIR/error"; then
    published="$(node -e '
      const text = require("node:fs").readFileSync(process.argv[1], "utf8").trim();
      if (text) {
        const version = JSON.parse(text);
        if (typeof version !== "string") throw new Error("Unexpected npm view response");
        process.stdout.write(version);
      }
    ' "$TEMP_DIR/result")"
    if [[ "$published" == "$version" ]]; then
      echo "Skipping $name@$version (already published)"
      continue
    fi
    if [[ -n "$published" ]]; then
      echo "Unexpected registry version for $name@$version: $published" >&2
      exit 1
    fi
  else
    # 認証やレート制限、通信の失敗は「未公開」として扱わない
    code="$(node -e '
      try {
        const result = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write(String(result.error?.code ?? ""));
      } catch { process.stdout.write(""); }
    ' "$TEMP_DIR/result")"
    if [[ "$code" != "E404" ]]; then
      cat "$TEMP_DIR/result" "$TEMP_DIR/error" >&2
      echo "Cannot determine whether $name@$version exists; stopping" >&2
      exit 1
    fi
  fi

  echo "Publishing $name@$version..."
  npm publish --provenance --access public "$pkg_dir"
  echo "Published $name@$version"
done
