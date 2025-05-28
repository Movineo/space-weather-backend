import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { sendSMS } from '../services/smsService';
import { logger } from '../app';

const router = Router();
const prisma = new PrismaClient();

router.get('/history/:phoneNumber', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.params;
    const alerts = await prisma.alert.findMany({
      where: { userId: (await prisma.user.findUnique({ where: { phoneNumber } }))?.id },
      take: 10,
      orderBy: { sentAt: 'desc' },
    });
    logger.info('Alert history retrieved', { phoneNumber, count: alerts.length });
    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching alert history', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/send', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const users = await prisma.user.findMany({ where: { subscribed: true } });
    const smsPromises = users.map(user => sendSMS(user.phoneNumber, message));
    await Promise.all(smsPromises);
    logger.info('Manual alert sent', { message });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error sending manual alert', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/delivery-report', async (req: Request, res: Response) => {
  try {
    const { id, status, phoneNumber } = req.body;

    // Validate input
    if (!id || !status || !phoneNumber) {
      logger.warn('Invalid delivery report data', { id, status, phoneNumber });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const alertId = parseInt(id, 10);
    if (isNaN(alertId)) {
      logger.warn('Invalid alertId in delivery report', { id });
      return res.status(400).json({ error: 'Invalid alertId' });
    }

    // Verify the Alert exists
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      logger.warn('Alert not found for delivery report', { alertId });
      return res.status(404).json({ error: 'Alert not found' });
    }

    // Create delivery report with explicit receivedAt
    await prisma.alertDelivery.create({
      data: {
        alertId,
        phoneNumber,
        status,
        receivedAt: new Date(),
      },
    });

    logger.info('Delivery report received', { id, status, phoneNumber });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Error processing delivery report', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        details: error.meta || error,
      },
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
