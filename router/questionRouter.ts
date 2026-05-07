import { reportWrongQuestion } from '@/controller/questionController';
const express = require('express') as typeof import('express');

const router = express.Router();

router.post('/:id/report', reportWrongQuestion);

export default router;
