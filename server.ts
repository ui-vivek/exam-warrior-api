import path from 'path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { env } from '@/lib/config';
import connectDB from '@/lib/db';
import apiRouter from '@/router';
import { errorHandler, notFoundHandler } from '@/middleware/errorMiddleware';

// Connect to Database
connectDB();

const app = express();
const projectRoot = process.cwd();

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(projectRoot, 'public')));

// Views setup
app.set('views', path.join(projectRoot, 'view'));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'view', 'index.html'));
});

app.use('/api', apiRouter);

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`Server is running on http://localhost:${env.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${env.port} is already in use. Set a different PORT in .env.`);
  } else {
    console.error('Unable to start server:', error.message);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});
