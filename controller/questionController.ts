import { Request, Response } from 'express';
import { Question } from '@/model/question.model';

export const reportWrongQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const question = await Question.findByIdAndUpdate(
      id,
      { 
        $inc: { reportCount: 1 },
        reportedWrong: true 
      },
      { new: true }
    );

    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    res.json({
      message: 'Question reported successfully',
      question
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Error reporting question', error: error.message });
  }
};
