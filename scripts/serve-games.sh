#!/bin/sh
# Builds and serves the web games with playtest logging, bound to the LAN so the iPad can reach them.
# Factor Slicer, Bond Swap and Scripture Timeline code lives in pettigrew-lab; each repo's playtest-log worktree copies it into www/.
# Stop with Ctrl-C.
set -e
WS="/Users/joelpettigrew/Claude Code"
CACHE="$WS/playtest-watcher/recordings/.games"
mkdir -p "$CACHE"
git -C "$WS/pettigrew-lab" fetch -q origin

extract() { # name ref
  rm -rf "$CACHE/$1"
  git -C "$WS/pettigrew-lab" archive "$2" "docs/superpowers/prototypes/$1" | tar -x -C "$CACHE"
  rm -rf "$CACHE/$1" && mv "$CACHE/docs/superpowers/prototypes/$1" "$CACHE/$1" && rm -rf "$CACHE/docs"
}
extract factor-slicer origin/main
extract bond-swap origin/claude/bond-swap
extract bom-timeline origin/claude/bom-timeline-round3 # origin/main once PettigrewLab#404 merges

(cd "$WS/factor-slicer/.claude/worktrees/playtest-log" && PROTOTYPE_DIR="$CACHE/factor-slicer" npm run -s prototype)
(cd "$WS/bond-swap/.claude/worktrees/playtest-log" && PROTOTYPE_DIR="$CACHE/bond-swap" npm run -s prototype)
(cd "$WS/current-cut/.claude/worktrees/playtest-log" && mkdir -p build/web && godot --headless --path game --export-release "Web" ../build/web/index.html >/dev/null 2>&1)

trap 'kill 0' INT TERM
(cd "$WS/factor-slicer/.claude/worktrees/playtest-log/www" && python3 -m http.server 3057 --bind 0.0.0.0 >/dev/null 2>&1) &
(cd "$WS/bond-swap/.claude/worktrees/playtest-log/www" && python3 -m http.server 3050 --bind 0.0.0.0 >/dev/null 2>&1) &
(cd "$WS/current-cut/.claude/worktrees/playtest-log/build/web" && python3 -m http.server 3059 --bind 0.0.0.0 >/dev/null 2>&1) &
(cd "$CACHE/bom-timeline" && python3 -m http.server 3063 --bind 0.0.0.0 >/dev/null 2>&1) &
(cd "$WS/hoard-keeper/.claude/worktrees/playtest-log-b9" && npx vite --host 0.0.0.0 >/dev/null 2>&1) &
IP=$(ipconfig getifaddr en0 || echo localhost)
echo "Factor Slicer  http://$IP:3057/"
echo "Bond Swap      http://$IP:3050/index.html"
echo "Hoard Keeper   http://$IP:3054/"
echo "Scripture Timeline  http://$IP:3063/index.html"
echo "Current Cut    http://$IP:3059/index.html  (iPad)"
echo "Current Cut    laptop: cd \"$WS/current-cut/.claude/worktrees/playtest-log\" && godot --path game -- --playtest=<id> --pw=http://localhost:3058"
wait
