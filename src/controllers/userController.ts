import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const subscribeUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber, location } = req.body;
    if (!phoneNumber || !location) {
      return res.status(400).json({ error: 'Phone number and location are required' });
    }

    const user = await prisma.user.upsert({
      where: { phoneNumber },
      update: { location, subscribed: true },
      create: { phoneNumber, location, subscribed: true },
    });

    res.status(201).json({ message: 'User subscribed successfully', user });
  } catch (error) {
    next(error);
  }
};

export const unsubscribeUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const user = await prisma.user.update({
      where: { phoneNumber },
      data: { subscribed: false },
    });

    res.json({ message: 'User unsubscribed successfully', user });
  } catch (error) {
    next(error);
  }
};