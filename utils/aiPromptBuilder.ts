export const buildQuestionPrompt = (
  examType: string,
  weakTopics: string[],
  difficulty: string,
  recentTopics: string[] = []
): string => {
  return `
You are an expert Indian competitive exam question setter who is fluent in both English and Hindi.

Generate exactly 20 multiple-choice questions for the ${examType} exam.

Focus on these topics:
${weakTopics.join(', ')}

Difficulty: ${difficulty}

RULES:
- Output ONLY valid JSON — no extra text, no markdown, no backticks
- Do NOT wrap the response in \`\`\`json ... \`\`\` blocks
- Start directly with { and end with }
- No explanation or text outside the JSON object
- Each question must have exactly 4 options (a, b, c, d)
- Provide BOTH languages for every text field:
  - "en": natural English
  - "hi": accurate Hindi in Devanagari script for the question text and options
- correctOption must be the actual correct answer (one of: "a", "b", "c", "d")
- explanation.en: a concise English explanation (max 2-3 lines)
- explanation.hi: simple conversational Hinglish (Hindi written in Devanagari is fine too), max 2-3 lines
  - Style: "Yahan trick yeh hai ki...", "Dhyan rakhna...", "Isko yaad rakhne ka aasan tarika..."
  - Avoid formal Sanskrit-heavy Hindi and unnecessary filler text
- The Hindi must mean exactly the same as the English (a faithful translation, not a different question)
- Do NOT use generic topics like "General Knowledge" for subjects like Mathematics, Reasoning, or English.
- Use specific sub-topics (e.g., "Algebra", "Syllogism", "Tenses") for non-GK subjects.
- Do not repeat topics: ${recentTopics.join(', ')}

OUTPUT FORMAT:
{
  "questions": [
    {
      "questionText": { "en": "...", "hi": "..." },
      "options": {
        "a": { "en": "...", "hi": "..." },
        "b": { "en": "...", "hi": "..." },
        "c": { "en": "...", "hi": "..." },
        "d": { "en": "...", "hi": "..." }
      },
      "correctOption": "a",
      "explanation": { "en": "...", "hi": "..." },
      "subject": "Reasoning",
      "topic": "Number Series",
      "difficulty": "medium"
    }
  ]
}
  `.trim();
};
