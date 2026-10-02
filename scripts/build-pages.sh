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
cp public/art.js dist/guide/art.js
# Three.js for the 2.5D preview (3d.html): the core build plus the addons it imports.
mkdir -p dist/vendor/three/build dist/vendor/three/examples/jsm
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js dist/vendor/three/build/
for d in loaders postprocessing shaders utils; do cp -R node_modules/three/examples/jsm/$d dist/vendor/three/examples/jsm/; done
touch dist/.nojekyll
echo "built dist/ ($(ls dist | wc -l | tr -d ' ') files)"
