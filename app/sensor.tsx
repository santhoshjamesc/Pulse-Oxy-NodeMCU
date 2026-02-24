import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Animated,
  Easing,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, addDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { fetchESPData, startMeasurement, cancelMeasurement, ESPData } from "../esp";

// ── Clinical assessment ────────────────────────────────────────────────────────

type Assessment = {
  label: string;
  detail: string;
  color: string;
  bg: string;
  border: string;
  urgent: boolean;
};

function assess(hr: number, spo2: number): Assessment {
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

function isReadingValid(data: ESPData): boolean {
  return data.heartRate > 0 && data.spo2 > 0 && data.hrValid > 0 && data.spo2Valid > 0;
}

// ── Component ──────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "skipped" | "error";

export default function SensorScreen() {
  const { patientId, patientName } = useLocalSearchParams<{
    patientId: string;
    patientName: string;
  }>();
  const router = useRouter();

  const [deviceIP, setDeviceIP] = useState("192.168.1.50");
  const [data, setData] = useState<ESPData | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const IP_KEY = `device_ip_${patientId}`;

  useEffect(() => {
    AsyncStorage.getItem(IP_KEY).then((storedIP) => {
      if (storedIP) setDeviceIP(storedIP);
    });
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      pulseLoop.current?.stop();
    };
  }, []);

  const handleIPChange = (value: string) => {
    setDeviceIP(value);
    AsyncStorage.setItem(IP_KEY, value);
  };

  const startPulse = () => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  };

  const stopPulse = () => {
    pulseLoop.current?.stop();
    Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };

  const autoSave = async (finalData: ESPData) => {
    if (!auth.currentUser || !patientId) return;

    if (!isReadingValid(finalData)) {
      setSaveState("skipped");
      return;
    }

    setSaveState("saving");
    try {
      await addDoc(
        collection(db, "users", auth.currentUser.uid, "patients", patientId, "records"),
        {
          heartRate: finalData.heartRate,
          spo2: finalData.spo2,
          status: finalData.status,
          totalSamples: finalData.totalSamples,
          hrValid: finalData.hrValid,
          spo2Valid: finalData.spo2Valid,
          createdAt: new Date(),
        }
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const pollData = async () => {
    try {
      const res = await fetchESPData(deviceIP);
      setData(res);
      setError("");
      if (!res.running && res.totalSamples > 0) stopMeasure(res);
    } catch {
      setError("Cannot reach device. Check the IP address.");
    }
  };

  const handleStart = async () => {
    setError("");
    setSaveState("idle");
    setData(null);
    setMeasuring(true);
    startPulse();
    try {
      await startMeasurement(deviceIP, patientName as string);
    } catch {
      setError("Failed to start device. Check IP address.");
      setMeasuring(false);
      stopPulse();
      return;
    }
    intervalRef.current = setInterval(pollData, 3000);
  };

  const stopMeasure = (finalData?: ESPData) => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setMeasuring(false);
    stopPulse();
    if (finalData) {
      setData(finalData);
      autoSave(finalData);
    }
  };

  const handleCancel = async () => {
    stopMeasure();
    try { await cancelMeasurement(deviceIP); } catch {}
    setData(null);
    setSaveState("idle");
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  const assessment = data && isReadingValid(data)
    ? assess(data.heartRate, data.spo2)
    : null;

  const saveInfo: { text: string; color: string } | null = (() => {
    switch (saveState) {
      case "saving":  return { text: "💾  Saving to records…",              color: "#6366f1" };
      case "saved":   return { text: "✓  Saved to records automatically",   color: "#16a34a" };
      case "skipped": return { text: "⚠️  Not saved — invalid reading",      color: "#d97706" };
      case "error":   return { text: "✕  Save failed — tap to retry",       color: "#dc2626" };
      default:        return null;
    }
  })();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Measuring vitals for</Text>
            <Text style={styles.title}>{patientName ?? "Patient"}</Text>
          </View>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        {/* Device IP Card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Device IP Address</Text>
          <TextInput
            value={deviceIP}
            onChangeText={handleIPChange}
            style={styles.ipInput}
            placeholder="192.168.1.50"
            placeholderTextColor="#94a3b8"
            editable={!measuring}
          />
        </View>

        {/* Vitals Card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Live Readings</Text>

          <View style={styles.hrRow}>
            <Animated.View style={[styles.hrOrb, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.hrIcon}>❤️</Text>
              <Text style={styles.hrValue}>{data?.heartRate ?? "—"}</Text>
              <Text style={styles.hrUnit}>bpm</Text>
            </Animated.View>

            <View style={styles.sideMetrics}>
              <View style={styles.metricBox}>
                <Text style={styles.metricIcon}>🫁</Text>
                <Text style={styles.metricValue}>{data?.spo2 ?? "—"}</Text>
                <Text style={styles.metricLabel}>SpO₂ %</Text>
              </View>
              <View style={[styles.metricBox, { marginTop: 10 }]}>
                <Text style={styles.metricIcon}>📊</Text>
                <Text style={styles.metricValue}>{data?.totalSamples ?? "0"}</Text>
                <Text style={styles.metricLabel}>Samples</Text>
              </View>
            </View>
          </View>

          {measuring && (
            <View style={styles.measuringRow}>
              <ActivityIndicator size="small" color="#6366f1" />
              <Text style={styles.measuringText}>Measuring… keep finger still</Text>
            </View>
          )}
        </View>

        {/* Clinical Assessment */}
        {assessment && (
          <View style={[styles.assessmentCard, { backgroundColor: assessment.bg, borderColor: assessment.border }]}>
            <Text style={[styles.assessmentLabel, { color: assessment.color }]}>
              {assessment.label}
            </Text>
            <Text style={[styles.assessmentDetail, { color: assessment.color }]}>
              {assessment.detail}
            </Text>
            {assessment.urgent && (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentText}>⚡ Immediate medical attention recommended</Text>
              </View>
            )}
          </View>
        )}

        {/* Save Status */}
        {saveInfo && (
          <TouchableOpacity
            style={[styles.saveStatusRow, { borderColor: saveInfo.color + "44", backgroundColor: saveInfo.color + "11" }]}
            onPress={saveState === "error" ? () => data && autoSave(data) : undefined}
            activeOpacity={saveState === "error" ? 0.7 : 1}
          >
            {saveState === "saving" && (
              <ActivityIndicator size="small" color={saveInfo.color} style={{ marginRight: 8 }} />
            )}
            <Text style={[styles.saveStatusText, { color: saveInfo.color }]}>
              {saveInfo.text}
            </Text>
          </TouchableOpacity>
        )}

        {/* Error */}
        {error !== "" && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️  {error}</Text>
          </View>
        )}

        {/* Action Buttons */}
        {!measuring ? (
          <TouchableOpacity style={styles.primaryButton} onPress={handleStart} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>▶  Start Measurement</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleCancel} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>⏹  Cancel</Text>
          </TouchableOpacity>
        )}

        <View style={styles.tipCard}>
          <Text style={styles.tipText}>
            💡 Place finger firmly on sensor, tap Start, and wait for the device to finish. Results save automatically when both readings are valid.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { padding: 20, paddingBottom: 48 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    marginTop: 8,
  },
  greeting: { fontSize: 15, color: "#64748b", fontWeight: "500", marginBottom: 2 },
  title: { fontSize: 28, fontWeight: "800", color: "#0f172a", letterSpacing: -0.5 },
  backBtn: { backgroundColor: "#f1f5f9", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, marginTop: 4 },
  backText: { color: "#334155", fontSize: 14, fontWeight: "600" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardLabel: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  ipInput: {
    backgroundColor: "#f1f5f9",
    color: "#0f172a",
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  hrRow: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 14 },
  hrOrb: {
    flex: 1,
    backgroundColor: "#fef2f2",
    borderRadius: 20,
    paddingVertical: 24,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#fecaca",
  },
  hrIcon: { fontSize: 28, marginBottom: 4 },
  hrValue: { fontSize: 46, fontWeight: "800", color: "#dc2626", letterSpacing: -2, lineHeight: 52 },
  hrUnit: { fontSize: 14, color: "#ef4444", fontWeight: "600", marginTop: 2 },

  sideMetrics: { flex: 0.55 },
  metricBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  metricIcon: { fontSize: 20, marginBottom: 4 },
  metricValue: { fontSize: 22, fontWeight: "800", color: "#0f172a", letterSpacing: -0.5 },
  metricLabel: { fontSize: 11, color: "#94a3b8", fontWeight: "600", marginTop: 2 },

  measuringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#eef2ff",
    borderRadius: 12,
    padding: 12,
  },
  measuringText: { color: "#4f46e5", fontSize: 14, fontWeight: "600" },

  // Assessment
  assessmentCard: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
  },
  assessmentLabel: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  assessmentDetail: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 20,
    opacity: 0.85,
  },
  urgentBadge: {
    marginTop: 12,
    backgroundColor: "#dc262615",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  urgentText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#dc2626",
  },

  // Save status
  saveStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 14,
    borderWidth: 1.5,
  },
  saveStatusText: {
    fontSize: 14,
    fontWeight: "700",
  },

  errorCard: {
    backgroundColor: "#fef2f2",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#fecaca",
  },
  errorText: { color: "#dc2626", fontSize: 14, fontWeight: "600" },

  primaryButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#6366f1",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryButtonText: { color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: 0.3 },

  secondaryButton: {
    backgroundColor: "#f1f5f9",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  secondaryButtonText: { color: "#334155", fontSize: 17, fontWeight: "700" },

  tipCard: {
    backgroundColor: "#f1f5f9",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 4,
  },
  tipText: { fontSize: 13, color: "#64748b", lineHeight: 20, fontWeight: "500" },
});