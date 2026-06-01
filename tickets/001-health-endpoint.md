# Add Health Check Endpoint

## Goal

Create a lightweight API health check endpoint for the SecureLogic AI engine.

## Requirements

Create:

GET /health

Response:

{
  "status": "ok",
  "service": "securelogic-engine",
  "timestamp": "<current timestamp>"
}

## Acceptance Criteria

- Returns HTTP 200
- Returns valid JSON
- No authentication required
- No database connection required
- No secrets exposed
- Add tests if test framework exists

## Forbidden Changes

Do NOT modify:
- Authentication
- Billing
- Database schema
- Deployment configuration
- Environment variables

## Security Notes

Do not expose:
- internal infrastructure details
- database health
- environment variables
- API secrets

## Deliverable

Open a pull request with:
- summary
- files changed
- tests run
- risks identified
