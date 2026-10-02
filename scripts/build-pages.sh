#!/bin/sh
# Builds the static site for GitHub Pages into dist/: the game page plus its two libraries.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp -R public/. dist/
rm -f dist/game.js
cp node_modules/phaser/dist/phaser.min.js dist/phaser.js
cp node_modules/mqtt/dist/mqtt.min.js dist/mqtt.min.js
touch dist/.nojekyll
echo "built dist/ ($(ls dist | wc -l | tr -d ' ') files)"
