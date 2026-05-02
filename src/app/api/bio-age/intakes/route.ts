import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb, Timestamp } from '@/lib/firebase-admin';
import { checkRateLimit, clientIpFromRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 20, intervalMs: 60 * 60 * 1000 }; // 20 / hour
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SOURCE = 'go.resohealth.life/bio-age';

type IntakeBody = {
  answers?: Array<{ q: string; a: string | number }>;
  chronologicalAge?: number;
  biologicalAge?: number;
  delta?: number;
  score?: number;
  category?: string;
  locale?: string;
  email?: string | null;
  fullName?: string | null;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function sanitizeOptionalString(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function POST(req: Request) {
  const ip = clientIpFromRequest(req);
  const rl = checkRateLimit(`bio-age-intakes:${ip}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  let body: IntakeBody;
  try {
    body = (await req.json()) as IntakeBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (
    !isFiniteNumber(body.chronologicalAge) ||
    !isFiniteNumber(body.biologicalAge) ||
    !isFiniteNumber(body.delta) ||
    !Array.isArray(body.answers)
  ) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const claimToken = randomBytes(16).toString('hex');
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + TTL_MS);

  const doc = {
    answers: body.answers.slice(0, 100),
    chronologicalAge: body.chronologicalAge,
    biologicalAge: body.biologicalAge,
    delta: body.delta,
    score: isFiniteNumber(body.score) ? body.score : null,
    category: sanitizeOptionalString(body.category, 60),
    locale: sanitizeOptionalString(body.locale, 16),
    email: sanitizeOptionalString(body.email, 254),
    fullName: sanitizeOptionalString(body.fullName, 120),
    source: SOURCE,
    createdAt: now,
    expiresAt,
    claimToken,
    claimedBy: null,
    claimedAt: null,
  };

  try {
    const db = getDb();
    const ref = await db.collection('bio_age_intakes').add(doc);
    return NextResponse.json({ intakeId: ref.id, claimToken }, { status: 201 });
  } catch (err) {
    console.error('[bio-age/intakes] write failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
