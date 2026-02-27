import { ESPData } from "../esp";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Assessment = {
  label: string;
  detail: string;
  color: string;
  bg: string;
  border: string;
  urgent: boolean;
};

// ── Clinical assessment ────────────────────────────────────────────────────────

export function assess(hr: number, spo2: number): Assessment {
  if (spo2 < 90) return {
    label: "⛔ Critical — Emergency",
    detail: "Dangerously low oxygen saturation. Seek emergency care immediately.",
    color: "#dc2626", bg: "#fef2f2", border: "#fecaca", urgent: true,
  };
  if (spo2 < 94) return {
    label: "🔴 High Alert",
    detail: "Low blood oxygen. Doctor visit required urgently.",
    color: "#dc2626", bg: "#fef2f2", border: "#fecaca", urgent: true,
  };
  if (hr > 150) return {
    label: "⛔ Critical — Emergency",
    detail: "Severely elevated heart rate. Seek emergency care immediately.",
    color: "#dc2626", bg: "#fef2f2", border: "#fecaca", urgent: true,
  };
  if (hr < 40) return {
    label: "⛔ Critical — Emergency",
    detail: "Dangerously low heart rate. Seek emergency care immediately.",
    color: "#dc2626", bg: "#fef2f2", border: "#fecaca", urgent: true,
  };
  if (hr > 100) return {
    label: "🟡 Elevated Heart Rate",
    detail: "Heart rate above normal range (60–100 bpm). Monitor closely, consult doctor if persistent.",
    color: "#d97706", bg: "#fffbeb", border: "#fde68a", urgent: false,
  };
  if (hr < 60) return {
    label: "🟡 Low Heart Rate",
    detail: "Heart rate below normal range (60–100 bpm). Consult doctor if feeling dizzy or unwell.",
    color: "#d97706", bg: "#fffbeb", border: "#fde68a", urgent: false,
  };
  if (spo2 < 96) return {
    label: "🟡 Monitor Closely",
    detail: "Slightly low oxygen saturation. Rest and re-measure. See doctor if worsening.",
    color: "#d97706", bg: "#fffbeb", border: "#fde68a", urgent: false,
  };
  return {
    label: "🟢 Normal",
    detail: "Heart rate and oxygen saturation are within healthy range.",
    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", urgent: false,
  };
}

export function isReadingValid(data: ESPData): boolean {
  return data.heartRate > 0 && data.spo2 > 0 && data.hrValid > 0 && data.spo2Valid > 0;
}