import axios from 'axios';
import { logger } from '../app';

export interface SpaceWeatherEvent {
  id: string;
  message: string;
  issuedAt: string;
  level: 'Watch' | 'Warning' | 'Critical';
  type: 'geomagnetic' | 'solarflare' | 'radiation' ;
}

export const fetchSpaceWeatherEvents = async (): Promise<SpaceWeatherEvent[]> => {
  const events: SpaceWeatherEvent[] = [];

  try {
    // Geomagnetic (Kp index)
    const kpResponse = await axios.get('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    const kpData = kpResponse.data;
    for (const item of kpData) {
      const kpValue = parseFloat(item.kp_index);
      const timeTag = item.time_tag;
      if (kpValue >= 4) { // Reverted to original threshold
        let level: 'Watch' | 'Warning' | 'Critical';
        if (kpValue >= 7) level = 'Critical';
        else if (kpValue >= 5) level = 'Warning';
        else level = 'Watch';
        const message = `${level} Alert: ${level === 'Critical' ? 'Severe' : level === 'Warning' ? 'Moderate to Strong' : 'Possible'} geomagnetic storm with Kp ${kpValue}. Impacts: ${level === 'Critical' ? 'widespread outages' : level === 'Warning' ? 'grid fluctuations' : 'minor disruptions'}. Issued at ${timeTag}.`;
        events.push({ id: timeTag, message, issuedAt: timeTag, level, type: 'geomagnetic' });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch geomagnetic data', { error });
  }

  try {
    // Solar Flares (using observed solar cycle indices as a proxy)
    const flareResponse = await axios.get('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json');
    const flareData = flareResponse.data;
    for (const item of flareData) {
      const flareIntensity = parseFloat(item.radio_flux) || 0;
      const timeTag = item.time_tag;
      if (flareIntensity > 150) { // Reverted to original threshold
        const level = flareIntensity > 200 ? 'Critical' : 'Warning';
        const message = `${level} Alert: Significant solar flare detected with radio flux ${flareIntensity}. Impacts: ${level === 'Critical' ? 'severe radio blackouts' : 'moderate disruptions'}. Issued at ${timeTag}.`;
        events.push({ id: timeTag, message, issuedAt: timeTag, level, type: 'solarflare' });
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch solar flare data', { error });
  }



  // Note: Radiation Storms data source is currently unavailable

  // Radiation Storms block commented out due to persistent 404
  // try {
  //   const radiationResponse = await axios.get('https://services.swpc.noaa.gov/json/goes/primary/integral-proton-flux-5m.json');
  //   const radiationData = radiationResponse.data;
  //   for (const item of radiationData) {
  //     const protonFlux = parseFloat(item.proton_flux) || 0;
  //     const timeTag = item.time_tag;
  //     if (protonFlux > 10) {
  //       const level = protonFlux > 100 ? 'Critical' : 'Warning';
  //       const message = `${level} Alert: Radiation storm detected with proton flux ${protonFlux}. Impacts: ${level === 'Critical' ? 'severe radiation hazards' : 'moderate risks'}. Issued at ${timeTag}.`;
  //       events.push({ id: timeTag, message, issuedAt: timeTag, level, type: 'radiation' });
  //     }
  //   }
  // } catch (error) {
  //   logger.warn('Failed to fetch radiation data', { error });
  // }

  

  if (events.length === 0) {
    logger.info('No significant space weather events found');
  }

  return events;
};
