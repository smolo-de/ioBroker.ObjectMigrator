#!/usr/bin/env bash
# Sets up a minimal ioBroker for the end-to-end test (CI, Linux):
# js-controller + admin (websocket on 8081, no authentication) + history 5.2.0 + this adapter,
# in the folder .e2e next to the project. Starts the controller in the background and waits until
# admin, history and objectmigrator are alive. Usage: bash scripts/ci-e2e-setup.sh (after npm run build)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.e2e"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

cat > package.json <<'EOF'
{ "name": "objectmigrator-e2e", "version": "1.0.0", "private": true }
EOF
npm install --omit=dev --no-audit --no-fund iobroker.js-controller iobroker.admin iobroker.history@5.2.0

IOB="node node_modules/iobroker.js-controller/iobroker.js"
$IOB setup first --console

# the adapter as a copy (a symlink lets the adapter search js-controller in the project)
TARGET="node_modules/iobroker.objectmigrator"
mkdir -p "$TARGET"
for entry in build admin io-package.json package.json LICENSE README.md; do
    cp -r "$ROOT/$entry" "$TARGET/"
done
(cd "$TARGET" && npm install --omit=dev --no-audit --no-fund)

$IOB add admin --port 8081
$IOB set admin.0 --auth false
$IOB add history
$IOB add objectmigrator

node node_modules/iobroker.js-controller/controller.js > controller.log 2>&1 &
echo $! > controller.pid

alive() {
    $IOB state getplain "system.adapter.$1.alive" 2>/dev/null | grep -q true
}
for i in $(seq 1 120); do
    if alive admin.0 && alive history.0 && alive objectmigrator.0; then
        echo "ioBroker is ready"
        exit 0
    fi
    sleep 2
done
echo "ioBroker did not start in time"
tail -n 100 controller.log || true
exit 1
