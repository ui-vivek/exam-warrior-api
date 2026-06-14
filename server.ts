import path from 'path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';

import { env } from '@/lib/config';
import connectDB from '@/lib/db';
import apiRouter from '@/router';
import { errorHandler, notFoundHandler } from '@/middleware/errorMiddleware';
import { languageMiddleware } from '@/middleware/languageMiddleware';
import { syncPostman } from '@/utils/postmanSync';

// Connect to Database
connectDB();

const app = express();
const projectRoot = process.cwd();

// Health check endpoint for Render uptime (Must be first)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook Raw Body Middleware (Must be before express.json())
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

// Standard Middleware
app.use(cors({
  origin: [
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'https://exam-warrior.netlify.app'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(languageMiddleware);

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Removed mongoSanitize temporarily due to incompatibility crash

app.use(express.static(path.join(projectRoot, 'public')));

// Views setup
app.set('views', path.join(projectRoot, 'view'));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'view', 'index.html'));
});

app.use('/api/v1', apiRouter);

// Auto-generate Postman Collection on startup
setTimeout(() => {
  syncPostman(app);
}, 1000);

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
