# Backend Testing Guide

## Stack

| Tool | Version | Role |
|---|---|---|
| Jest | 29.x | Test runner |
| ts-jest | 29.x | TypeScript transform |
| @nestjs/testing | 11.x | Module factory |

## Running Tests

```bash
npm test           # run once (watch mode off)
npm run test:watch # interactive watch
npm run test:cov   # with coverage report → coverage/
npm run test:ci    # CI mode: coverage + forceExit
```

## File Convention

Co-locate spec files next to the source file they test:

```
src/common/utils/encryption.util.ts
src/common/utils/encryption.util.spec.ts   ← here
```

## Environment Variables in Tests

Never rely on `.env` files in tests. Each spec file sets the env vars it needs and cleans up:

```ts
beforeEach(() => { process.env.ENCRYPTION_KEY = 'a'.repeat(64); });
afterEach(() => { delete process.env.ENCRYPTION_KEY; });
```

## Test Patterns

### Pure utility (normalize-ai, encryption.util, pr-review.util, heuristic-ai)

No NestJS module needed. Import and call directly.

```ts
import { normalizeRiskLevel } from './normalize-ai';
it('...', () => expect(normalizeRiskLevel('HIGH')).toBe('high'));
```

### Guard / Filter / Interceptor

Instantiate directly with `jest.fn()` mocks. Build `ArgumentsHost` / `ExecutionContext` / `CallHandler` inline as `as any` objects:

```ts
const filter = new HttpExceptionFilter();
const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn().mockReturnThis() };
const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }) } as any;
filter.catch(new HttpException('Not Found', 404), host);
```

### Service (NestJS TestingModule)

```ts
const module = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: UsersService, useValue: { findByEmail: jest.fn() } },
    { provide: JwtService, useValue: { sign: jest.fn() } },
  ],
}).compile();
const service = module.get(AuthService);
```

### TypeORM repository isolation

Provide the mock repository via `getRepositoryToken`:

```ts
{ provide: getRepositoryToken(Repository), useValue: { findOne: jest.fn(), ... } }
```

Always assert that `where` clauses contain `userId` to verify data isolation.

### Passport / AuthGuard strategies

Spy on the prototype chain to avoid triggering actual passport:

```ts
const spy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true as any);
```

Restore after the test: `spy.mockRestore()`.

## Coverage

Thresholds (in `jest.config.ts`): branches 70 %, functions/lines/statements 75 %.

```bash
npm run test:cov
open coverage/lcov-report/index.html
```

## Adding New Tests

1. Create `src/path/to/feature.spec.ts` next to the source file.
2. Import the class or function under test.
3. Use the matching pattern above.
4. Run `npm test` to verify before committing.
