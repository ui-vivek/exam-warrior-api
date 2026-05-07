import { Request, Response } from 'express';
import { generateQuestions } from '@/services/aiService';
import { Question } from '@/model/question.model';

export const generateAndSaveQuestions = async (req: Request, res: Response) => {
  try {
    const { examType, weakTopics, difficulty, recentTopics } = req.body;

    if (!examType || !weakTopics || !Array.isArray(weakTopics)) {
      return res.status(400).json({ message: 'examType and weakTopics (array) are required' });
    }

    const generatedQuestions = await generateQuestions(examType, weakTopics, difficulty, recentTopics);

    // Prepare questions for MongoDB
    const questionsToSave = generatedQuestions.map((q) => ({
      ...q,
      examType,
      source: 'AI',
      generationDate: new Date(),
      isActive: true,
    }));

    // Save to MongoDB
    const savedQuestions = await Question.insertMany(questionsToSave);

    res.status(201).json({
      message: `${savedQuestions.length} questions generated and saved successfully`,
      questions: savedQuestions,
    });
  } catch (error: any) {
    console.error('AI Generation Error:', error);
    res.status(500).json({ message: 'Failed to generate questions', error: error.message });
  }
};
