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

const USSD_FORMAT_DESC = 'A USSD code is typically in the format *<service_code>*<option_code># (e.g., *123*45#).';

router.post('/ussd', async (req: Request<{}, {}, UssdBody>, res: Response) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';

  res.setTimeout(5000, () => {
    logger.warn('USSD response timed out', { sessionId });
    res.setHeader('Content-Type', 'text/plain');
    res.send('END Request timed out. Please try again later.');
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
          response = 'END You have successfully unsubscribed. Dial your USSD code to resubscribe.\n' + USSD_FORMAT_DESC;
        } else {
          response = 'END You are not subscribed. Dial your USSD code to subscribe.\n' + USSD_FORMAT_DESC;
        }
        delete sessions[sessionId];
      } else if (input === '3') {
        const user = await prisma.user.findUnique({ where: { phoneNumber } });
        if (user) {
          response = `END Status: ${user.subscribed ? 'Subscribed' : 'Unsubscribed'}, Location: ${user.location || 'Not set'}, Role: ${user.role || 'General'}, Email: ${user.email || 'Not set'}, Preferences: ${JSON.stringify(user.preferences || '{}')}`;
        } else {
          response = 'END Not registered. Dial your USSD code to subscribe.\n' + USSD_FORMAT_DESC;
        }
        delete sessions[sessionId];
      } else {
        response = 'END Invalid selection. Please use numbers 1, 2, or 3 only. Start again with your USSD code.\n' + USSD_FORMAT_DESC;
        delete sessions[sessionId];
      }
    } else if (step === 2 && userInput[0] === '1') {
      const location = input.trim();
      if (!location) {
        response = 'CON Location cannot be empty. Please enter a valid location (e.g., Nairobi):';
      } else if (!/^[a-zA-Z\s]+$/.test(location)) {
        response = 'CON Invalid location. Please use only letters and spaces (e.g., Nairobi). Try again:';
      } else {
        sessions[sessionId] = {
          location,
          preferences: { geomagnetic: true, solarflare: false, radiation: false, cme: false, radioblackout: false, auroral: false },
        };
        response = 'CON Select your role:\n1. Pilot\n2. Telecom Operator\n3. Farmer\n4. General';
      }
    } else if (step === 3 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
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
        response = 'CON Invalid role selection. Please use numbers 1 to 4 only to choose your role (e.g., 1 for Pilot). Try again:';
        return;
      }
      sessions[sessionId] = { ...session, role };
      response = 'CON Email for critical alerts:\n1. Provide Email\n2. Skip Email';
    } else if (step === 4 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const { location, role } = session;

      if (input === '1') {
        response = 'CON Enter your email (e.g., user@example.com):';
      } else if (input === '2') {
        sessions[sessionId] = { ...session, email: undefined };
        response = `CON Select alert preferences:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save and Subscribe`;
      } else {
        response = 'CON Invalid selection. Please use numbers 1 or 2 only (1 to provide email, 2 to skip). Try again:';
      }
    } else if (step === 5 && userInput[0] === '1' && userInput[3] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
        delete sessions[sessionId];
        return;
      }
      const session = sessions[sessionId];
      const email = input.trim();
      if (!email) {
        response = 'CON Email cannot be empty. Please enter a valid email (e.g., user@example.com) or press 0 to go back:';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response = 'CON Invalid email. Please enter a valid email address (e.g., user@example.com) using letters, numbers, and a proper @domain.com format. Try again or press 0 to go back:';
      } else {
        sessions[sessionId] = { ...session, email };
        response = `CON Select alert preferences:\n1. Geomagnetic (${session.preferences.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${session.preferences.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${session.preferences.radiation ? 'On' : 'Off'})\n4. CMEs (${session.preferences.cme ? 'On' : 'Off'})\n5. Radio Blackouts (${session.preferences.radioblackout ? 'On' : 'Off'})\n6. Auroral Activity (${session.preferences.auroral ? 'On' : 'Off'})\n7. Save and Subscribe`;
      }
    } else if (step >= 6 && userInput[0] === '1') {
      if (!sessions[sessionId]) {
        response = 'END Session expired. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
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
          response = 'END Invalid session data. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
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
        } else {
          await sendSMS(phoneNumber, 'Note: No email provided. You will only receive SMS alerts.');
        }

        response = `END Subscribed in ${location} as ${role} with preferences: ${JSON.stringify(preferences)}!`;
        delete sessions[sessionId];
      } else {
        response = 'CON Invalid input. Please use numbers 1 to 7 only to select preferences or save (e.g., 1 to toggle Geomagnetic). Try again:';
      }
    } else {
      logger.warn('Invalid input or step', { text, userInput, step, input });
      response = 'END Unexpected input. Please start again with your USSD code.\n' + USSD_FORMAT_DESC;
      delete sessions[sessionId];
    }
  } catch (error: any) {
    logger.error('USSD error', { message: error.message, stack: error.stack, meta: error.meta });
    response = 'END An error occurred. Please try again later with your USSD code.\n' + USSD_FORMAT_DESC;
    delete sessions[sessionId];
  }

  res.setHeader('Content-Type', 'text/plain');
  logger.info('Sending USSD response', { sessionId, response });
  res.send(response || 'END No response generated.');
  res.end();
});

export default router;