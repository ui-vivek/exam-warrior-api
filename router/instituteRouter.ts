import {
  createInstitute,
  getMyInstitutes,
  getInstitute,
  updateInstitute,
  createBatch,
  listBatches,
  getMembers,
  approveMember,
  removeMember,
  manualAddMember,
  joinBatch,
  getJoinedInstitutes,
} from '@/controller/instituteController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { validate } from '@/middleware/validateMiddleware';
import {
  createInstituteSchema,
  updateInstituteSchema,
  createBatchSchema,
  joinBatchSchema,
  manualAddSchema,
} from '@/validators/instituteValidator';

const express = require('express') as typeof import('express');

const router = express.Router();

// Student side — literal paths first so they aren't captured by '/:id'.
router.post('/join', authMiddleware, validate(joinBatchSchema), joinBatch);
router.get('/joined', authMiddleware, getJoinedInstitutes);

// Admin: institutes
router.get('/mine', authMiddleware, getMyInstitutes);
router.post('/', authMiddleware, validate(createInstituteSchema), createInstitute);
router.get('/:id', authMiddleware, getInstitute);
router.patch('/:id', authMiddleware, validate(updateInstituteSchema), updateInstitute);

// Admin: batches
router.post('/:id/batches', authMiddleware, validate(createBatchSchema), createBatch);
router.get('/:id/batches', authMiddleware, listBatches);

// Admin: members / roster
router.get('/:id/members', authMiddleware, getMembers);
router.post('/:id/members', authMiddleware, validate(manualAddSchema), manualAddMember);
router.post('/:id/members/:membershipId/approve', authMiddleware, approveMember);
router.delete('/:id/members/:membershipId', authMiddleware, removeMember);

export default router;
