#!/bin/sh
# Renders both corners; Blender's Metal backend occasionally crashes, so retry (finished frames are skipped).
cd "$(dirname "$0")/.."
B=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
C=idle_guard,atk_jab,atk_cross,atk_hook,block,hit_head,stagger,ko
for corner in red blue; do
  n=0
  until [ -f assets-src/build/frames_$corner/meta.json ] || [ $n -ge 8 ]; do
    $B -b --factory-startup --python scripts/render-fighters.py -- --clips $C --samples 48 --outfit $corner --out assets-src/build/frames_$corner >>/tmp/r_$corner.log 2>&1
    n=$((n+1))
  done
done
echo done > /tmp/render_done
