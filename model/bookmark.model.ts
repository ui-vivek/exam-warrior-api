import mongoose from 'mongoose';

const BookmarkSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
}, { timestamps: true });

// One bookmark per user per question.
BookmarkSchema.index({ userId: 1, questionId: 1 }, { unique: true });
// Fast listing of a user's bookmarks, newest first.
BookmarkSchema.index({ userId: 1, createdAt: -1 });

export const Bookmark = mongoose.model('Bookmark', BookmarkSchema);
