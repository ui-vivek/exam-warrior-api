import Anthropic from '@anthropic-ai/sdk';
import { buildQuestionPrompt } from '@/utils/aiPromptBuilder';
import { validateAIQuestions } from '@/services/aiValidator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const generateQuestions = async (
  examType: string,
  weakTopics: string[],
  difficulty: string = 'medium',
  recentTopics: string[] = []
): Promise<any[]> => {
  const prompt = buildQuestionPrompt(examType, weakTopics, difficulty, recentTopics);
  
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      console.log(`AI Generation Attempt ${attempts + 1}/${maxAttempts}...`);
      
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }, { signal: controller.signal });

      clearTimeout(timeoutId);

      const content = response.content[0];
      if (content.type !== 'text') throw new Error('AI response is not text');

      let raw = content.text;
      
      // Clean markdown code blocks if present
      if (raw.includes('```')) {
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      
      // Attempt to parse and validate
      const parsedData = JSON.parse(raw);
      const validatedQuestions = validateAIQuestions(parsedData);
      
      return validatedQuestions;

    } catch (error: any) {
      attempts++;
      console.error(`Attempt ${attempts} failed:`, error.message);
      
      if (attempts === maxAttempts) {
        throw new Error(`Failed to generate valid questions after ${maxAttempts} attempts: ${error.message}`);
      }
      
      // Optional: Add a small delay before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Unexpected error in AI generation loop');
};

export const verifyBatchQuestions = async (questions: any[]): Promise<any[]> => {
  const simplifiedQuestions = questions.map((q, idx) => ({
    id: idx,
    q: q.questionText,
    a: q.optionA,
    b: q.optionB,
    c: q.optionC,
    d: q.optionD,
    ans: q.correctOption
  }));

  const prompt = `
    Check if "ans" is factually correct for these questions.
    Data: ${JSON.stringify(simplifiedQuestions)}
    
    Reply ONLY with a JSON array of status objects:
    [{"id": 0, "valid": true}, {"id": 1, "valid": false}]
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const content = response.content[0];
    if (content.type !== 'text') return [];
    
    let raw = content.text;
    if (raw.includes('```')) {
      raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    return JSON.parse(raw);
  } catch (error) {
    console.error('Batch Verification Error:', error);
    return []; 
  }
};

export const regenerateSingleQuestion = async (topic: string, examType: string): Promise<any> => {
  const prompt = `
    Generate exactly 1 multiple-choice question for the ${examType} exam on the topic: ${topic}.
    Follow the same JSON format as before:
    {
      "questionText": "...",
      "optionA": "...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "correctOption": "a",
      "explanationHindi": "...",
      "subject": "...",
      "topic": "${topic}",
      "difficulty": "medium"
    }
    Output ONLY raw JSON.
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  }, { signal: controller.signal });

  clearTimeout(timeoutId);

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Regeneration failed');
  
  let raw = content.text;
  if (raw.includes('```')) {
    raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  }
  
  return JSON.parse(raw);
};
