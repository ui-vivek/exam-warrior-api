import { Response } from 'express';
import mongoose from 'mongoose';
import { Bookmark } from '@/model/bookmark.model';
import { Question } from '@/model/question.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';

const pickLang = (field: any, lang: string): string => {
  if (typeof field === 'string') return field;
  // Fall back across languages so content shows even if one is empty.
  return field?.[lang] || field?.en || field?.hi || '';
};

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

  const bookmarks = await Bookmark.find({ userId })
    .sort({ createdAt: -1 })
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
        optionA: q.options?.a ? pickLang(q.options.a, lang) : q.optionA,
        optionB: q.options?.b ? pickLang(q.options.b, lang) : q.optionB,
        optionC: q.options?.c ? pickLang(q.options.c, lang) : q.optionC,
        optionD: q.options?.d ? pickLang(q.options.d, lang) : q.optionD,
        correctOption: q.correctOption,
        explanationHindi: q.explanation ? pickLang(q.explanation, lang) : q.explanationHindi,
        subject: q.subject,
        topic: q.topic,
      };
    });

  res.json({ success: true, data });
});
