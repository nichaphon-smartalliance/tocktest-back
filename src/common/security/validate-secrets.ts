/**
 * Startup guard against weak / placeholder secrets.
 *
 * The repo ships example env files with placeholder secrets. If any of those
 * ever reach a real environment, JWT forgery becomes trivial (the value is
 * public knowledge). This fails fast in production and warns loudly in dev.
 */

// Substrings that mark a value as a shipped placeholder rather than a real secret.
const PLACEHOLDER_MARKERS = [
  'change-in-production',
  'your-secret-key',
  'min-32-chars',
];

interface SecretRule {
  name: string;
  value: string | undefined;
  /** Minimum acceptable length. */
  minLength: number;
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export function validateSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const isProd = env.NODE_ENV === 'production';

  const rules: SecretRule[] = [
    { name: 'JWT_SECRET', value: env.JWT_SECRET, minLength: 32 },
    { name: 'ENCRYPTION_KEY', value: env.ENCRYPTION_KEY, minLength: 64 },
  ];

  const problems: string[] = [];
  for (const rule of rules) {
    if (!rule.value) {
      problems.push(`${rule.name} is not set`);
      continue;
    }
    if (rule.value.length < rule.minLength) {
      problems.push(`${rule.name} is too short (min ${rule.minLength} chars)`);
    }
    if (isPlaceholder(rule.value)) {
      problems.push(`${rule.name} is still a shipped placeholder value`);
    }
  }

  if (problems.length === 0) return;

  const message = `Insecure secret configuration:\n  - ${problems.join('\n  - ')}`;
  if (isProd) {
    // Never boot a production instance with forgeable secrets.
    throw new Error(message);
  }
  console.warn(`\n⚠️  ${message}\n   (fatal in production — set strong per-environment secrets)\n`);
}
