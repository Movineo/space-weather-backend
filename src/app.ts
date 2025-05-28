import express, { Express } from 'express';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes';
import alertRoutes from './routes/alertRoutes';
import { errorHandler } from './middleware/errorHandler';
import { startAlertScheduler } from './services/alertScheduler';
import { PrismaClient } from '@prisma/client';
import winston from 'winston';

dotenv.config();

const app: Express = express();
const prisma = new PrismaClient();

// Trust proxy for ngrok
app.set('trust proxy', true);

// Parse JSON and URL-encoded bodies first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting after body parsing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Logging setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

app.use('/api/users', userRoutes);
app.use('/api/alerts', alertRoutes);

app.use(errorHandler);
startAlertScheduler();

export default app;
export { logger };
