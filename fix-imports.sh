#!/bin/bash

echo ">> Rewriting ALL v2 engine imports to correct paths..."

# Fix all imports in v2 engines to: ../../../types/v2/*
find src/engines/v2 -type f -name "*.ts" -exec \
  sed -i 's|"\.\./\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec \
  sed -i 's|"\.\./types/v2/|../../../types/v2/|g' {} \;

find src/engines/v2 -type f -name "*.ts" -exec \
  sed -i 's|"\.\./\.\./types/|../../../types/v2/|g' {} \;

# Fix SprintRules import
find src/engines/v2 -type f -name "*.ts" -exec \
  sed -i 's|"\.\./\.\./rules/SprintRules"|../../../rules/SprintRules"|g' {} \;

# Fix wrong import pointing to ../../types/Control
find src/engines/v2 -type f -name "*.ts" -exec \
  sed -i 's|"\.\./\.\./types/Control"|../../../types/v2/Control"|g' {} \;

echo ">> Fixing runEngine.ts imports..."

# Fix runEngine Control/Intake imports
sed -i 's|"../types/v2/Control"|".\/types\/v2\/Control"|g' src/runEngine.ts
sed -i 's|"../types/v2/Intake"|".\/types\/v2\/Intake"|g' src/runEngine.ts

# Fix frameworks path to always point to dist/src
sed -i 's|"frameworks/securelogic.json"|"..\/frameworks\/catalog\/securelogic_controls.json"|g' src/runEngine.ts
sed -i 's|"../frameworks/securelogic.json"| "..\/frameworks\/catalog\/securelogic_controls.json"|g' src/runEngine.ts
sed -i 's|"../frameworks/securelogic_controls.json"| "..\/frameworks\/catalog\/securelogic_controls.json"|g' src/runEngine.ts

echo ">> Import repair complete."
