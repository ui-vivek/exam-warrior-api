import mongoose from 'mongoose';
import { env } from './config';

const connectDB = async () => {
  try {
    if (!env.mongoUri) {
      console.error('MONGODB_URI is not defined in .env file');
      process.exit(1);
    }

    const conn = await mongoose.connect(env.mongoUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
