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
    res.send('END Request timed out.');
    res.end();
  });

  try {
    logger.info('USSD request', { sessionId, serviceCode, phoneNumber, text, step: text.split('*').length });

    const userInput = text.split('*');
    const step = userInput.length;
    const input = userInput[userInput.length - 1] || '';

    logger.info('Parsed input', { userInput, step, input });

    if (step === 1 && input === '') {
      response = 'CON Welcome to Space Weather Alerts\n1. Subscribe\n2. Unsubscribe\n3. Check Status';
    } else if (step === 1) {
      if (input === '1') {
        response = 'CON Enter your location (e.g., Nairobi):';
      } else if (input === '2') {
        const user = await prisma.user.findUnique({ where: { phoneNumber } });
        if (user) {
          await prisma.user.update({ where: { phoneNumber }, data: { subscribed: false } });
          logger.info('Unsubscribed user', { phoneNumber });
          response = 'END You have unsubscribed.';
        } else {
          response = 'END You are not subscribed.';
        }
        delete sessions[sessionId];
      } else if (input === '3') {
        const user = await prisma.user.findUnique({ where: { phoneNumber } });
        if (user) {
          response = `END Status: ${user.subscribed ? 'Subscribed' : 'Unsubscribed'}, Location: ${user.location || 'Not set'}, Role: ${user.role || 'General'}, Email: ${user.email || 'Not set'}, Preferences: ${JSON.stringify(user.preferences || '{}')}`;
        } else {
          response = 'END Not registered. Dial *1 to subscribe.';
        }
        delete sessions[sessionId];
      } else {
        response = 'END Invalid selection. Try again.';
        delete sessions[sessionId];
      }
    } else if (step === 2 && userInput[0] === '1') {
      const location = input.trim();
      if (!location) {
        response = 'CON Location cannot be empty. Enter your location:';
      } else if (!/^[a-zA-Z\s]+$/.test(location)) {
        response = 'CON Invalid location. Use letters only (e.g., Nairobi):';
      } else {
        sessions[sessionId] = {
          location,
          preferences: { geomagnetic: true, solarflare: false, radiation: false, cme: false, radioblackout: false, auroral: false },
        };
        response = 'CON Select role:\n1. Pilot\n2. Telecom Operator\n3. Farmer\n4. General';
      }
    } else if (step === 3 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Start again.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const { location } = session;
      let role: string;
      if (input === '1') role = 'pilot';
      else if (input === '2') role = 'telecom';
      else if (input === '3') role = 'farmer';
      else if (input === '4') role = 'general';
      else {
        response = 'CON Invalid role. Select role:\n1. Pilot\n2. Telecom Operator\n3. Farmer\n4. General';
        return;
      }
      sessions[sessionId] = { ...session, role };
      response = 'CON Enter your email for critical alerts (or 0 to skip):';
    } else if (step === 4 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Start again.';
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const email = input.trim();
      if (input === '0') {
        sessions[sessionId] = { ...session, email: undefined };
        response = `CON Select alert preferences:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save and Subscribe`;
      } else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response = 'CON Invalid email. Enter a valid email (e.g., user@example.com) or 0 to skip:';
      } else {
        sessions[sessionId] = { ...session, email };
        response = `CON Select alert preferences:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save and Subscribe`;
      }
    } else if (step >= 5 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Start again.';
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
        response = `CON Updated preferences. Select:\n1. Geomagnetic (${preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${preferences.auroral ? 'On' : 'Off'})\n7. Save and Subscribe`;
      } else if (input === '7') {
        if (!location || !role) {
          response = 'END Invalid session data. Start again.';
          delete sessions[sessionId];
          return;
        }
        const user = await prisma.user.upsert({
          where: { phoneNumber },
          update: { location, subscribed: true, role, email, preferences },
          create: { phoneNumber, location, subscribed: true, role, email, preferences },
        });
        logger.info('Upsert result', user);

        await sendSMS(phoneNumber, 'Thank you for subscribing to Space Weather Alerts!');
        if (email) {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Successful Subscription to Space Weather Alerts',
            text: `Thank you for subscribing to Space Weather Alerts!\n\nDetails:\n- Location: ${location}\n- Role: ${role}\n- Preferences: ${JSON.stringify(preferences)}\n\nYou will receive SMS and critical alerts via email at ${email}.`,
          }).catch(err => {
            logger.error('Failed to send subscription email', { error: err, email });
          });
        }

        response = `END Subscribed in ${location} as ${role} with preferences: ${JSON.stringify(preferences)}!`;
        delete sessions[sessionId];
      } else {
        response = 'CON Invalid input. Select:\n1. Geomagnetic\n2. Solar Flares\n3. Radiation Storms\n4. CMEs\n5. Radio Blackouts\n6. Auroral Activity\n7. Save and Subscribe';
      }
    } else {
      logger.warn('Invalid input or step', { text, userInput, step, input });
      response = 'END Invalid input. Try again.';
      delete sessions[sessionId];
    }
  } catch (error: any) {
    logger.error('USSD error', { message: error.message, stack: error.stack, meta: error.meta });
    response = 'END An error occurred. Try again later.';
    delete sessions[sessionId];
  }

  res.setHeader('Content-Type', 'text/plain');
  logger.info('Sending USSD response', { sessionId, response });
  res.send(response || 'END No response generated.');
  res.end();
});

export default router;
