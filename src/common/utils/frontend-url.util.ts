const DEFAULT_FRONTEND_URL = 'http://localhost:4003';

/**
 * The single frontend origin to redirect OAuth / App-install callbacks back to.
 *
 * FRONTEND_URL doubles as the CORS allow-list and may hold a comma-separated
 * list (see resolveCorsOrigins in main.ts). Interpolating that raw value into a
 * redirect produces a broken location like
 * `http://a.example,http://b.example/settings`, so take the first entry.
 */
export function resolveFrontendRedirectBase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const first = (env.FRONTEND_URL ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean);

  if (!first) return DEFAULT_FRONTEND_URL;
  return first.replace(/\/+$/, '');
}
