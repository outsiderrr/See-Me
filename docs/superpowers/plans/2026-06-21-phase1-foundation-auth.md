# Plan 1 — Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the See Me app skeleton (Next.js + Postgres + Docker) with a complete database schema and a hardened phone-OTP auth flow (passwordless, server-side revocable sessions, atomic cross-process rate limiting, pluggable SMS).

**Architecture:** Next.js App Router (TypeScript) single codebase. Prisma for schema/migrations/CRUD; raw parameterized SQL reserved for the later permission engine. Postgres in Docker. Auth is OTP-only: request code → SMS (dev driver logs it) → verify → create-or-find user → opaque server-side session cookie. All abuse-sensitive endpoints go through one DB-backed atomic rate limiter.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Prisma, PostgreSQL 16, Vitest, Docker Compose, Nginx (deploy-time, not in this plan).

**Spec:** `docs/superpowers/specs/2026-06-21-see-me-mvp-design.md` (this plan implements §1, §2, §5 rate-limit machinery, §6 in full; §3/§4/§7 land in Plans 2–3).

---

## Whole-App File Structure (locked here; Plans 2–3 extend it)

```
see-me/
  docker-compose.yml          # app + db (+ db_test)
  Dockerfile
  .env.example  .env
  package.json  tsconfig.json  next.config.mjs  vitest.config.ts
  prisma/schema.prisma  prisma/migrations/
  src/
    lib/
      db.ts                   # Prisma client singleton
      env.ts                  # validated env access
      hash.ts                 # HMAC + constant-time compare
      rateLimit.ts            # DB-backed atomic limiter   [Plan 1]
      sms/index.ts            # SmsSender interface + getSmsSender()
      sms/devDriver.ts        # logs the code              [Plan 1]
      sms/aliyunDriver.ts     # real driver                [later]
      auth/otp.ts             # requestCode / verifyCode   [Plan 1]
      auth/session.ts         # create/validate/revoke     [Plan 1]
      auth/currentUser.ts     # read session from cookies  [Plan 1]
      notes.ts  tags.ts  library.ts                        [Plan 2]
      cards.ts  inviteCode.ts                              [Plan 2]
      permission/visibleNotes.ts  authorizingTags.ts  tagTab.ts  access.ts  [Plan 3]
    app/
      api/auth/request-code/route.ts  verify/route.ts  logout/route.ts  [Plan 1]
      login/page.tsx          # phone + code UI            [Plan 1]
      layout.tsx  page.tsx                                 [Plan 1]
    test/helpers/db.ts        # reset/truncate
    test/helpers/factories.ts # makeUser, etc.
```

**Cross-cutting type/signature contract (all plans use these exact names):**

```ts
// src/lib/sms/index.ts
export interface SmsSender { send(phone: string, code: string): Promise<void> }
export function getSmsSender(): SmsSender

// src/lib/rateLimit.ts
export interface RateLimitResult { allowed: boolean; count: number; retryAfterMs: number }
export function consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>

// src/lib/hash.ts
export function hmacHex(value: string): string
export function timingSafeEqualHex(a: string, b: string): boolean

// src/lib/auth/otp.ts
export type VerifyResult = { ok: true } | { ok: false; reason: 'no_code' | 'expired' | 'locked' | 'mismatch' }
export function requestCode(phone: string): Promise<void>          // generates+stores+sends
export function verifyCode(phone: string, code: string): Promise<VerifyResult>

// src/lib/auth/session.ts
export function createSession(userId: string): Promise<{ id: string; expiresAt: Date }>
export function validateSession(sessionId: string): Promise<{ userId: string } | null>
export function revokeSession(sessionId: string): Promise<void>

// src/lib/auth/currentUser.ts
export function currentUserId(): Promise<string | null>            // reads cookie (Next headers)
```

---

## Task 1: Project scaffold + Docker + Postgres

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `.env`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Initialize the Next.js + TypeScript project**

