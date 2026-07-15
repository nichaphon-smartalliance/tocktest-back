# Security Hardening Runbook

## Dependency Checks

- Backend CI blocks production dependency advisories at `moderate` and above.
- Frontend CI blocks `high` and `critical` production advisories. The current remaining frontend advisories are moderate and tied to `next-auth` v4's transitive `uuid` dependency.
- Review `npm audit --omit=dev` before every release and track accepted residual advisories in the release notes.

## Request Logging

- Every backend response includes `X-Request-ID`.
- Backend logs one JSON line per request with request ID, method, path, status, duration, IP, and user agent.
- Do not log request bodies, cookies, bearer tokens, GitHub tokens, or query strings.

## Database Logging

- `DB_LOGGING=false` is the default.
- Enable `DB_LOGGING=true` only on a private local machine during debugging.
- Keep SQL logging disabled in shared development, staging, and production.

## Reverse Proxy / WAF

- Put production traffic behind a reverse proxy or managed WAF.
- Enforce TLS, request body limits, connection limits, and IP-based rate limits at the edge.
- Use `deploy/nginx/tocktest.conf` as the baseline Nginx template.
- Forward `X-Request-ID`, `X-Forwarded-For`, and `X-Forwarded-Proto` to the backend.

## Release Gate

- Backend: `npm ci`, `npm audit --omit=dev --audit-level=moderate`, `npm run build`.
- Frontend: `npm ci`, `npm audit --omit=dev --audit-level=high`, `npm run type-check`, `npm run build`.
