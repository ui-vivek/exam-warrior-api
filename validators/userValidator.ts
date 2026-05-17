import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    exam_type: z.enum(['SSC', 'RAILWAY', 'BANKING', 'UPSC'], {
      message: 'invalid_exam_type'
    }).optional(),
    preferred_language: z.enum(['english', 'hindi'], {
      message: 'Invalid language'
    }).optional(),
    state: z.string().optional()
  })
});

export const updateLanguageSchema = z.object({
  body: z.object({
    preferredLanguage: z.enum(['english', 'hindi'], {
      message: 'Invalid language'
    })
  })
});

export const updateExamTypeSchema = z.object({
  body: z.object({
    examType: z.enum(['SSC', 'RAILWAY', 'BANKING', 'UPSC'], {
      message: 'invalid_exam_type'
    })
  })
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>['body'];
export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>['body'];
export type UpdateExamTypeInput = z.infer<typeof updateExamTypeSchema>['body'];
