import path from 'path';
import { type Request, type Response } from 'express';

import apiRouter from '@/router';
import { errorHandler, notFoundHandler } from '@/middleware/errorMiddleware';

const cors = require('cors') as typeof import('cors');
const express = require('express') as typeof import('express');
const morgan = require('morgan') as typeof import('morgan');

const app = express();
const projectRoot = process.cwd();

app.set('views', path.join(projectRoot, 'view'));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(projectRoot, 'public')));

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'view', 'index.html'));
});

app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
