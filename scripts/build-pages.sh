#!/bin/sh
# Builds the static site for GitHub Pages into dist/: the game page plus its two libraries.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp -R public/. dist/
rm -f dist/game.js
cp node_modules/phaser/dist/phaser.min.js dist/phaser.js
cp node_modules/mqtt/dist/mqtt.min.js dist/mqtt.min.js
# The landing page, guide and docs at /guide/ (site/index.html is a page body; wrap it in a full document).
mkdir -p dist/guide
{ printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  cat site/index.html
  printf '\n</body>\n</html>\n'; } > dist/guide/index.html
touch dist/.nojekyll
echo "built dist/ ($(ls dist | wc -l | tr -d ' ') files)"
