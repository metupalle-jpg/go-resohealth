import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addMock = vi.fn();
const collectionMock = vi.fn(() => ({ add: addMock }));

vi.mock('@/lib/firebase-admin', () => {
  return {
    getDb: () => ({ collection: collectionMock }),
    Timestamp: {
      now: () => ({ toMillis: () => 1_700_000_000_000 }),
      fromMillis: (ms: number) => ({ toMillis: () => ms }),
    },
  };
});

import { POST } from './route';
import { _resetRateLimits } from '@/lib/rate-limit';

function makeReq(body: unknown, ip = '203.0.113.1') {
  return new Request('http://localhost/api/bio-age/intakes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  answers: [
    { q: 'sleep', a: 3 },
    { q: 'exercise', a: 4 },
  ],
  chronologicalAge: 38,
  biologicalAge: 35,
  delta: -3,
  score: 78,
  category: 'Good',
  locale: 'en',
  email: 'user@example.com',
  fullName: 'Test User',
};

describe('POST /api/bio-age/intakes', () => {
  beforeEach(() => {
    addMock.mockReset();
    collectionMock.mockClear();
    _resetRateLimits();
  });

  afterEach(() => {
    _resetRateLimits();
  });

  it('writes an intake doc and returns intakeId + claimToken', async () => {
    addMock.mockResolvedValueOnce({ id: 'doc_123' });

    const res = await POST(makeReq(validBody, '198.51.100.1'));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.intakeId).toBe('doc_123');
    expect(typeof json.claimToken).toBe('string');
    expect(json.claimToken).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(json.claimToken)).toBe(true);

    expect(collectionMock).toHaveBeenCalledWith('bio_age_intakes');
    expect(addMock).toHaveBeenCalledTimes(1);

    const written = addMock.mock.calls[0][0];
    expect(written.source).toBe('go.resohealth.life/bio-age');
    expect(written.claimedBy).toBeNull();
    expect(written.claimedAt).toBeNull();
    expect(written.claimToken).toBe(json.claimToken);
    expect(written.email).toBe('user@example.com');
    expect(written.fullName).toBe('Test User');
    expect(written.chronologicalAge).toBe(38);
    expect(written.biologicalAge).toBe(35);
    expect(written.delta).toBe(-3);
    expect(written.score).toBe(78);
    expect(written.category).toBe('Good');
    expect(written.locale).toBe('en');

    // expiresAt must be createdAt + 30 days
    const created = written.createdAt.toMillis();
    const expires = written.expiresAt.toMillis();
    expect(expires - created).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('coerces empty optional strings to null', async () => {
    addMock.mockResolvedValueOnce({ id: 'doc_x' });
    const body = { ...validBody, email: '   ', fullName: '' };
    const res = await POST(makeReq(body, '198.51.100.2'));
    expect(res.status).toBe(201);
    const written = addMock.mock.calls[0][0];
    expect(written.email).toBeNull();
    expect(written.fullName).toBeNull();
  });

  it('rejects invalid payloads with 400', async () => {
    const res = await POST(
      makeReq({ chronologicalAge: 30 } as any, '198.51.100.3')
    );
    expect(res.status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('rate-limits more than 20 requests/hour from the same IP', async () => {
    addMock.mockResolvedValue({ id: 'doc_loop' });

    const ip = '203.0.113.99';
    for (let i = 0; i < 20; i++) {
      const res = await POST(makeReq(validBody, ip));
      expect(res.status).toBe(201);
    }

    const blocked = await POST(makeReq(validBody, ip));
    expect(blocked.status).toBe(429);
    const json = await blocked.json();
    expect(json.error).toBe('rate_limited');
    expect(typeof json.retryAfterMs).toBe('number');
    expect(json.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('rate-limits per IP, so a different IP is unaffected', async () => {
    addMock.mockResolvedValue({ id: 'doc_loop2' });

    for (let i = 0; i < 20; i++) {
      const res = await POST(makeReq(validBody, '203.0.113.50'));
      expect(res.status).toBe(201);
    }
    const blocked = await POST(makeReq(validBody, '203.0.113.50'));
    expect(blocked.status).toBe(429);

    const otherIp = await POST(makeReq(validBody, '203.0.113.51'));
    expect(otherIp.status).toBe(201);
  });
});
