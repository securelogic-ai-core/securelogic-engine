# Signal Contract

A Signal represents a normalized, time-qualified risk-relevant event.

Signals are:
- Source-agnostic
- Immutable after qualification
- Designed to feed multiple downstream services (newsletter, alerts, scoring, audits)

Status lifecycle:
RAW -> QUALIFIED | DISCARDED