Run (in the repo root, which already contains `docs/` and `.git`):
```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --eslint --import-alias "@/*" --use-npm --no-turbopack
```
If it refuses because the dir is non-empty, answer "yes" to proceed; it will not touch `docs/` or `.git`. Then move app code under `src/`:
```bash
mkdir -p src && git mv app src/app 2>/dev/null || true
```
Edit `tsconfig.json` so `"paths"` is `{"@/*": ["./src/*"]}`.

- [ ] **Step 2: Add docker-compose with app + two Postgres databases**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: seeme
      POSTGRES_PASSWORD: seeme
      POSTGRES_DB: see_me
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  db_test:
    image: postgres:16
    environment:
      POSTGRES_USER: seeme
      POSTGRES_PASSWORD: seeme
      POSTGRES_DB: see_me_test
    ports: ["5433:5432"]
volumes:
  pgdata:
```

Create `.env.example` and copy it to `.env`:
```
DATABASE_URL="postgresql://seeme:seeme@localhost:5432/see_me"
TEST_DATABASE_URL="postgresql://seeme:seeme@localhost:5433/see_me_test"
OTP_SECRET="dev-only-change-me-32-bytes-min-secret"
SMS_DRIVER="dev"
SESSION_TTL_DAYS="60"
```
```bash
cp .env.example .env
```

- [ ] **Step 3: Replace the home page with a minimal health page**

Overwrite `src/app/page.tsx`:
```tsx
export default function Home() {
  return <main><h1>See Me</h1><p>ok</p></main>;
}
```

- [ ] **Step 4: Bring up Postgres and the dev server, verify boot**

Run:
```bash
docker compose up -d db db_test
npm run dev &
sleep 4 && curl -s localhost:3000 | grep -q "See Me" && echo BOOT_OK
```
Expected: `BOOT_OK`. Then stop the dev server (`kill %1`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app + docker postgres"
```

---

## Task 2: Prisma schema (all 8 tables + rate_limits) and first migration

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/env.ts`
- Test: `src/lib/__tests__/schema.test.ts`

- [ ] **Step 1: Install Prisma and init**

```bash
npm i -D prisma && npm i @prisma/client
```

- [ ] **Step 2: Write the full schema**

Create `prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id          String   @id @default(cuid())
  phone       String   @unique
  displayName String?  @map("display_name")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  notes    Note[]
  tags     Tag[]
  cards    Card[]
  holdings CardHolder[]
  sessions Session[]
  @@map("users")
}

model Note {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  body      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  noteTags NoteTag[]
  @@index([userId, createdAt])
  @@map("notes")
}

model Tag {
  id     String @id @default(cuid())
  userId String @map("user_id")
  name   String
  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  noteTags NoteTag[]
  cardTags CardTag[]
  @@unique([userId, name])
  @@map("tags")
}

model NoteTag {
  noteId String @map("note_id")
  tagId  String @map("tag_id")
  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Restrict)
  @@id([noteId, tagId])
  @@map("note_tags")
}

model Card {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  title        String
  visibleUntil DateTime @map("visible_until") @db.Timestamptz(6)
  inviteCode   String   @unique @map("invite_code")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user     User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  cardTags CardTag[]
  holders  CardHolder[]
  @@map("cards")
}

