import { z } from 'zod';

const examType = z.enum(['SSC', 'RAILWAY', 'BANKING', 'UPSC', 'AGNIVEER'], {
  message: 'invalid_exam_type',
});

export const createInstituteSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'name_too_short').max(80),
    type: z.enum(['LIBRARY', 'COACHING', 'YOUTUBE', 'SCHOOL', 'OTHER'], {
      message: 'invalid_institute_type',
    }).optional(),
  }),
});

export const updateInstituteSchema = z.object({
  body: z.object({
    name:       z.string().min(2).max(80).optional(),
    logoUrl:    z.string().url('invalid_url').optional(),
    bannerUrl:  z.string().url('invalid_url').optional(),
    brandColor: z.string().max(20).optional(),
  }),
});

export const createBatchSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'name_too_short').max(60),
    examType,
    requiresApproval: z.boolean().optional(),
  }),
});

export const joinBatchSchema = z.object({
  body: z.object({
    code: z.string().min(4, 'invalid_code').max(10).transform((s) => s.toUpperCase().trim()),
  }),
});

export const manualAddSchema = z.object({
  body: z.object({
    phone:   z.string().min(8, 'invalid_phone').max(20),
    batchId: z.string().min(1, 'batch_required'),
  }),
});

export type CreateInstituteInput = z.infer<typeof createInstituteSchema>['body'];
export type CreateBatchInput = z.infer<typeof createBatchSchema>['body'];
export type JoinBatchInput = z.infer<typeof joinBatchSchema>['body'];
export type ManualAddInput = z.infer<typeof manualAddSchema>['body'];
