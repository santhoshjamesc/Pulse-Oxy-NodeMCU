import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
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
import { assess, isReadingValid } from "./assessment";
import { styles } from "./styles";

// ── Types ──────────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "skipped" | "error";

// ── Component ──────────────────────────────────────────────────────────────────

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