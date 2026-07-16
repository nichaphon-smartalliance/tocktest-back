// Tighter per-endpoint rate limits for expensive operations, overriding the
// global 120 req/min default (see AppModule ThrottlerModule config).
//
// AI/GitHub-backed endpoints are costly (external API calls, token spend), and
// endpoints that WRITE to GitHub on the user's behalf are abuse-sensitive, so
// they get progressively stricter limits.

export const THROTTLE_AI = { default: { limit: 20, ttl: 60_000 } };

export const THROTTLE_EXTERNAL_WRITE = { default: { limit: 10, ttl: 60_000 } };
