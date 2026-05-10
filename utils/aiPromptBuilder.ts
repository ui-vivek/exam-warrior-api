export const buildQuestionPrompt = (
  examType: string,
  weakTopics: string[],
  difficulty: string,
  recentTopics: string[] = []
): string => {
  return `
You are an expert Indian competitive exam question setter.

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
- correctOption must be the actual correct answer (one of: "a", "b", "c", "d")
- explanationHindi must be in simple conversational Hinglish (Keep it concise, max 2-3 lines)
- Style: "Yahan trick yeh hai ki...", "Dhyan rakhna...", "Isko yaad rakhne ka aasan tarika..."
- Avoid formal Sanskrit-heavy Hindi and unnecessary filler text
- Do NOT use generic topics like "General Knowledge" for subjects like Mathematics, Reasoning, or English.
- Use specific sub-topics (e.g., "Algebra", "Syllogism", "Tenses") for non-GK subjects.
- Do not repeat topics: ${recentTopics.join(', ')}

OUTPUT FORMAT:
{
  "questions": [
    {
      "questionText": "...",
      "optionA": "...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "correctOption": "a",
      "explanationHindi": "...",
      "subject": "Reasoning",
      "topic": "Number Series",
      "difficulty": "medium"
    }
  ]
}
  `.trim();
};
