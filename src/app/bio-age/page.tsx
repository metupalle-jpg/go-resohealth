'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Answer,
  BioAgeResult,
  QUESTIONS,
  computeBioAge,
} from '@/lib/bio-age';

const ME_SIGNUP_URL = 'https://resohealth.life/me/sign-up/';
const STORAGE_KEY = 'bioAgeLastResult';

type StoredResult = {
  result: BioAgeResult;
  answers: Answer[];
  savedAt: number;
};

type Stage = 'intro' | 'questions' | 'result';

export default function BioAgePage() {
  const [stage, setStage] = useState<Stage>('intro');
  const [chronologicalAge, setChronologicalAge] = useState<number | ''>('');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<BioAgeResult | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredResult;
      if (parsed?.result && parsed?.answers) {
        setResult(parsed.result);
        setChronologicalAge(parsed.result.chronologicalAge);
        const map: Record<string, number> = {};
        for (const a of parsed.answers) {
          if (typeof a.a === 'number') map[a.q] = a.a;
        }
        setAnswers(map);
        setStage('result');
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const allAnswered = useMemo(
    () =>
      QUESTIONS.every((q) => typeof answers[q.id] === 'number') &&
      typeof chronologicalAge === 'number' &&
      chronologicalAge >= 14 &&
      chronologicalAge <= 110,
    [answers, chronologicalAge]
  );

  const onSubmitTest = () => {
    if (!allAnswered || typeof chronologicalAge !== 'number') return;
    const ansArr: Answer[] = QUESTIONS.map((q) => ({
      q: q.id,
      a: answers[q.id],
    }));
    const r = computeBioAge(chronologicalAge, ansArr);
    setResult(r);
    setStage('result');
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ result: r, answers: ansArr, savedAt: Date.now() })
      );
    } catch {
      // localStorage may be unavailable
    }
  };

  const onRetake = () => {
    setStage('intro');
    setResult(null);
    setAnswers({});
    setChronologicalAge('');
    setSaveError(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const onSaveAndCreateAccount = async () => {
    if (!result) return;
    setSaving(true);
    setSaveError(null);

    const ansArr: Answer[] = QUESTIONS.map((q) => ({
      q: q.id,
      a: answers[q.id],
    }));

    try {
      const res = await fetch('/api/bio-age/intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: ansArr,
          chronologicalAge: result.chronologicalAge,
          biologicalAge: result.biologicalAge,
          delta: result.delta,
          score: result.score,
          category: result.category,
          locale: typeof navigator !== 'undefined' ? navigator.language?.split('-')[0] || 'en' : 'en',
          email: email.trim() || null,
          fullName: fullName.trim() || null,
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          setSaveError('Too many requests right now — please try again in a few minutes.');
        } else {
          setSaveError('We could not save your report. Please try again.');
        }
        setSaving(false);
        return;
      }

      const data = (await res.json()) as { intakeId: string; claimToken: string };
      const params = new URLSearchParams({
        bioAgeRef: data.intakeId,
        t: data.claimToken,
      });
      if (email.trim()) params.set('email', email.trim());
      window.location.href = `${ME_SIGNUP_URL}?${params.toString()}`;
    } catch (e) {
      console.error(e);
      setSaveError('Network error. Please try again.');
      setSaving(false);
    }
  };

  if (stage === 'intro') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-emerald-50 px-4 py-12">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900">BioAge Calculator</h1>
          <p className="mt-2 text-gray-600">
            Estimate your biological age based on lifestyle factors. Takes about 2 minutes.
          </p>

          <label className="block mt-8 text-sm font-medium text-gray-800">
            Your chronological age
          </label>
          <input
            type="number"
            min={14}
            max={110}
            value={chronologicalAge}
            onChange={(e) =>
              setChronologicalAge(e.target.value ? Number(e.target.value) : '')
            }
            className="mt-1 w-32 rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
            placeholder="e.g. 38"
          />

          <button
            onClick={() => setStage('questions')}
            disabled={
              typeof chronologicalAge !== 'number' ||
              chronologicalAge < 14 ||
              chronologicalAge > 110
            }
            className="mt-8 w-full rounded-xl bg-indigo-600 text-white py-3 font-semibold disabled:opacity-50"
          >
            Start the test
          </button>
        </div>
      </main>
    );
  }

  if (stage === 'questions') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-emerald-50 px-4 py-12">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900">BioAge — Lifestyle Questions</h1>
          <p className="mt-2 text-gray-600">Pick the option closest to your current habits.</p>

          <ol className="mt-8 space-y-6">
            {QUESTIONS.map((q, idx) => (
              <li key={q.id}>
                <p className="font-medium text-gray-900">
                  {idx + 1}. {q.prompt}
                </p>
                <div className="mt-3 grid gap-2">
                  {q.options.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        answers[q.id] === opt.value
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={answers[q.id] === opt.value}
                        onChange={() =>
                          setAnswers((a) => ({ ...a, [q.id]: opt.value }))
                        }
                        className="accent-indigo-600"
                      />
                      <span className="text-gray-800">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          <button
            onClick={onSubmitTest}
            disabled={!allAnswered}
            className="mt-10 w-full rounded-xl bg-indigo-600 text-white py-3 font-semibold disabled:opacity-50"
          >
            See my BioAge
          </button>
        </div>
      </main>
    );
  }

  // result
  if (!result) return null;
  const deltaLabel =
    result.delta < 0
      ? `${Math.abs(result.delta)} years younger`
      : result.delta > 0
      ? `${result.delta} years older`
      : 'matched';

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-emerald-50 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900">Your BioAge</h1>
          <div className="mt-6 flex items-end gap-4">
            <div className="text-6xl font-bold text-indigo-700">
              {result.biologicalAge}
            </div>
            <div className="pb-2 text-gray-700">
              <div className="text-sm">
                Chronological: {result.chronologicalAge}
              </div>
              <div className="text-sm">
                Δ: {result.delta > 0 ? '+' : ''}
                {result.delta} ({deltaLabel} than chrono)
              </div>
            </div>
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-800">
            {result.category} · score {result.score}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900">Save your report</h2>
          <p className="mt-2 text-gray-600">
            Save this report to your private ResoHealth profile and view it on{' '}
            <span className="font-medium">/me/health/</span> and{' '}
            <span className="font-medium">/me/timeline/</span>.
          </p>

          <button
            type="button"
            onClick={() => setShowOptional((s) => !s)}
            className="mt-4 text-sm text-indigo-700 hover:underline"
          >
            {showOptional ? 'Hide optional details' : 'Add your email and name (optional)'}
          </button>

          {showOptional && (
            <div className="mt-4 grid gap-3">
              <label className="block text-sm">
                <span className="text-gray-800">Email (optional)</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  placeholder="you@example.com"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-800">Full name (optional)</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  placeholder="Jane Doe"
                />
              </label>
            </div>
          )}

          <button
            onClick={onSaveAndCreateAccount}
            disabled={saving}
            className="mt-6 w-full rounded-xl bg-indigo-600 text-white py-3 font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save report & create my account'}
          </button>
          <button
            onClick={onRetake}
            className="mt-3 w-full rounded-xl bg-gray-100 text-gray-800 py-3 font-medium"
          >
            Continue without saving
          </button>

          {saveError && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {saveError}
            </p>
          )}

          <p className="mt-6 text-xs italic text-gray-500">
            Saving creates a free ResoHealth member account. We retain your test
            responses for 30 days unless you create the account, after which
            they&rsquo;re saved to your private profile.
          </p>
        </div>
      </div>
    </main>
  );
}
