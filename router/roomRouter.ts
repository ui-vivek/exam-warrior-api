import {
  createRoom,
  joinRoom,
  getRoom,
  startRoom,
  getRoomTest,
  submitRoomScore,
  getLeaderboard,
  getMyRooms,
} from '@/controller/roomController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/', authMiddleware, getMyRooms);
router.post('/', authMiddleware, createRoom);
router.post('/:code/join', authMiddleware, joinRoom);
router.get('/:code', authMiddleware, getRoom);
router.post('/:code/start', authMiddleware, startRoom);
router.get('/:code/test', authMiddleware, getRoomTest);
router.post('/:code/submit', authMiddleware, submitRoomScore);
router.get('/:code/leaderboard', authMiddleware, getLeaderboard);

export default router;
