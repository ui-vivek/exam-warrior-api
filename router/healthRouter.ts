import { getHealth } from '@/controller/healthController';

const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/', getHealth);

export default router;
