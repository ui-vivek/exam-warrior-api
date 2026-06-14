import { reportWrongQuestion } from '@/controller/questionController';
import { toggleBookmark, removeBookmark, listBookmarks } from '@/controller/bookmarkController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');

const router = express.Router();

// Bookmarks (auth). Keep the static path before parameterized routes.
router.get('/bookmarks', authMiddleware, listBookmarks);
router.post('/:id/bookmark', authMiddleware, toggleBookmark);
router.delete('/:id/bookmark', authMiddleware, removeBookmark);

router.post('/:id/report', reportWrongQuestion);

export default router;
