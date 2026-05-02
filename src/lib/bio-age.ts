export type AnswerOption = {
  label: string;
  value: number;
  delta: number;
};

export type Question = {
  id: string;
  prompt: string;
  options: AnswerOption[];
};

export type Answer = { q: string; a: string | number };

export const QUESTIONS: Question[] = [
  {
    id: 'sleep',
    prompt: 'How many hours of sleep do you typically get per night?',
    options: [
      { label: 'Less than 5', value: 1, delta: 4 },
      { label: '5–6', value: 2, delta: 2 },
      { label: '7–8', value: 3, delta: -2 },
      { label: 'More than 8', value: 4, delta: 0 },
    ],
  },
  {
    id: 'exercise',
    prompt: 'How often do you exercise vigorously each week?',
    options: [
      { label: 'Rarely / never', value: 1, delta: 4 },
      { label: '1–2 times', value: 2, delta: 1 },
      { label: '3–4 times', value: 3, delta: -2 },
      { label: '5+ times', value: 4, delta: -3 },
    ],
  },
  {
    id: 'diet',
    prompt: 'How would you describe your diet?',
    options: [
      { label: 'Mostly processed / fast food', value: 1, delta: 4 },
      { label: 'Mixed', value: 2, delta: 1 },
      { label: 'Mostly whole foods', value: 3, delta: -2 },
      { label: 'Very clean (whole, plant-forward)', value: 4, delta: -3 },
    ],
  },
  {
    id: 'smoking',
    prompt: 'Do you smoke?',
    options: [
      { label: 'Yes, daily', value: 1, delta: 6 },
      { label: 'Occasionally', value: 2, delta: 3 },
      { label: 'Quit (1+ years ago)', value: 3, delta: 1 },
      { label: 'Never smoked', value: 4, delta: -1 },
    ],
  },
  {
    id: 'alcohol',
    prompt: 'How many alcoholic drinks per week?',
    options: [
      { label: '15+', value: 1, delta: 5 },
      { label: '8–14', value: 2, delta: 2 },
      { label: '1–7', value: 3, delta: 0 },
      { label: 'None', value: 4, delta: -1 },
    ],
  },
  {
    id: 'stress',
    prompt: 'How would you rate your stress level on most days?',
    options: [
      { label: 'Very high', value: 1, delta: 4 },
      { label: 'High', value: 2, delta: 2 },
      { label: 'Moderate', value: 3, delta: 0 },
      { label: 'Low', value: 4, delta: -2 },
    ],
  },
  {
    id: 'social',
    prompt: 'How connected do you feel to friends and family?',
    options: [
      { label: 'Isolated', value: 1, delta: 3 },
      { label: 'A little', value: 2, delta: 1 },
      { label: 'Pretty connected', value: 3, delta: -1 },
      { label: 'Strong, frequent connection', value: 4, delta: -2 },
    ],
  },
  {
    id: 'sun',
    prompt: 'How much time do you spend outdoors / in daylight per day?',
    options: [
      { label: 'Almost none', value: 1, delta: 2 },
      { label: '< 30 minutes', value: 2, delta: 1 },
      { label: '30–60 minutes', value: 3, delta: -1 },
      { label: '1+ hours', value: 4, delta: -2 },
    ],
  },
  {
    id: 'water',
    prompt: 'How much water do you drink per day?',
    options: [
      { label: '< 2 cups', value: 1, delta: 2 },
      { label: '2–4 cups', value: 2, delta: 1 },
      { label: '5–7 cups', value: 3, delta: 0 },
      { label: '8+ cups', value: 4, delta: -1 },
    ],
  },
  {
    id: 'screen',
    prompt: 'How many hours of recreational screen time per day?',
    options: [
      { label: '6+ hours', value: 1, delta: 3 },
      { label: '3–5 hours', value: 2, delta: 1 },
      { label: '1–2 hours', value: 3, delta: 0 },
      { label: '< 1 hour', value: 4, delta: -1 },
    ],
  },
  {
    id: 'checkups',
    prompt: 'How often do you get medical check-ups?',
    options: [
      { label: 'Never', value: 1, delta: 2 },
      { label: 'Only when sick', value: 2, delta: 1 },
      { label: 'Every couple of years', value: 3, delta: 0 },
      { label: 'Annually', value: 4, delta: -1 },
    ],
  },
  {
    id: 'mood',
    prompt: 'How would you rate your overall mood?',
    options: [
      { label: 'Often low', value: 1, delta: 3 },
      { label: 'Mixed', value: 2, delta: 1 },
      { label: 'Generally positive', value: 3, delta: -1 },
      { label: 'Consistently great', value: 4, delta: -2 },
    ],
  },
  {
    id: 'energy',
    prompt: 'How is your energy through the day?',
    options: [
      { label: 'Drained most of the day', value: 1, delta: 3 },
      { label: 'Up and down', value: 2, delta: 1 },
      { label: 'Steady', value: 3, delta: -1 },
      { label: 'Energetic and sharp', value: 4, delta: -2 },
    ],
  },
];

export type BioAgeResult = {
  chronologicalAge: number;
  biologicalAge: number;
  delta: number;
  score: number;
  category: string;
};

export function categoryFor(delta: number): string {
  if (delta <= -5) return 'Excellent';
  if (delta <= -1) return 'Good';
  if (delta <= 2) return 'Fair';
  if (delta <= 5) return 'Caution';
  return 'High Risk';
}

export function computeBioAge(
  chronologicalAge: number,
  answers: Answer[]
): BioAgeResult {
  let totalDelta = 0;
  for (const ans of answers) {
    const q = QUESTIONS.find((qq) => qq.id === ans.q);
    if (!q) continue;
    const opt = q.options.find((o) => o.value === ans.a);
    if (!opt) continue;
    totalDelta += opt.delta;
  }

  const biologicalAge = Math.max(
    18,
    Math.round((chronologicalAge + totalDelta) * 10) / 10
  );
  const delta = Math.round((biologicalAge - chronologicalAge) * 10) / 10;

  const worstPossible = QUESTIONS.reduce(
    (s, q) => s + Math.max(...q.options.map((o) => o.delta)),
    0
  );
  const bestPossible = QUESTIONS.reduce(
    (s, q) => s + Math.min(...q.options.map((o) => o.delta)),
    0
  );
  const range = worstPossible - bestPossible;
  const score =
    range === 0
      ? 50
      : Math.round(((worstPossible - totalDelta) / range) * 100);

  return {
    chronologicalAge,
    biologicalAge,
    delta,
    score: Math.max(0, Math.min(100, score)),
    category: categoryFor(delta),
  };
}
