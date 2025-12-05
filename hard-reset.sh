#!/bin/bash
set -e

echo ">>> HARD RESET: Fixing directory tree and paths..."

# 1. Recreate final expected folders
mkdir -p src/engines/v2
mkdir -p src/types/v2
mkdir -p src/rules
mkdir -p src/frameworks/catalog

# 2. Move engines into place
if [ -d "src/engines/v2" ]; then
  mv src/engines/v2/*.ts src/engines/v2/ 2>/dev/null || true
fi

# 3. Move v2 types into place
mv types/v2/*.ts src/types/v2/ 2>/dev/null || true

# 4. Move rules/SprintRules
mv rules/SprintRules.ts src/rules/ 2>/dev/null || true

# 5. Move framework catalog
mv frameworks/catalog/securelogic_controls.json src/frameworks/catalog/ 2>/dev/null || true

echo ">>> Rewriting imports in engines..."

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec sed -i \
 's|\.\./\.\./rules/SprintRules|../../../rules/SprintRules|g' {} \;

echo ">>> Fixing runEngine.ts..."

sed -i 's|"frameworks.*json"|"..\/frameworks\/catalog\/securelogic_controls.json"|g' src/runEngine.ts
sed -i 's|\./types/v2/|../types/v2/|g' src/runEngine.ts

echo ">>> Reset complete."
