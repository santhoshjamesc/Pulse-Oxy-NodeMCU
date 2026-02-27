// app/lib/esp.ts
import axios from 'axios';

// ESP8266 is slow — give it time to respond
const esp = axios.create({
  timeout: 5000,   // 5s timeout
});

export interface ESPData {
  heartRate: number;
  spo2: number;
  hrValid: number;
  spo2Valid: number;
  totalSamples: number;
  running: boolean;
  status: string;
}

// Retry helper — ESP8266 can occasionally miss a request under load
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[ESP] Retry ${i + 1}/${retries - 1}...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unreachable');
};

export const fetchESPData = async (deviceIP: string): Promise<ESPData> => {
  console.log(`[ESP] Fetching data from device at ${deviceIP}`);
  const url = `http://${deviceIP}/data`;
  const res = await withRetry(() => esp.get<ESPData>(url));
  console.log(`[ESP] Data received:`, res.data);
  return res.data;
};

export const startMeasurement = async (
  deviceIP: string,
  patientName?: string
): Promise<void> => {
  console.log(`[ESP] Starting measurement on device ${deviceIP}`);

  const url = `http://${deviceIP}/start`;
  const payload = { name: patientName ?? "" };

  try {
    const res = await withRetry(() => esp.post(url, payload));
    console.log(`[ESP] Response status: ${res.status}`);
  } catch (error: any) {
    console.log("[ESP] FULL ERROR OBJECT:");
    console.log("message:", error?.message);
    console.log("code:", error?.code);
    console.log("config:", error?.config);
    console.log("request:", error?.request);
    console.log("response:", error?.response);
    console.log("toJSON:", error?.toJSON?.());

    throw error;
  }
};

export const cancelMeasurement = async (deviceIP: string): Promise<void> => {
  console.log(`[ESP] Cancelling measurement on device ${deviceIP}`);
  const url = `http://${deviceIP}/cancel`;
  const res = await withRetry(() => esp.post(url));
  console.log(`[ESP] Response status: ${res.status}`);
};