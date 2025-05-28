import { Router, Request, Response } from 'express';
import { subscribeUser, unsubscribeUser } from '../controllers/userController';
import { PrismaClient } from '@prisma/client';
import { logger } from '../app';

interface UssdBody {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

const prisma = new PrismaClient();
const sessions: { [key: string]: { location: string; role?: string } } = {};

const router = Router();

router.post('/subscribe', subscribeUser);
router.post('/unsubscribe', unsubscribeUser);

router.post('/ussd', async (req: Request<{}, {}, UssdBody>, res: Response) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';

  // Set response timeout to prevent hanging
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
    } else if (step === 1 && input === '1') {
      response = 'CON Enter your location (e.g., Nairobi):';
    } else if (step === 2 && userInput[0] === '1') {
      const location = input.trim();
      if (!location) {
        response = 'CON Location cannot be empty. Enter your location:';
      } else {
        sessions[sessionId] = { location, role: '' };
        response = 'CON Select role:\n1. Pilot\n2. Telecom Operator\n3. Farmer\n4. General';
      }
    } else if (step === 3 && userInput[0] === '1') {
      const session = sessions[sessionId] || { location: '', role: '' };
      const { location } = session;
      const role = input === '1' ? 'pilot' : input === '2' ? 'telecom' : input === '3' ? 'farmer' : 'general';
      sessions[sessionId] = { ...session, role };
      response = 'CON Select alert preferences:\n1. Geomagnetic (On)\n2. Solar Flares (Off)\n3. Radiation Storms (Off)\n4. Next';
    } else if (step === 4 && userInput[0] === '1') {
      const session = sessions[sessionId] || { location: '', role: 'general' };
      const { location, role } = session;
      const prefs = { geomagnetic: true, solarflare: false, radiation: false };
      if (input === '1' || input === '2' || input === '3') {
        prefs[input === '1' ? 'geomagnetic' : input === '2' ? 'solarflare' : 'radiation'] = !prefs[input === '1' ? 'geomagnetic' : input === '2' ? 'solarflare' : 'radiation'];
        response = `CON Updated preferences. Select:\n1. Geomagnetic (${prefs.geomagnetic ? 'On' : 'Off'})\n2. Solar Flares (${prefs.solarflare ? 'On' : 'Off'})\n3. Radiation Storms (${prefs.radiation ? 'On' : 'Off'})\n4. Next`;
      } else if (input === '4') {
        const user = await prisma.user.upsert({
          where: { phoneNumber },
          update: { location, subscribed: true, role, preferences: prefs },
          create: { phoneNumber, location, subscribed: true, role, preferences: prefs },
        });
        logger.info('Upsert result', user);
        response = `END Subscribed in ${location} as ${role} with preferences: ${JSON.stringify(prefs)}!`;
        delete sessions[sessionId];
      }
    } else if (step === 1 && input === '2') {
      const user = await prisma.user.findUnique({ where: { phoneNumber } });
      if (user) {
        await prisma.user.update({ where: { phoneNumber }, data: { subscribed: false } });
        logger.info('Unsubscribed user', user);
        response = 'END You have unsubscribed.';
      } else {
        response = 'END You are not subscribed.';
      }
    } else if (step === 1 && input === '3') {
      const user = await prisma.user.findUnique({ where: { phoneNumber } });
      if (user) {
        response = `END Status: ${user.subscribed ? 'Subscribed' : 'Unsubscribed'}, Location: ${user.location}, Role: ${user.role || 'General'}, Preferences: ${JSON.stringify(user.preferences || '{}')}`;
      } else {
        response = 'END Not registered. Dial *1 to subscribe.';
      }
    } else {
      logger.warn('Invalid input', { text, userInput, step, input });
      response = 'END Invalid input. Try again.';
    }
  } catch (error: any) {
    logger.error('USSD error', { message: error.message, stack: error.stack, meta: error.meta });
    response = 'END An error occurred. Try again later.';
  }

  // Send response
  res.setHeader('Content-Type', 'text/plain');
  logger.info('Sending USSD response', { sessionId, response });
  res.send(response || 'END No response generated.');
  res.end();
});

export default router;
