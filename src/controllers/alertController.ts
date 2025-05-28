import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { sendSMS } from '../services/smsService';

const prisma = new PrismaClient();

export const sendAlert = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Alert message is required' });
    }

    const users = await prisma.user.findMany({ where: { subscribed: true } });
    if (users.length === 0) {
      const alert = await prisma.alert.create({
        data: { message, sentAt: new Date() },
      });
      return res.json({ message: 'No subscribed users found, alert recorded', alert });
    }

    const smsPromises = users.map(user =>
      sendSMS(user.phoneNumber, `Space Weather Alert: ${message}`)
    );

    await Promise.all(smsPromises);

    const alert = await prisma.alert.create({
      data: { message, sentAt: new Date() },
    });

    res.json({ message: `Alerts sent to ${users.length} user(s)`, alert });
  } catch (error) {
    next(error);
  }
};