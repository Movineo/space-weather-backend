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
      const events = await fetchSpaceWeatherEvents(''); // Pass a dummy phone number; will be replaced with user-specific calls
      if (events.length > 0) {
        const users = await prisma.user.findMany({ where: { subscribed: true } });

        for (const event of events) {
          // Check if an alert for this type was sent within the last 5 minutes
          const recentAlert = await prisma.alert.findFirst({
            where: {
              type: event.type,
              sentAt: {
                gte: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
                lte: new Date(),
              },
            },
          });
          if (!recentAlert) {
            const smsPromises = [];
            const emailPromises = [];

            for (const user of users) {
              const prefs = user.preferences as { [key: string]: boolean } || {};
              const isRelevant = prefs[event.type] !== false && (event.relevantToRoles.includes(user.role || 'general'));

              if (isRelevant) {
                let targetedMessage = `${event.level}: ${event.message}`;
                if (user.role === 'pilot') targetedMessage += ' Pilots: Check flight plans.';
                else if (user.role === 'telecom') targetedMessage += ' Telecom: Monitor lines.';
                else if (user.role === 'farmer') targetedMessage += ' Farmers: Prepare for power issues.';

                smsPromises.push(sendSMS(user.phoneNumber, targetedMessage));
                if (event.level === 'Critical' && user.email) {
                  emailPromises.push(
                    transporter.sendMail({
                      from: process.env.EMAIL_USER,
                      to: user.email,
                      subject: `Critical Alert: ${event.type.toUpperCase()}`,
                      text: targetedMessage,
                    })
                  );
                }
              }
            }

            await Promise.all([...smsPromises, ...emailPromises]);

            await prisma.alert.create({
              data: {
                message: event.message,
                sentAt: new Date(),
                level: event.level,
                type: event.type,
              },
            });
            logger.info(`Alert sent for event ${event.id} (Level: ${event.level}, Type: ${event.type})`);
          } else {
            logger.info(`Skipped duplicate alert for ${event.id} (within 5 minutes)`);
          }
        }
      } else {
        logger.info('No significant space weather events found');
      }
    } catch (error) {
      logger.error('Error in alert scheduler', { error });
    }
  };

  // Run immediately and then every 30 minutes
  poll();
  setInterval(poll, 30 * 60 * 1000); // 30 minutes
};
