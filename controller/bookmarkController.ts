import { Response } from 'express';
import mongoose from 'mongoose';
import { Bookmark } from '@/model/bookmark.model';
import { Question } from '@/model/question.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';

// Reads the requested language from the nested bilingual question model.
// en/hi cross-fallback only covers a rare empty side within the same model.
const pickLang = (field: any, lang: string): string =>
  field?.[lang] || field?.en || field?.hi || '';

/**
 * POST /questions/:id/bookmark
 * Toggles a bookmark for the authenticated user. Returns the new state.
 */
export const toggleBookmark = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) throw new AppError('question_not_found', 404);

  const question = await Question.findById(id).select('_id');
  if (!question) throw new AppError('question_not_found', 404);

  const existing = await Bookmark.findOne({ userId, questionId: id });

  if (existing) {
    await Bookmark.deleteOne({ _id: existing._id });
    return res.json({ success: true, data: { bookmarked: false } });
  }

  await Bookmark.create({ userId, questionId: id });
  res.json({ success: true, data: { bookmarked: true } });
});

/**
 * DELETE /questions/:id/bookmark
 * Removes a bookmark (idempotent).
 */
export const removeBookmark = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const id = String(req.params.id);
  await Bookmark.deleteOne({ userId, questionId: id });
  res.json({ success: true, data: { bookmarked: false } });
});

/**
 * GET /questions/bookmarks
 * Lists the user's bookmarked questions with localized content + answers.
 */
export const listBookmarks = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const lang = req.lang || 'en';

  // Paginate so a user with a large bookmark list can't pull (and populate)
  // every row in one request. Defaults are generous enough not to affect normal
  // use; pass ?page / ?limit to page through.
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);

  const bookmarks = await Bookmark.find({ userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('questionId')
    .lean();

  const data = bookmarks
    .filter((b: any) => b.questionId)
    .map((b: any) => {
      const q = b.questionId;
      return {
        bookmarkId: b._id,
        bookmarkedAt: b.createdAt,
        questionId: q._id,
        questionText: pickLang(q.questionText, lang),
        optionA: pickLang(q.options?.a, lang),
        optionB: pickLang(q.options?.b, lang),
        optionC: pickLang(q.options?.c, lang),
        optionD: pickLang(q.options?.d, lang),
        correctOption: q.correctOption,
        explanationHindi: pickLang(q.explanation, lang),
        subject: q.subject,
        topic: q.topic,
      };
    });

  res.json({ success: true, data });
});
