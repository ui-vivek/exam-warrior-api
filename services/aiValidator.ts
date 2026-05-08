import { z } from 'zod';

const QuestionSchema = z.object({
  questionText: z.string().min(10),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correctOption: z.enum(['a', 'b', 'c', 'd']),
  explanationHindi: z.string().min(10),
  subject: z.string(),
  topic: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

const AIResponseSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
});

export const validateAIQuestions = (data: any) => {
  try {
    return AIResponseSchema.parse(data).questions;
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`AI Validation Failed: ${details}`);
    }
    throw error;
  }
};
