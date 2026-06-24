import {
  createRoom,
  joinRoom,
  getRoom,
  startRoom,
  getRoomTest,
  submitRoomScore,
  getLeaderboard,
  getMyRooms,
  getRoomReview,
  getRoomQuota,
} from '@/controller/roomController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/', authMiddleware, getMyRooms);
// Must be before '/:code' so "quota" isn't matched as a room code.
router.get('/quota', authMiddleware, getRoomQuota);
router.post('/', authMiddleware, createRoom);
router.post('/:code/join', authMiddleware, joinRoom);
router.get('/:code', authMiddleware, getRoom);
router.post('/:code/start', authMiddleware, startRoom);
router.get('/:code/test', authMiddleware, getRoomTest);
router.post('/:code/submit', authMiddleware, submitRoomScore);
router.get('/:code/leaderboard', authMiddleware, getLeaderboard);
router.get('/:code/review', authMiddleware, getRoomReview);

export default router;
