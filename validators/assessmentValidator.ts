import { z } from 'zod';

const answersArray = z
  .array(
    z.object({
      questionId:     z.string().min(1),
      selectedOption: z.string().optional(),
      timeSpentSec:   z.number().optional(),
    }),
  )
  .default([]);

export const createAssessmentSchema = z.object({
  body: z.object({
    batchId:       z.string().min(1, 'batch_required'),
    title:         z.string().min(2, 'title_too_short').max(100),
    type:          z.enum(['WEEKLY', 'DAILY', 'ASSIGNMENT']).optional(),
    subjects:      z.array(z.string()).max(20).optional(),
    difficulty:    z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
    questionCount: z.number().int().min(5, 'min_5_questions').max(100, 'max_100_questions'),
    windowStart:   z.coerce.date(),
    windowEnd:     z.coerce.date(),
    // Optional override; otherwise derived from question count.
    durationMinutes: z.number().int().min(1).max(300).optional(),
  }),
});

export const submitAssessmentSchema = z.object({
  body: z.object({
    answers:      answersArray,
    timeTakenSec: z.number().int().min(0).optional(),
  }),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>['body'];
export type SubmitAssessmentInput = z.infer<typeof submitAssessmentSchema>['body'];
