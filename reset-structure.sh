#!/bin/bash
set -e

echo ">>> Resetting folder layout..."

mkdir -p src/types/v2
mkdir -p src/engines/v2

# Move types
mv types/v2/* src/types/v2/ 2>/dev/null || true

# Move engines
mv src/engines/v2/* src/engines/v2/ 2>/dev/null || true

echo ">>> Rewriting ALL imports in src/engines/v2..."

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./\.\./rules/SprintRules|../../../rules/SprintRules|g' {} \;

echo ">>> Fixing runEngine.ts imports..."

sed -i 's|\./types/v2/|../types/v2/|g' src/runEngine.ts

echo ">>> Fixing framework catalog path..."

sed -i 's|frameworks/securelogic|../frameworks/catalog/securelogic_controls|g' src/runEngine.ts

echo ">>> Reset complete."
