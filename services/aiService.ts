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
    try {
      console.log(`AI Generation Attempt ${attempts + 1}/${maxAttempts}...`);
      
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') throw new Error('AI response is not text');

      const raw = content.text;
      
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
