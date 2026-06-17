import { z } from 'zod';

/** A bilingual text field: both English and Hindi required. */
const Bilingual = z.object({
  en: z.string().min(1),
  hi: z.string().min(1),
});

const QuestionSchema = z.object({
  questionText: z.object({
    en: z.string().min(5),
    hi: z.string().min(1),
  }),
  options: z.object({
    a: Bilingual,
    b: Bilingual,
    c: Bilingual,
    d: Bilingual,
  }),
  correctOption: z.enum(['a', 'b', 'c', 'd']),
  explanation: z.object({
    en: z.string().min(5),
    hi: z.string().min(5),
  }),
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
