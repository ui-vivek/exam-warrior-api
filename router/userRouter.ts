import { listUsers } from '@/controller/userController';

const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/', listUsers);

export default router;
