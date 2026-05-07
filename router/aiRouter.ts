import { generateAndSaveQuestions } from '@/controller/aiController';
const express = require('express') as typeof import('express');

const router = express.Router();

router.post('/generate-questions', generateAndSaveQuestions);

export default router;
