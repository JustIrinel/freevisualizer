#!/bin/sh
# Regenerates server/ofl-snapshot.json: the list of Open Fixture Library
# fixtures shipped with the app, so search works before the first download.
set -e
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/OpenLightingProject/open-fixture-library.git "$tmp/ofl"
cd "$tmp/ofl"
git ls-tree -r --name-only HEAD fixtures | grep -E '^fixtures/[^/]+/[^/]+\.json$' | grep -v manufacturers.json > "$tmp/keys.txt"
git show HEAD:fixtures/manufacturers.json > "$tmp/manufacturers.json"
cd - > /dev/null
node -e '
const fs = require("fs");
const [keysFile, mansFile, out] = process.argv.slice(1);
const keys = fs.readFileSync(keysFile, "utf8").split("\n").filter(Boolean).map((p) => p.slice("fixtures/".length, -".json".length));
const mans = JSON.parse(fs.readFileSync(mansFile, "utf8"));
const manufacturers = Object.fromEntries(Object.entries(mans).filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, { name: v.name }]));
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), keys, manufacturers }));
console.log(`${keys.length} fixtures, ${Object.keys(manufacturers).length} manufacturers -> ${out}`);
' "$tmp/keys.txt" "$tmp/manufacturers.json" server/ofl-snapshot.json
