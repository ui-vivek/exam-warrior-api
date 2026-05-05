import app from '@/lib/app';
import { env } from '@/lib/config';

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
