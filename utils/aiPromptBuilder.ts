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
- Output ONLY valid JSON
- No markdown (no \`\`\`json blocks), just the raw JSON object
- No explanation outside JSON
- Each question must have exactly 4 options (a, b, c, d)
- correctOption must be the actual correct answer (one of: "a", "b", "c", "d")
- explanationHindi must be in simple conversational Hinglish
- Style: "Yahan trick yeh hai ki...", "Dhyan rakhna...", "Isko yaad rakhne ka aasan tarika..."
- Avoid formal Sanskrit-heavy Hindi
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
