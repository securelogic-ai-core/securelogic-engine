# AGENTS.md

## Purpose

This repository supports development of the SecureLogic AI platform.

AI coding agents may assist with implementation tasks, but must follow all engineering, security, architecture, and deployment rules defined in this document.

The objective is controlled, reviewable, production-grade development.

---

# Core Engineering Rules

1. Never commit directly to `main`.
2. Always create a feature branch for every task.
3. Never deploy directly to production.
4. Every code change must be tied to a documented ticket or issue.
5. Every pull request must include:
   - Summary
   - Files changed
   - Risks introduced
   - Tests performed
   - Remaining concerns or blockers
6. Preserve existing architecture unless the task explicitly authorizes refactoring.
7. Do not introduce new dependencies without justification in the PR notes.
8. Keep solutions simple and maintainable.

---

# Security Rules

1. Never expose secrets or environment variables.
2. Never hardcode credentials.
3. Validate all user input.
4. Follow least privilege principles.

---

# Testing Requirements

- Run tests before opening PRs.
- Do not mark work complete if tests fail.

---

# AI Workflow

1. Read assigned ticket.
2. Create feature branch.
3. Implement requested changes only.
4. Run tests.
5. Open PR.
6. Human reviews and approves.

If unsure, stop and document assumptions instead of guessing.
