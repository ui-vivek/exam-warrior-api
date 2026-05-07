import { Request, Response } from 'express';
import { generateQuestions, verifyBatchQuestions, regenerateSingleQuestion } from '@/services/aiService';
import { Question } from '@/model/question.model';

export const generateAndSaveQuestions = async (req: Request, res: Response) => {
  try {
    const { examType, weakTopics, difficulty, recentTopics } = req.body;

    if (!examType || !weakTopics || !Array.isArray(weakTopics)) {
      return res.status(400).json({ message: 'examType and weakTopics (array) are required' });
    }

    const startTime = Date.now();
    const generatedQuestions = await generateQuestions(examType, weakTopics, difficulty, recentTopics);
    const generationTimeMs = Date.now() - startTime;

    // --- Batch Verification ---
    const vStartTime = Date.now();
    console.log(`Starting Batch verification for ${generatedQuestions.length} questions...`);
    const verificationResults = await verifyBatchQuestions(generatedQuestions);
    const verificationTimeMs = Date.now() - vStartTime;

    const validatedQuestions: any[] = [];
    const questionsToRegenerate: any[] = [];

    // Map results back to questions
    generatedQuestions.forEach((q, idx) => {
      const result = verificationResults.find((r: any) => r.id === idx);
      if (result && result.valid) {
        validatedQuestions.push({ ...q, aiVerified: true });
      } else {
        questionsToRegenerate.push(q);
      }
    });

    // --- Handle Failures (Regeneration) ---
    for (const q of questionsToRegenerate) {
      console.warn(`Question failed verification (Topic: ${q.topic}). Regenerating...`);
      try {
        const newQ = await regenerateSingleQuestion(q.topic, examType);
        // Single quick verify for regenerated question
        const singleResults = await verifyBatchQuestions([newQ]);
        if (singleResults[0]?.valid) {
          validatedQuestions.push({ ...newQ, aiVerified: true });
        } else {
          console.error(`Regenerated question also failed verification for topic: ${q.topic}`);
        }
      } catch (err) {
        console.error(`Error regenerating question for topic ${q.topic}:`, err);
      }
    }

    // Prepare questions for MongoDB
    const questionsToSave = validatedQuestions.map((q) => ({
      ...q,
      examType,
      source: 'AI',
      generationDate: new Date(),
      generationVersion: 'v1.2', // Track prompt version
      performance: {
        generationTimeMs,
        verificationTimeMs
      },
      isActive: true,
    }));

    // Save to MongoDB
    try {
      // Use ordered: false so if some questions are duplicates, the rest still get saved
      await Question.insertMany(questionsToSave, { ordered: false });
    } catch (dbError: any) {
      if (dbError.code === 11000) {
        console.warn(`Some duplicate questions were skipped.`);
      } else {
        throw dbError;
      }
    }

    res.status(200).json({
      message: 'Questions generated and verified successfully',
      count: questionsToSave.length,
      questions: questionsToSave,
    });
  } catch (error: any) {
    console.error('AI Generation Error:', error);
    res.status(500).json({ message: 'Failed to generate questions', error: error.message });
  }
};
