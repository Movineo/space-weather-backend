import { PrismaClient } from '@prisma/client';
import { fetchSpaceWeatherEvents, SpaceWeatherEvent } from './noaaService';
import { sendSMS } from './smsService';
import nodemailer from 'nodemailer';
import { logger } from '../app';

const prisma = new PrismaClient();
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const startAlertScheduler = () => {
  const poll = async () => {
    try {
      const users = await prisma.user.findMany({ where: { subscribed: true } });
      if (users.length === 0) {
        logger.info('No subscribed users found');
        return;
      }

      for (const user of users) {
        const events = await fetchSpaceWeatherEvents(user.phoneNumber);
        if (events.length === 0) {
          logger.info(`No events for user ${user.phoneNumber} at location ${user.location}`);
          continue;
        }

        for (const event of events) {
          const recentAlert = await prisma.alert.findFirst({
            where: {
              type: event.type,
              sentAt: {
                gte: new Date(Date.now() - 5 * 60 * 1000),
                lte: new Date(),
              },
            },
          });

          if (!recentAlert) {
            const smsPromises: Promise<void>[] = [];
            const emailPromises: Promise<void>[] = [];

            const prefs = user.preferences as { [key: string]: boolean } || {};
            const isRelevant = prefs[event.type] !== false && (event.relevantToRoles.includes(user.role || 'general'));

            if (isRelevant) {
              let targetedMessage = `${event.level}: ${event.message}`;
              if (user.role === 'pilot') targetedMessage += ' Pilots: Check flight plans.';
              else if (user.role === 'telecom') targetedMessage += ' Telecom: Monitor lines.';
              else if (user.role === 'farmer') targetedMessage += ' Farmers: Prepare for power issues.';

              smsPromises.push(
                sendSMS(user.phoneNumber, targetedMessage).catch(err => {
                  logger.error('Failed to send SMS', { error: err, phoneNumber: user.phoneNumber });
                  throw err;
                })
              );

              if (event.level === 'Critical' && user.email) {
                emailPromises.push(
                  transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: user.email,
                    subject: `Critical Alert: ${event.type.toUpperCase()}`,
                    text: targetedMessage,
                  })
                  .then(() => undefined) // Convert Promise<SentMessageInfo> to Promise<void>
                  .catch(err => {
                    logger.error('Failed to send email', { error: err, email: user.email });
                    throw err;
                  })
                );
              }
            }

            await Promise.all([...smsPromises, ...emailPromises]);

            const alert = await prisma.alert.create({
              data: {
                message: event.message,
                sentAt: new Date(),
                level: event.level,
                type: event.type,
                userId: user.id,
              },
            });

            if (smsPromises.length > 0) {
              await prisma.alertDelivery.create({
                data: {
                  alertId: alert.id,
                  phoneNumber: user.phoneNumber,
                  status: 'SENT',
                },
              });
            }

            if (emailPromises.length > 0) {
              await prisma.alertDelivery.create({
                data: {
                  alertId: alert.id,
                  phoneNumber: user.phoneNumber,
                  status: 'EMAIL_SENT',
                },
              });
            }

            logger.info(`Alert sent for event ${event.id} (Level: ${event.level}, Type: ${event.type}) to ${user.phoneNumber} at ${user.location}`);
          } else {
            logger.info(`Skipped duplicate alert for ${event.id} (within 5 minutes)`);
          }
        }
      }
    } catch (error) {
      logger.error('Error in alert scheduler', { error });
    }
  };

  poll();
  setInterval(poll, 30 * 60 * 1000);
};
