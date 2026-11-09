#!/usr/bin/env bash
# Copies the static site into $1 and stamps every local asset URL with a version,
# so browsers never mix cached files from one deploy with files from another.
set -euo pipefail
OUT="$1"; V="$2"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$SRC/index.html" "$SRC/lab.html" "$SRC/test.html" "$SRC/css" "$SRC/js" "$SRC/app" "$SRC/vendor" "$OUT/"
touch "$OUT/.nojekyll"
# index.html: <link href="css/..">, <script src="js/.."|"vendor/..">, and the three.js import map entry
for f in index.html lab.html test.html; do sed -i -E "s#(href|src)=\"(css|js|vendor|app)/([^\"?]+)\"#\1=\"\2/\3?v=$V\"#g" "$OUT/$f"; done
sed -i -E "s#\"\./vendor/three\.module\.js\"#\"./vendor/three.module.js?v=$V\"#" "$OUT/index.html" "$OUT/lab.html" "$OUT/test.html"
# ES module imports between our own files
sed -i -E "s#(from '\.{1,2}/[^'?]+\.js)'#\1?v=$V'#g" "$OUT"/js/*.js "$OUT"/app/*.js "$OUT"/app/views/*.js
echo "Stamped $OUT with v=$V"
