export type ScopeCategory = "calorie_or_weight_target" | "weight_recommendation" | "medical_advice";

const PATTERNS: Record<ScopeCategory, RegExp[]> = {
  calorie_or_weight_target: [
    /how many calories should i/i,
    /how much should i (eat|weigh)/i,
    /what('?s| is) my (calorie|weight) (target|goal)/i,
    /calorie (target|goal|limit) for me/i,
    /\bhit\s+\d{2,5}\s*calories?\b/i, // e.g. "hit 1800 calories"
    /\b\d{2,5}\s*calories?\s*(a|per)\s*day\b/i, // e.g. "1800 calories a day" — a daily target, not a fact about one food
  ],
  weight_recommendation: [
    /should i (lose|gain) weight/i,
    /what should i weigh/i,
    /am i overweight/i,
    /ideal weight for (me|someone)/i,
    /\b(lose|gain)\s+\d+\s*(pounds?|lbs?|kgs?|kilograms?)\b/i, // a specific weight-change amount, e.g. "lose 10 pounds"
  ],
  medical_advice: [
    /diagnos/i,
    /is this a symptom of/i,
    /do i have (a |an )?(disease|condition|disorder)/i,
    /\bdo i have\b.*\b(symptoms?|based on)\b/i, // e.g. "do I have diabetes based on these symptoms" — self-diagnosis phrasing, not just the generic word "disease"
    /what (medication|dosage|drug).*should i take/i,
    /treat(ment)? for my/i,
  ],
};

export function checkScope(text: string): ScopeCategory | null {
  for (const [category, patterns] of Object.entries(PATTERNS) as [ScopeCategory, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return category;
    }
  }
  return null;
}

export const DECLINE_MESSAGE =
  "I can't help with that — please talk to a qualified professional, such as a doctor or registered dietitian.";