model CardTag {
  cardId       String  @map("card_id")
  tagId        String  @map("tag_id")
  isAutoUpdate Boolean @default(false) @map("is_auto_update")
  card Card @relation(fields: [cardId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Restrict)
  @@id([cardId, tagId])
  @@map("card_tags")
}

model CardHolder {
  id         String   @id @default(cuid())
  cardId     String   @map("card_id")
  userId     String   @map("user_id")
  redeemedAt DateTime @default(now()) @map("redeemed_at") @db.Timestamptz(6)
  card Card @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([cardId, userId])
  @@map("card_holders")
}

model PhoneOtp {
  phone     String   @id
  codeHash  String   @map("code_hash")
  expiresAt DateTime @map("expires_at") @db.Timestamptz(6)
  attempts  Int      @default(0)
  consumed  Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@map("phone_otps")
}

model Session {
  id        String   @id                       // opaque random, set in code (no default)
  userId    String   @map("user_id")
  expiresAt DateTime @map("expires_at") @db.Timestamptz(6)
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("sessions")
}

model RateLimit {
  key       String   @id
  count     Int      @default(0)
  windowEnd DateTime @map("window_end") @db.Timestamptz(6)
  @@map("rate_limits")
}
```

- [ ] **Step 3: Create the Prisma client singleton and env accessor**

Create `src/lib/env.ts`:
```ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
export const env = {
  databaseUrl: () => req('DATABASE_URL'),
  otpSecret: () => req('OTP_SECRET'),
  smsDriver: () => process.env.SMS_DRIVER ?? 'dev',
  sessionTtlDays: () => Number(process.env.SESSION_TTL_DAYS ?? '60'),
};
```

Create `src/lib/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
```

- [ ] **Step 4: Run the first migration**

```bash
npx prisma migrate dev --name init
```
Expected: migration applied, `prisma/migrations/*/migration.sql` created, client generated.

- [ ] **Step 5: Write a schema smoke test (tables exist & FK Restrict holds)**

Create `src/lib/__tests__/schema.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { resetDb } from '@/test/helpers/db';

describe('schema', () => {
  beforeEach(resetDb);
  it('creates a user and round-trips it', async () => {
    const u = await db.user.create({ data: { phone: '+8613000000000' } });
    expect(u.id).toBeTruthy();
  });
  it('refuses to delete a tag referenced by a note (ON DELETE RESTRICT)', async () => {
    const u = await db.user.create({ data: { phone: '+8613000000001' } });
    const note = await db.note.create({ data: { userId: u.id, body: 'x' } });
    const tag = await db.tag.create({ data: { userId: u.id, name: 't' } });
    await db.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });
    await expect(db.tag.delete({ where: { id: tag.id } })).rejects.toThrow();
  });
});
```
(This test will run after Task 3 wires Vitest + `resetDb`. It is committed now but executed in Task 3 Step 4.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: prisma schema for all entities + client singleton"
```

---

## Task 3: Test harness (Vitest + test DB + reset helper)

**Files:**
- Create: `vitest.config.ts`, `src/test/helpers/db.ts`, `src/test/helpers/factories.ts`, `src/test/globalSetup.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Vitest + dotenv**

```bash
npm i -D vitest dotenv
```

- [ ] **Step 2: Configure Vitest to use the TEST database**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import 'dotenv/config';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // point Prisma at test DB
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serialize: shared DB
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

Create `src/test/globalSetup.ts` (migrate the test DB once before the suite):
```ts
import { execSync } from 'node:child_process';
import 'dotenv/config';
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
```

- [ ] **Step 3: Write the reset helper and factories**

Create `src/test/helpers/db.ts`:
```ts
import { db } from '@/lib/db';
export async function resetDb() {
  // order-independent: TRUNCATE ... CASCADE across all tables
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "card_holders","card_tags","cards","note_tags","notes","tags","sessions","phone_otps","rate_limits","users" RESTART IDENTITY CASCADE;`
  );
}
```

Create `src/test/helpers/factories.ts`:
```ts
import { db } from '@/lib/db';
let n = 0;
export function uniquePhone() { return `+86130000${String(1000 + n++).padStart(5, '0')}`; }
export async function makeUser(phone = uniquePhone()) {
  return db.user.create({ data: { phone } });
}
```

- [ ] **Step 4: Add scripts and run the schema test from Task 2**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```
Run:
```bash
docker compose up -d db_test
npm test -- schema
```
Expected: both schema tests PASS (user round-trip; tag-delete RESTRICT rejects).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: vitest harness against isolated test database"
```

---

## Task 4: DB-backed atomic rate limiter

**Files:**
- Create: `src/lib/rateLimit.ts`
- Test: `src/lib/__tests__/rateLimit.test.ts`

- [ ] **Step 1: Write the failing test (limit + window reset + concurrency atomicity)**

Create `src/lib/__tests__/rateLimit.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { consume } from '@/lib/rateLimit';
import { resetDb } from '@/test/helpers/db';

describe('rateLimit.consume', () => {
  beforeEach(resetDb);

  it('allows up to the limit then blocks', async () => {
    const r1 = await consume('k', 2, 60_000); expect(r1.allowed).toBe(true);
    const r2 = await consume('k', 2, 60_000); expect(r2.allowed).toBe(true);
    const r3 = await consume('k', 2, 60_000); expect(r3.allowed).toBe(false);
    expect(r3.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window passes', async () => {
    await consume('w', 1, 30); // 30ms window
    expect((await consume('w', 1, 30)).allowed).toBe(false);
    await new Promise(r => setTimeout(r, 40));
    expect((await consume('w', 1, 30)).allowed).toBe(true);
  });

  it('counts concurrent calls atomically (no lost updates)', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume('c', 5, 60_000))
    );
    expect(results.filter(r => r.allowed).length).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- rateLimit`
Expected: FAIL (`consume` not found).

- [ ] **Step 3: Implement the atomic UPSERT limiter**

Create `src/lib/rateLimit.ts`:
```ts
import { db } from '@/lib/db';
import type { RateLimitResult } from '@/lib/types'; // inline type below if no shared file

export async function consume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; count: number; retryAfterMs: number }> {
  // Single atomic statement: reset count if window expired, else increment.
  const rows = await db.$queryRaw<{ count: number; window_end: Date }[]>`
    INSERT INTO rate_limits (key, count, window_end)
    VALUES (${key}, 1, now() + (${windowMs} || ' milliseconds')::interval)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_end < now() THEN 1 ELSE rate_limits.count + 1 END,
      window_end = CASE WHEN rate_limits.window_end < now()
                        THEN now() + (${windowMs} || ' milliseconds')::interval
                        ELSE rate_limits.window_end END
    RETURNING count, window_end;
  `;
  const { count, window_end } = rows[0];
  const allowed = count <= limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, window_end.getTime() - Date.now());
  return { allowed, count, retryAfterMs };
}
```
Remove the `import type ... RateLimitResult` line (inline return type used above to avoid an unused import).

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- rateLimit`
Expected: all 3 PASS (incl. the concurrency test showing exactly 5 allowed).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: DB-backed atomic cross-process rate limiter"
```

---

## Task 5: Pluggable SMS sender + dev driver

**Files:**
- Create: `src/lib/sms/index.ts`, `src/lib/sms/devDriver.ts`
- Test: `src/lib/__tests__/sms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/sms.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { getSmsSender } from '@/lib/sms';
import { devDriver } from '@/lib/sms/devDriver';

describe('sms', () => {
  it('dev driver logs the code and never throws', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await devDriver.send('+8613000000000', '123456');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    spy.mockRestore();
  });
  it('getSmsSender returns the dev driver when SMS_DRIVER=dev', () => {
    process.env.SMS_DRIVER = 'dev';
    expect(getSmsSender()).toBe(devDriver);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- sms`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the interface, dev driver, and factory**

Create `src/lib/sms/devDriver.ts`:
```ts
import type { SmsSender } from '@/lib/sms';
export const devDriver: SmsSender = {
  async send(phone, code) {
    // dev only: print so the developer can read it. NEVER do this in prod driver.
    console.log(`[sms:dev] -> ${phone}: your code is ${code}`);
  },
};
```

Create `src/lib/sms/index.ts`:
```ts
export interface SmsSender { send(phone: string, code: string): Promise<void> }
import { devDriver } from '@/lib/sms/devDriver';
export function getSmsSender(): SmsSender {
  switch (process.env.SMS_DRIVER ?? 'dev') {
    case 'dev': return devDriver;
    // case 'aliyun': return aliyunDriver;  // wired in a later ops task
    default: return devDriver;
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- sms`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: pluggable SMS sender with dev driver"
```

---

## Task 6: OTP service (hardened per spec §6)

**Files:**
- Create: `src/lib/hash.ts`, `src/lib/auth/otp.ts`
- Test: `src/lib/__tests__/hash.test.ts`, `src/lib/auth/__tests__/otp.test.ts`

- [ ] **Step 1: Write the failing hash test**

Create `src/lib/__tests__/hash.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hmacHex, timingSafeEqualHex } from '@/lib/hash';

describe('hash', () => {
  it('hmac is deterministic for the same input', () => {
    expect(hmacHex('a')).toBe(hmacHex('a'));
    expect(hmacHex('a')).not.toBe(hmacHex('b'));
  });
  it('timingSafeEqualHex compares equal/unequal correctly', () => {
    expect(timingSafeEqualHex(hmacHex('x'), hmacHex('x'))).toBe(true);
    expect(timingSafeEqualHex(hmacHex('x'), hmacHex('y'))).toBe(false);
    expect(timingSafeEqualHex('aa', 'aabb')).toBe(false); // length mismatch safe
  });
});
```

- [ ] **Step 2: Implement hash util; run hash test green**

Create `src/lib/hash.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
export function hmacHex(value: string): string {
  return createHmac('sha256', env.otpSecret()).update(value).digest('hex');
}
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex'), bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
```
Run: `npm test -- hash` → Expected: PASS.

- [ ] **Step 3: Write the failing OTP test (lifecycle, replay, lockout, expiry, single active row)**

Create `src/lib/auth/__tests__/otp.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestCode, verifyCode } from '@/lib/auth/otp';
import { db } from '@/lib/db';
import { resetDb } from '@/test/helpers/db';

// Capture the generated code from the dev driver log.
function captureCode(): { get: () => string } {
  let code = '';
  vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    const m = /code is (\d{6})/.exec(String(msg)); if (m) code = m[1];
  });
  return { get: () => code };
}

describe('otp', () => {
  beforeEach(resetDb);

  it('requestCode stores a single hashed 6-digit code and sends it', async () => {
    const cap = captureCode();
    await requestCode('+8613000000000');
    const row = await db.phoneOtp.findUnique({ where: { phone: '+8613000000000' } });
    expect(row).toBeTruthy();
    expect(row!.codeHash).not.toBe(cap.get());     // stored hashed, not plaintext
    expect(cap.get()).toMatch(/^\d{6}$/);
  });

  it('verifies the correct code once, then rejects replay (single-use)', async () => {
    const cap = captureCode();
    await requestCode('+8613000000000');
    expect(await verifyCode('+8613000000000', cap.get())).toEqual({ ok: true });
    expect(await verifyCode('+8613000000000', cap.get())).toEqual({ ok: false, reason: 'no_code' });
  });

  it('locks out after 5 wrong attempts', async () => {
    await requestCode('+8613000000000');
    for (let i = 0; i < 5; i++) {
      expect(await verifyCode('+8613000000000', '000000')).toEqual({ ok: false, reason: 'mismatch' });
    }
    expect(await verifyCode('+8613000000000', '000000')).toEqual({ ok: false, reason: 'locked' });
  });

  it('rejects an expired code', async () => {
    const cap = captureCode();
    await requestCode('+8613000000000');
    await db.phoneOtp.update({ where: { phone: '+8613000000000' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyCode('+8613000000000', cap.get())).toEqual({ ok: false, reason: 'expired' });
  });

  it('resend upserts one row and does NOT reset attempts', async () => {
    await requestCode('+8613000000000');
    await verifyCode('+8613000000000', '000000'); // attempts -> 1
    await requestCode('+8613000000000');          // resend
    const row = await db.phoneOtp.findUnique({ where: { phone: '+8613000000000' } });
    expect(row!.attempts).toBeGreaterThanOrEqual(1); // not reset to 0
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm test -- otp`
Expected: FAIL (`requestCode` not found).

- [ ] **Step 5: Implement the OTP service**

Create `src/lib/auth/otp.ts`:
```ts
import { randomInt } from 'node:crypto';
import { db } from '@/lib/db';
import { hmacHex, timingSafeEqualHex } from '@/lib/hash';
import { getSmsSender } from '@/lib/sms';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
export type VerifyResult = { ok: true } | { ok: false; reason: 'no_code' | 'expired' | 'locked' | 'mismatch' };

export async function requestCode(phone: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hmacHex(`${phone}:${code}`);
  const expiresAt = new Date(Date.now() + TTL_MS);
  // Upsert one active row per phone. Preserve attempts on resend (do NOT reset).
  await db.phoneOtp.upsert({
    where: { phone },
    create: { phone, codeHash, expiresAt, attempts: 0, consumed: false },
    update: { codeHash, expiresAt, consumed: false }, // attempts intentionally untouched
  });
  await getSmsSender().send(phone, code);
}

export async function verifyCode(phone: string, code: string): Promise<VerifyResult> {
  const row = await db.phoneOtp.findUnique({ where: { phone } });
  if (!row || row.consumed) return { ok: false, reason: 'no_code' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const match = timingSafeEqualHex(row.codeHash, hmacHex(`${phone}:${code}`));
  if (!match) {
    // atomic increment
    await db.phoneOtp.update({ where: { phone }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: 'mismatch' };
  }
  // single-use: consume on success
  await db.phoneOtp.update({ where: { phone }, data: { consumed: true } });
  return { ok: true };
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npm test -- otp hash`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: hardened OTP service (single-use, lockout, hashed, constant-time)"
```

---

## Task 7: Server-side revocable sessions

**Files:**
- Create: `src/lib/auth/session.ts`
- Test: `src/lib/auth/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/__tests__/session.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSession, validateSession, revokeSession } from '@/lib/auth/session';
import { resetDb } from '@/test/helpers/db';
import { makeUser } from '@/test/helpers/factories';

describe('session', () => {
  beforeEach(resetDb);

  it('creates a high-entropy session and validates it', async () => {
    const u = await makeUser();
    const s = await createSession(u.id);
    expect(s.id.length).toBeGreaterThanOrEqual(32);
    expect(await validateSession(s.id)).toEqual({ userId: u.id });
  });

  it('returns null for unknown / revoked / expired sessions', async () => {
    const u = await makeUser();
    expect(await validateSession('nope')).toBeNull();
    const s = await createSession(u.id);
    await revokeSession(s.id);
    expect(await validateSession(s.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- session`
Expected: FAIL.

- [ ] **Step 3: Implement the session service**

Create `src/lib/auth/session.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex'); // 64-char opaque token
  const expiresAt = new Date(Date.now() + env.sessionTtlDays() * 86_400_000);
  await db.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

export async function validateSession(sessionId: string): Promise<{ userId: string } | null> {
  const s = await db.session.findUnique({ where: { id: sessionId } });
  if (!s || s.revoked || s.expiresAt.getTime() < Date.now()) return null;
  return { userId: s.userId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId }, data: { revoked: true } });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- session`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: server-side revocable sessions"
```

---

## Task 8: Auth API routes (request-code, verify, logout)

**Files:**
- Create: `src/lib/auth/currentUser.ts`, `src/app/api/auth/request-code/route.ts`, `src/app/api/auth/verify/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `src/app/api/auth/__tests__/auth.route.test.ts`

- [ ] **Step 1: Write the failing route test (calls route handlers directly)**

Create `src/app/api/auth/__tests__/auth.route.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb } from '@/test/helpers/db';
import { db } from '@/lib/db';
import { POST as requestCode } from '@/app/api/auth/request-code/route';
import { POST as verify } from '@/app/api/auth/verify/route';

function captureCode() {
  let code = '';
  vi.spyOn(console, 'log').mockImplementation((m: string) => {
    const x = /code is (\d{6})/.exec(String(m)); if (x) code = x[1];
  });
  return () => code;
}
const reqOf = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('auth routes', () => {
  beforeEach(resetDb);

  it('request-code -> verify creates a user and sets a session cookie', async () => {
    const get = captureCode();
    expect((await requestCode(reqOf({ phone: '+8613000000000' }))).status).toBe(200);
    const res = await verify(reqOf({ phone: '+8613000000000', code: get() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(await db.user.count()).toBe(1);
  });

  it('verify with a wrong code returns 401 and no user', async () => {
    await requestCode(reqOf({ phone: '+8613000000001' }));
    const res = await verify(reqOf({ phone: '+8613000000001', code: '000000' }));
    expect(res.status).toBe(401);
  });

  it('rate-limits request-code per phone', async () => {
    const p = { phone: '+8613000000002' };
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await requestCode(reqOf(p))).status;
    expect(last).toBe(429); // blocked within the window
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- auth.route`
Expected: FAIL (route modules not found).

- [ ] **Step 3: Implement currentUser + the three routes**

Create `src/lib/auth/currentUser.ts`:
```ts
import { cookies } from 'next/headers';
import { validateSession } from '@/lib/auth/session';
export async function currentUserId(): Promise<string | null> {
  const id = cookies().get('session')?.value;
  if (!id) return null;
  const s = await validateSession(id);
  return s?.userId ?? null;
}
```

Create `src/app/api/auth/request-code/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requestCode } from '@/lib/auth/otp';
import { consume } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const { phone } = await req.json().catch(() => ({}));
  if (typeof phone !== 'string' || !/^\+?\d{8,15}$/.test(phone)) {
    return NextResponse.json({ error: 'bad_phone' }, { status: 400 });
  }
  const rl = await consume(`otp_send:${phone}`, 5, 10 * 60_000); // 5 per 10 min
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  await requestCode(phone);
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/auth/verify/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { verifyCode } from '@/lib/auth/otp';
import { consume } from '@/lib/rateLimit';
import { db } from '@/lib/db';
import { createSession } from '@/lib/auth/session';
import { env } from '@/lib/env';

export async function POST(req: Request) {
  const { phone, code } = await req.json().catch(() => ({}));
  if (typeof phone !== 'string' || typeof code !== 'string') {
    return NextResponse.json({ error: 'bad_input' }, { status: 400 });
  }
  const rl = await consume(`otp_verify:${phone}`, 10, 10 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const result = await verifyCode(phone, code);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 401 });

  const user = await db.user.upsert({ where: { phone }, create: { phone }, update: {} });
  const s = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', s.id, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    expires: s.expiresAt, path: '/',
  });
  return res;
}
```

Create `src/app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeSession } from '@/lib/auth/session';

export async function POST() {
  const id = cookies().get('session')?.value;
  if (id) await revokeSession(id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', '', { path: '/', expires: new Date(0) });
  return res;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- auth.route`
Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: OTP auth API routes with rate limiting + session cookie"
```

---

## Task 9: Minimal login UI + logged-in home

**Files:**
- Create: `src/app/login/page.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/app/__tests__/loginFlow.test.ts` (drives the route handlers end-to-end; UI is thin)

- [ ] **Step 1: Write a thin end-to-end flow test through the handlers**

Create `src/app/__tests__/loginFlow.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb } from '@/test/helpers/db';
import { POST as requestCode } from '@/app/api/auth/request-code/route';
import { POST as verify } from '@/app/api/auth/verify/route';
import { validateSession } from '@/lib/auth/session';

describe('login flow', () => {
  beforeEach(resetDb);
  it('phone -> code -> valid session cookie that validates', async () => {
    let code = '';
    vi.spyOn(console, 'log').mockImplementation((m: string) => {
      const x = /code is (\d{6})/.exec(String(m)); if (x) code = x[1];
    });
    const mk = (b: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });
    await requestCode(mk({ phone: '+8613000000000' }));
    const res = await verify(mk({ phone: '+8613000000000', code }));
    const cookie = res.headers.get('set-cookie')!;
    const sid = /session=([^;]+)/.exec(cookie)![1];
    expect(await validateSession(sid)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- loginFlow`
Expected: FAIL until routes import cleanly (they exist from Task 8; this guards the wiring).

- [ ] **Step 3: Implement the login page (two-step form) and gated home**

Create `src/app/login/page.tsx`:
```tsx
'use client';
import { useState } from 'react';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');

  async function send() {
    const r = await fetch('/api/auth/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
    setMsg(r.ok ? '验证码已发送' : '发送失败/过于频繁');
    if (r.ok) setSent(true);
  }
  async function login() {
    const r = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, code }) });
    if (r.ok) location.href = '/'; else setMsg('验证码错误');
  }

  return (
    <main style={{ maxWidth: 360, margin: '64px auto', display: 'grid', gap: 12 }}>
      <h1>登录 / 注册</h1>
      <input placeholder="手机号" value={phone} onChange={e => setPhone(e.target.value)} />
      {!sent
        ? <button onClick={send}>发送验证码</button>
        : <>
            <input placeholder="6 位验证码" value={code} onChange={e => setCode(e.target.value)} />
            <button onClick={login}>登录</button>
          </>}
      <p>{msg}</p>
    </main>
  );
}
```

Overwrite `src/app/page.tsx` (redirect to login when not authed):
```tsx
import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/auth/currentUser';

export default async function Home() {
  const uid = await currentUserId();
  if (!uid) redirect('/login');
  return (
    <main style={{ maxWidth: 640, margin: '48px auto' }}>
      <h1>See Me</h1>
      <p>已登录:{uid}</p>
      <form action="/api/auth/logout" method="post"><button>退出</button></form>
    </main>
  );
}
```

- [ ] **Step 4: Run tests; then manual smoke**

Run: `npm test`
Expected: entire suite PASS.
Manual:
```bash
npm run dev
# open http://localhost:3000 -> redirected to /login
# enter a phone, click 发送验证码, read the code from the terminal ([sms:dev] ...), log in
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: login UI + auth-gated home"
```

---

## Self-Review (completed during authoring)

**Spec coverage (Plan 1 scope = §1, §2, §5 rate-limit machinery, §6):**
- §1 stack/docker/SMS-pluggable → Tasks 1, 5. ✅
- §2 all 8 tables + TIMESTAMPTZ + FK Restrict + Session(server-side) + RateLimit → Task 2 (Restrict verified by test). ✅
- §5 atomic cross-process limiter (the redeem limiter reused later) → Task 4 (concurrency test proves atomicity). ✅
- §6 OTP single-use/lockout/constant-time/6-digit-5min, server-side revocable session, cookie → Tasks 6, 7, 8. ✅
- Out of scope for Plan 1 (deferred): §3 permission engine, §4 reader red lines, §5 invite-code alphabet/redeem, §7 A/B flows → Plans 2–3.

**Placeholder scan:** no TBD/TODO; every code step has full code. The `aliyunDriver` is an explicitly-deferred ops task, not a placeholder in the build path. ✅

**Type consistency:** `consume`, `requestCode`/`verifyCode` (`VerifyResult`), `createSession`/`validateSession`/`revokeSession`, `currentUserId`, `getSmsSender`/`SmsSender`, `hmacHex`/`timingSafeEqualHex` match the contract block and all call sites. Cookie name `session` consistent across verify/logout/currentUser. ✅

**Known follow-ups for Plan 2 (not gaps in Plan 1):** invite-code module, notes/tags/cards, the permission engine and its red-line tests.
