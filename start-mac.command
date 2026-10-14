#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js nu este instalat. Descarca-l gratuit de pe https://nodejs.org (varianta LTS),"
  echo "  instaleaza-l, apoi porneste din nou acest fisier."
  echo ""
  open https://nodejs.org
  read -n 1 -s -r -p "Apasa orice tasta pentru a inchide..."
  exit 1
fi
node server/index.js
