import AfricasTalking from 'africastalking';
import dotenv from 'dotenv';

dotenv.config();

const africasTalking = AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY!,
  username: process.env.AFRICASTALKING_USERNAME!,
});

export const sendSMS = async (phoneNumber: string, message: string): Promise<void> => {
  try {
    const senderId = process.env.AFRICASTALKING_SENDER_ID;
    if (!senderId) {
      throw new Error('AFRICASTALKING_SENDER_ID is not defined in environment variables');
    }

    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    console.log(`Attempting to send SMS to: ${phoneNumber}, message: ${message}, from: ${senderId}`);

    const result = await africasTalking.SMS.send({
      to: [phoneNumber],
      message,
      from: senderId,
    });

    console.log(`SMS sent successfully to ${phoneNumber}:`, result);
  } catch (error: any) {
    console.error(`Failed to send SMS to ${phoneNumber}:`, {
      message: error.message,
      stack: error.stack,
      response: error.response ? error.response.data : null,
    });
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};
