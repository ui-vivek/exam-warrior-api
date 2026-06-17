import mongoose from 'mongoose';
import { env } from './config';

const connectDB = async () => {
  try {
    if (!env.mongoUri) {
      console.error('MONGODB_URI is not defined in .env file');
      process.exit(1);
    }

    // Bound the connection pool and fail fast on a bad/slow primary instead of
    // letting requests hang indefinitely under load.
    const conn = await mongoose.connect(env.mongoUri, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
