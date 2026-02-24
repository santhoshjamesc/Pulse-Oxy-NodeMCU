// app/lib/esp.ts
export interface ESPData {
  heartRate: number;
  spo2: number;
  hrValid: number;
  spo2Valid: number;
  totalSamples: number;
  running: boolean;
  status: string;
}

/**
 * Fetch sensor data from ESP device
 * @param deviceIP IP of ESP (from OLED on boot)
 */
export const fetchESPData = async (deviceIP: string): Promise<ESPData> => {
  console.log(`[ESP] Fetching data from device at ${deviceIP}`);
  try {
    const url = `http://${deviceIP}/data`;
    console.log(`[ESP] GET ${url}`);
    const res = await fetch(url);

    console.log(`[ESP] Response status: ${res.status}`);
    if (!res.ok) throw new Error(`Device not reachable, status ${res.status}`);

    const json = await res.json();
    console.log(`[ESP] Data received:`, json);
    return json as ESPData;
  } catch (err) {
    console.error(`[ESP] Failed to fetch data from ${deviceIP}:`, err);
    throw err;
  }
};

/**
 * Start measurement
 * @param deviceIP IP of ESP
 * @param patientName Optional name sent to OLED display
 */
export const startMeasurement = async (deviceIP: string, patientName?: string) => {
  console.log(`[ESP] Starting measurement on device ${deviceIP} for patient: ${patientName ?? "<no name>"}`);
  try {
    const url = `http://${deviceIP}/start`;
    const payload = { name: patientName ?? "" };
    console.log(`[ESP] POST ${url} with payload:`, payload);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log(`[ESP] Response status: ${res.status}`);
    if (!res.ok) throw new Error(`Failed to start measurement, status ${res.status}`);
    
    const responseText = await res.text();
    console.log(`[ESP] Response body: ${responseText}`);
  } catch (err) {
    console.error(`[ESP] Failed to start measurement on ${deviceIP}:`, err);
    throw err;
  }
};

/**
 * Cancel measurement
 * @param deviceIP IP of ESP
 */
export const cancelMeasurement = async (deviceIP: string) => {
  console.log(`[ESP] Cancelling measurement on device ${deviceIP}`);
  try {
    const url = `http://${deviceIP}/cancel`;
    console.log(`[ESP] POST ${url}`);

    const res = await fetch(url, { method: "POST" });
    console.log(`[ESP] Response status: ${res.status}`);
    if (!res.ok) throw new Error(`Failed to cancel measurement, status ${res.status}`);

    const responseText = await res.text();
    console.log(`[ESP] Response body: ${responseText}`);
  } catch (err) {
    console.error(`[ESP] Failed to cancel measurement on ${deviceIP}:`, err);
    throw err;
  }
};