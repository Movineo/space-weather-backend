import axios from 'axios';
import { logger } from '../app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SpaceWeatherEvent {
  id: string;
  message: string;
  issuedAt: string;
  level: 'Watch' | 'Warning' | 'Critical';
  type: 'geomagnetic' | 'solarflare' | 'radiation' | 'cme' | 'radioblackout' | 'auroral';
  relevantToRoles: string[];
}

interface Preferences {
  geomagnetic?: boolean;
  solarflare?: boolean;
  radiation?: boolean;
  cme?: boolean;
  radioblackout?: boolean;
  auroral?: boolean;
}

interface UserPreferences {
  geomagnetic: boolean;
  solarflare: boolean;
  radiation: boolean;
  cme: boolean;
  radioblackout: boolean;
  auroral: boolean;
}

export const fetchSpaceWeatherEvents = async (
  userPhoneNumber: string
): Promise<SpaceWeatherEvent[]> => {
  const events: SpaceWeatherEvent[] = [];

  // Fetch user data
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { phoneNumber: userPhoneNumber },
    });
    if (!user || !user.subscribed) {
      logger.info(`User ${userPhoneNumber} not found or not subscribed`);
      return [];
    }
  } catch (error) {
    logger.error('Failed to fetch user data', { error });
    return [];
  }

  const role = user.role || 'general';
  const userPrefs = (user.preferences || {}) as Preferences;
  const preferences: UserPreferences = {
    geomagnetic: userPrefs.geomagnetic ?? false,
    solarflare: userPrefs.solarflare ?? false,
    radiation: userPrefs.radiation ?? false,
    cme: userPrefs.cme ?? false,
    radioblackout: userPrefs.radioblackout ?? false,
    auroral: userPrefs.auroral ?? false,
  };

  // Get latitude using OpenCage Geocoding API
  let latitude = 0;
  if (user.location) {
    try {
      const geocodingResponse = await axios.get(
        `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(user.location)}&key=${process.env.OPENCAGE_API_KEY}&limit=1`
      );
      const result = geocodingResponse.data.results[0];
      if (result) {
        latitude = result.geometry.lat;
        logger.info(`Fetched latitude ${latitude} for location ${user.location}`);
      } else {
        logger.warn(`No geocoding result for ${user.location}`);
      }
    } catch (error) {
      logger.error('Failed to fetch geocoding data', { error, location: user.location });
    }
  }

  const isHighLatitude = Math.abs(latitude) > 50; // Auroral activity typically visible above 50°
  const isMidLatitude = Math.abs(latitude) > 30 && Math.abs(latitude) <= 50; // Some visibility during strong events

  try {
    // Geomagnetic (Kp index)
    const kpResponse = await axios.get('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    const kpData = kpResponse.data;
    for (const item of kpData) {
      const kpValue = parseFloat(item.kp_index);
      const timeTag = item.time_tag;
      if (kpValue >= 4 && preferences.geomagnetic) {
        let level: 'Watch' | 'Warning' | 'Critical';
        if (kpValue >= 7) level = 'Critical';
        else if (kpValue >= 5) level = 'Warning';
        else level = 'Watch';
        const roleSpecificImpact =
          role === 'telecom' ? 'potential satellite communication disruptions' :
          role === 'pilot' ? 'possible navigation system errors' :
          role === 'farmer' ? 'minor equipment interference' :
          'general disruptions';
        const message = `${level} Alert: ${level === 'Critical' ? 'Severe' : level === 'Warning' ? 'Moderate to Strong' : 'Possible'} geomagnetic storm with Kp ${kpValue}. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
        events.push({
          id: timeTag,
          message,
          issuedAt: timeTag,
          level,
          type: 'geomagnetic',
          relevantToRoles: ['telecom', 'pilot', 'farmer', 'general'],
        });
      }
      // Auroral Activity (derived from Kp for high-latitude regions)
      if (kpValue >= 5 && preferences.auroral) {
        if (isHighLatitude || (isMidLatitude && kpValue >= 7)) {
          const level = kpValue >= 7 ? 'Critical' : 'Warning';
          const roleSpecificImpact = role === 'farmer' ? 'possible livestock disorientation' : 'visible auroras may cause distractions';
          const message = `${level} Alert: Increased auroral activity due to Kp ${kpValue}. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
          events.push({
            id: `auroral-${timeTag}`,
            message,
            issuedAt: timeTag,
            level,
            type: 'auroral',
            relevantToRoles: ['farmer', 'general'],
          });
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch geomagnetic/auroral data', { error });
  }

  try {
    // Solar Flares (using radio flux)
    const flareResponse = await axios.get('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json');
    const flareData = flareResponse.data;
    for (const item of flareData) {
      const flareIntensity = parseFloat(item.radio_flux) || 0;
      const timeTag = item.time_tag;
      if (flareIntensity > 150 && preferences.solarflare) {
        const level = flareIntensity > 200 ? 'Critical' : 'Warning';
        const roleSpecificImpact =
          role === 'telecom' ? 'severe radio signal disruptions' :
          role === 'pilot' ? 'communication blackouts' :
          'general signal interference';
        const message = `${level} Alert: Significant solar flare detected with radio flux ${flareIntensity}. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
        events.push({
          id: timeTag,
          message,
          issuedAt: timeTag,
          level,
          type: 'solarflare',
          relevantToRoles: ['telecom', 'pilot', 'general'],
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch solar flare data', { error });
  }

  try {
    // Radio Blackouts (using X-ray flux)
    const xrayResponse = await axios.get('https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json');
    const xrayData = xrayResponse.data;
    for (const item of xrayData) {
      const flux = parseFloat(item.flux) || 0;
      const timeTag = item.time_tag;
      const flareClass = item.energy.includes('0.1-0.8') ? 'X-ray' : 'Other';
      if (flareClass === 'X-ray' && flux > 1e-5 && preferences.radioblackout) {
        const level = flux > 1e-4 ? 'Critical' : 'Warning';
        const roleSpecificImpact =
          role === 'telecom' ? 'severe HF radio blackouts' :
          role === 'pilot' ? 'navigation and communication failures' :
          'general radio disruptions';
        const message = `${level} Alert: ${level === 'Critical' ? 'X-class' : 'M-class'} radio blackout detected with flux ${flux}. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
        events.push({
          id: timeTag,
          message,
          issuedAt: timeTag,
          level,
          type: 'radioblackout',
          relevantToRoles: ['telecom', 'pilot', 'general'],
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch radio blackout data', { error });
  }

  try {
    // Coronal Mass Ejections (CMEs)
    const cmeResponse = await axios.get('https://services.swpc.noaa.gov/json/donki/cme.json');
    const cmeData = cmeResponse.data;
    for (const item of cmeData) {
      const speed = parseFloat(item.speed) || 0;
      const timeTag = item.startTime;
      if (speed > 500 && preferences.cme) {
        const level = speed > 1000 ? 'Critical' : 'Warning';
        const roleSpecificImpact =
          role === 'telecom' ? 'potential satellite damage' :
          role === 'pilot' ? 'increased radiation exposure' :
          role === 'farmer' ? 'possible power grid effects' :
          'general infrastructure risks';
        const message = `${level} Alert: Coronal Mass Ejection detected with speed ${speed} km/s. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
        events.push({
          id: timeTag,
          message,
          issuedAt: timeTag,
          level,
          type: 'cme',
          relevantToRoles: ['telecom', 'pilot', 'farmer', 'general'],
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch CME data', { error });
  }

  try {
    // Radiation Storms (using proton flux)
    const radiationResponse = await axios.get('https://services.swpc.noaa.gov/json/goes/primary/proton-flux-7-day.json');
    const radiationData = radiationResponse.data;
    for (const item of radiationData) {
      const protonFlux = parseFloat(item.flux) || 0;
      const timeTag = item.time_tag;
      if (protonFlux > 10 && preferences.radiation) {
        const level = protonFlux > 100 ? 'Critical' : 'Warning';
        const roleSpecificImpact =
          role === 'pilot' ? 'significant radiation hazards' :
          role === 'telecom' ? 'satellite operation risks' :
          'general radiation concerns';
        const message = `${level} Alert: Radiation storm detected with proton flux ${protonFlux}. Impacts: ${roleSpecificImpact}. Issued at ${timeTag}.`;
        events.push({
          id: timeTag,
          message,
          issuedAt: timeTag,
          level,
          type: 'radiation',
          relevantToRoles: ['pilot', 'telecom', 'general'],
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch radiation data', { error });
  }

  if (events.length === 0) {
    logger.info(`No significant space weather events found for user ${userPhoneNumber} at latitude ${latitude}`);
  }

  return events;
};