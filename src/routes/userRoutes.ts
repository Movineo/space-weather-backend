import { Router, Request, Response } from 'express';
import { subscribeUser, unsubscribeUser } from '../controllers/userController';
import { PrismaClient } from '@prisma/client';
import { logger } from '../app';
import { sendSMS } from '../services/smsService';
import nodemailer from 'nodemailer';

interface UssdBody {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

interface SessionData {
  location: string;
  role?: string;
  email?: string;
  preferences: {
    geomagnetic: boolean;
    solarflare: boolean;
    radiation: boolean;
    cme: boolean;
    radioblackout: boolean;
    auroral: boolean;
  };
}

const prisma = new PrismaClient();
const sessions: { [key: string]: SessionData } = {};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const router = Router();

router.post('/subscribe', subscribeUser);
router.post('/unsubscribe', unsubscribeUser);

router.post('/ussd', async (req: Request<{}, {}, UssdBody>, res: Response) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';

  res.setTimeout(5000, () => {
    logger.warn('USSD response timed out', { sessionId });
    res.setHeader('Content-Type', 'text/plain');
    res.send('END Sorry, the request took too long. Please try again.');
    res.end();
  });

  try {
    logger.info('USSD request', { sessionId, serviceCode, phoneNumber, text, step: text.split('*').length });

    const userInput = text.split('*');
    const step = userInput.length;
    const input = userInput[userInput.length - 1] || '';

    logger.info('Parsed input', { userInput, step, input });

    if (step === 1 && input === '') {
      response = 'CON Welcome to Space Weather Alerts!\n1. Subscribe\n2. Unsubscribe\n3. Check Status';
    } else if (step === 1) {
      if (input === '1') {
        response = 'CON Where are you located? (e.g., Nairobi)';
      } else if (input === '2') {
        const user = await prisma.user.findUnique({ where: { phoneNumber } });
        if (user) {
          await prisma.user.update({ where: { phoneNumber }, data: { subscribed: false } });
          logger.info('Unsubscribed user', { phoneNumber });

          await sendSMS(phoneNumber, 'You’ve unsubscribed from Space Weather Alerts. To resubscribe, dial *384*36086#.').catch(err => {
            logger.error('Failed to send unsubscription SMS', { error: err, phoneNumber });
          });

          if (user.email) {
            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: user.email,
              subject: 'Unsubscription Confirmation - Space Weather Alerts',
              text: `Hello,\n\nYou have successfully unsubscribed from Space Weather Alerts.\n\nIf this was a mistake, you can resubscribe by dialing *384*36086#.\n\nThank you!`,
            }).catch(err => {
              logger.error('Failed to send unsubscription email', { error: err, email: user.email });
            });
          }

          response = 'END You’ve unsubscribed. You’ll get a confirmation SMS soon. Dial *384*36086# to resubscribe.';
        } else {
          response = 'END You’re not subscribed yet. Dial *1 to subscribe.';
        }
        delete sessions[sessionId];
      } else if (input === '3') {
        const user = await prisma.user.findUnique({ where: { phoneNumber } });
        if (user) {
          response = `END Your Status: ${user.subscribed ? 'Subscribed' : 'Not Subscribed'}\nLocation: ${user.location || 'Not set'}\nRole: ${user.role || 'General'}\nEmail: ${user.email || 'Not set'}\nPreferences: ${JSON.stringify(user.preferences || '{}')}`;
        } else {
          response = 'END You’re not registered. Dial *1 to subscribe.';
        }
        delete sessions[sessionId];
      } else {
        response = 'END Oops! Please pick 1, 2, or 3 only. Start again by dialing *384*36086#.';
        delete sessions[sessionId];
      }
    } else if (step === 2 && userInput[0] === '1') {
      const location = input.trim();
      if (!location) {
        response = 'CON Please enter your location (e.g., Nairobi). It can’t be empty.';
      } else if (!/^[a-zA-Z\s]+$/.test(location)) {
        response = 'CON Sorry, use only letters and spaces for your location (e.g., Nairobi). Try again.';
      } else {
        sessions[sessionId] = {
          location,
          preferences: { geomagnetic: true, solarflare: false, radiation: false, cme: false, radioblackout: false, auroral: false },
        };
        response = 'CON What’s your role?\n1. Pilot\n2. Telecom Operator\n3. Farmer\n4. General';
      }
    } else if (step === 3 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Oops! Something went wrong. Please start again by dialing *384*36086#.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      let role: string;
      if (input === '1') role = 'pilot';
      else if (input === '2') role = 'telecom';
      else if (input === '3') role = 'farmer';
      else if (input === '4') role = 'general';
      else {
        response = 'CON Sorry, pick a role using numbers 1 to 4 only (e.g., 1 for Pilot). Try again.';
        return;
      }
      sessions[sessionId] = { ...session, role };
      response = 'CON Want to add an email for alerts?\n1. Yes\n2. No';
    } else if (step === 4 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Oops! Something went wrong. Please start again by dialing *384*36086#.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];

      if (input === '1') {
        response = 'CON Enter your email (e.g., user@example.com)';
      } else if (input === '2') {
        sessions[sessionId] = { ...session, email: undefined };
        response = `CON Pick your alerts:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save`;
      } else {
        response = 'CON Sorry, use 1 or 2 only (1 for Yes, 2 for No). Try again.';
      }
    } else if (step === 5 && userInput[0] === '1' && userInput[3] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Oops! Something went wrong. Please start again by dialing *384*36086#.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const email = input.trim();
      if (!email) {
        response = 'CON Email can’t be empty. Please enter your email (e.g., user@example.com) or type 0 to go back.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response = 'CON That email doesn’t look right. Use a format like user@example.com with letters, numbers, and @domain.com. Try again or type 0 to go back.';
      } else if (input === '0') {
        response = 'CON Want to add an email for alerts?\n1. Yes\n2. No';
      } else {
        sessions[sessionId] = { ...session, email };
        response = `CON Pick your alerts:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save`;
      }
    } else if (step >= 6 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Oops! Something went wrong. Please start again by dialing *384*36086#.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const { location, role, email, preferences } = session;

      if (input === '1' || input === '2' || input === '3' || input === '4' || input === '5' || input === '6') {
        const key = input === '1' ? 'geomagnetic' :
                   input === '2' ? 'solarflare' :
                   input === '3' ? 'radiation' :
                   input === '4' ? 'cme' :
                   input === '5' ? 'radioblackout' :
                   'auroral';
        preferences[key] = !preferences[key];
        sessions[sessionId] = { ...session, preferences };
        response = `CON Alerts updated! Pick again:\n1. Geomagnetic (${preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${preferences.auroral ? 'On' : 'Off'})\n7. Save`;
      } else if (input === '7') {
        if (!location || !role) {
          response = 'END Oops! Something went wrong. Please start again by dialing *384*36086#.';
          delete sessions[sessionId];
          return;
        }
        const user = await prisma.user.upsert({
          where: { phoneNumber },
          update: { location, subscribed: true, role, email, preferences },
          create: { phoneNumber, location, subscribed: true, role, email, preferences },
        });
        logger.info('Upsert result', user);

        await sendSMS(phoneNumber, 'You’re subscribed to Space Weather Alerts! You’ll get alerts soon.').catch(err => {
          logger.error('Failed to send subscription SMS', { error: err, phoneNumber });
        });

        if (email) {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Welcome to Space Weather Alerts!',
            text: `Hi there,\n\nYou’re now subscribed to Space Weather Alerts!\n\nDetails:\n- Location: ${location}\n- Role: ${role}\n- Alerts: ${JSON.stringify(preferences)}\n\nYou’ll get SMS and critical alerts via email at ${email}.\n\nTo unsubscribe, dial *384*36086#.`,
          }).catch(err => {
            logger.error('Failed to send subscription email', { error: err, email });
          });
        } else {
          await sendSMS(phoneNumber, 'No email added. You’ll only get SMS alerts.').catch(err => {
            logger.error('Failed to send no-email SMS', { error: err, phoneNumber });
          });
        }

        response = `END You’re all set in ${location} as a ${role}! Alerts: ${JSON.stringify(preferences)}`;
        delete sessions[sessionId];
      } else {
        response = 'CON Sorry, use numbers 1 to 7 only to pick alerts or save (e.g., 1 for Geomagnetic). Try again.';
      }
    } else {
      logger.warn('Invalid input or step', { text, userInput, step, input });
      response = 'END Oops! Please start again by dialing *384*36086# and use only numbers.';
      delete sessions[sessionId];
    }
  } catch (error: any) {
    logger.error('USSD error', { message: error.message, stack: error.stack, meta: error.meta });
    response = 'END Something went wrong. Please try again by dialing *384*36086#.';
    delete sessions[sessionId];
  }

  res.setHeader('Content-Type', 'text/plain');
  logger.info('Sending USSD response', { sessionId, response });
  res.send(response || 'END No response generated.');
  res.end();
});

export default router;
