# SecureLogic Contract Change Rules

These files are PUBLIC, CLIENT-FACING contracts:

- AuditSprintResultV1
- ResultEnvelope
- Entitlements
- ResultIntegrity

Rules:
1. NO in-place breaking changes
2. Breaking change → new versioned file (V2, V3…)
3. Additive-only changes must be backward compatible
4. Old versions are never deleted

Violating these rules breaks clients and voids trust.
