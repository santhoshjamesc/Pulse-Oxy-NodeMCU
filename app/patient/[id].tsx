import { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db, auth } from "../../firebase";
import Svg, { Polyline, Line, Circle, Text as SvgText } from "react-native-svg";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_W = SCREEN_WIDTH - 48 - 36; // card padding + inner padding
const GRAPH_H = 140;
const PAD = { top: 16, bottom: 24, left: 34, right: 8 };

type Record = {
  id: string;
  heartRate: number;
  spo2: number;
  status: string;
  totalSamples?: number;
  createdAt: any;
};
type DateRange = "7d" | "30d" | "90d" | "all";

function parseDate(ts: any): Date {
  if (!ts) return new Date(0);
  if (ts?.toDate) return ts.toDate();
  return new Date(ts);
}

function LineGraph({
  data,
  field,
  color,
  unit,
  yMin,
  yMax,
}: {
  data: Record[];
  field: "heartRate" | "spo2";
  color: string;
  unit: string;
  yMin: number;
  yMax: number;
}) {
  if (data.length < 2) {
    return (
      <View style={graphStyles.empty}>
        <Text style={graphStyles.emptyText}>Need at least 2 readings to show graph</Text>
      </View>
    );
  }

  const values = data.map((r) => r[field]);
  const minVal = Math.min(yMin, ...values);
  const maxVal = Math.max(yMax, ...values);
  const range = maxVal - minVal || 1;

  const W = GRAPH_W - PAD.left - PAD.right;
  const H = GRAPH_H - PAD.top - PAD.bottom;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * W;
  const toY = (v: number) => PAD.top + H - ((v - minVal) / range) * H;

  const points = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const yLabels = [minVal, Math.round((minVal + maxVal) / 2), maxVal];
  const last = values[values.length - 1];
  const first = values[0];
  const delta = last - first;

  return (
    <View>
      <Svg width={GRAPH_W} height={GRAPH_H}>
        {/* Grid */}
        {yLabels.map((lv, i) => (
          <Line
            key={i}
            x1={PAD.left} y1={toY(lv)}
            x2={GRAPH_W - PAD.right} y2={toY(lv)}
            stroke="#f1f5f9" strokeWidth="1.5"
          />
        ))}
        {/* Y labels */}
        {yLabels.map((lv, i) => (
          <SvgText key={i} x={PAD.left - 4} y={toY(lv) + 4} fontSize="10" fill="#94a3b8" textAnchor="end">
            {lv}
          </SvgText>
        ))}
        {/* Line */}
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dots */}
        {values.map((v, i) => (
          <Circle
            key={i}
            cx={toX(i)} cy={toY(v)}
            r={data.length <= 12 ? 4 : 2.5}
            fill={color}
            stroke="#fff"
            strokeWidth="1.5"
          />
        ))}
        {/* X date labels */}
        <SvgText x={PAD.left} y={GRAPH_H - 4} fontSize="9" fill="#94a3b8" textAnchor="start">
          {parseDate(data[0].createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
        </SvgText>
        <SvgText x={GRAPH_W - PAD.right} y={GRAPH_H - 4} fontSize="9" fill="#94a3b8" textAnchor="end">
          {parseDate(data[data.length - 1].createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
        </SvgText>
      </Svg>

      {/* Trend row */}
      <View style={graphStyles.trendRow}>
        <Text style={graphStyles.trendLabel}>Latest  </Text>
        <Text style={[graphStyles.trendValue, { color }]}>{last} {unit}</Text>
        <Text style={[graphStyles.trendDelta, { color: delta > 0 ? "#d97706" : delta < 0 ? "#3b82f6" : "#94a3b8" }]}>
          {"   "}{delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}
        </Text>
      </View>
    </View>
  );
}

export default function PatientScreen() {
  const { id } = useLocalSearchParams();
  const patientId = id as string;
  const router = useRouter();

  const [history, setHistory] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "users", auth.currentUser.uid, "patients", patientId, "records"),
        orderBy("createdAt", "asc")
      );
      const snap = await getDocs(q);
      setHistory(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record)));
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const filteredHistory = useMemo(() => {
    if (dateRange === "all") return history;
    const cutoff = Date.now() - { "7d": 7, "30d": 30, "90d": 90 }[dateRange] * 86400000;
    return history.filter((r) => parseDate(r.createdAt).getTime() >= cutoff);
  }, [history, dateRange]);

  const avg = useMemo(() => {
    if (!filteredHistory.length) return null;
    return {
      heartRate: Math.round(filteredHistory.reduce((s, r) => s + r.heartRate, 0) / filteredHistory.length),
      spo2: (filteredHistory.reduce((s, r) => s + r.spo2, 0) / filteredHistory.length).toFixed(1),
    };
  }, [filteredHistory]);

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "normal": return "#16a34a";
      case "warning": return "#d97706";
      case "critical": return "#dc2626";
      default: return "#6366f1";
    }
  };
  const getStatusBg = (status: string) => {
    switch (status?.toLowerCase()) {
      case "normal": return "#f0fdf4";
      case "warning": return "#fffbeb";
      case "critical": return "#fef2f2";
      default: return "#eef2ff";
    }
  };

  const rangeOptions: { label: string; value: DateRange }[] = [
    { label: "7 days", value: "7d" },
    { label: "30 days", value: "30d" },
    { label: "90 days", value: "90d" },
    { label: "All time", value: "all" },
  ];

  const reversedHistory = [...filteredHistory].reverse();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header — same as dashboard */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Patient records 🩺</Text>
            <Text style={styles.title}>Measurements</Text>
          </View>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        {/* Date Range — pill row */}
        <View style={styles.rangeRow}>
          {rangeOptions.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.rangeBtn, dateRange === opt.value && styles.rangeBtnActive]}
              onPress={() => setDateRange(opt.value)}
            >
              <Text style={[styles.rangeBtnText, dateRange === opt.value && styles.rangeBtnTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
        ) : filteredHistory.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>No records in this period</Text>
            <Text style={styles.emptySubtext}>Try a wider date range</Text>
          </View>
        ) : (
          <>
            {/* Average Summary Card — same card style */}
            {avg && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Period Average  ·  {filteredHistory.length} readings</Text>
                <View style={styles.avgRow}>
                  <View style={styles.avgItem}>
                    <View style={[styles.avgOrb, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                      <Text style={styles.avgOrbIcon}>❤️</Text>
                      <Text style={[styles.avgValue, { color: "#dc2626" }]}>{avg.heartRate}</Text>
                    </View>
                    <Text style={styles.avgLabel}>avg bpm</Text>
                  </View>
                  <View style={styles.avgDivider} />
                  <View style={styles.avgItem}>
                    <View style={[styles.avgOrb, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
                      <Text style={styles.avgOrbIcon}>🫁</Text>
                      <Text style={[styles.avgValue, { color: "#2563eb" }]}>{avg.spo2}</Text>
                    </View>
                    <Text style={styles.avgLabel}>avg SpO₂ %</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Heart Rate Graph */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Heart Rate over time</Text>
              <LineGraph data={filteredHistory} field="heartRate" color="#dc2626" unit="bpm" yMin={50} yMax={120} />
            </View>

            {/* SpO2 Graph */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>SpO₂ Saturation over time</Text>
              <LineGraph data={filteredHistory} field="spo2" color="#2563eb" unit="%" yMin={90} yMax={100} />
            </View>

            {/* History List */}
            <Text style={styles.sectionHeading}>All Readings</Text>

            {reversedHistory.map((record, index) => (
              <View key={record.id} style={styles.card}>
                <View style={styles.recordRow}>
                  {/* Left: index + date */}
                  <View style={styles.recordLeft}>
                    <View style={styles.recordIndexBadge}>
                      <Text style={styles.recordIndexText}>#{filteredHistory.length - index}</Text>
                    </View>
                    <Text style={styles.recordDate}>
                      {parseDate(record.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                    <Text style={styles.recordTime}>
                      {parseDate(record.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>

                  {/* Center: vitals */}
                  <View style={styles.recordMetrics}>
                    <View style={styles.recordMetric}>
                      <Text style={[styles.recordMetricValue, { color: "#dc2626" }]}>
                        {record.heartRate} <Text style={styles.recordMetricUnit}>bpm</Text>
                      </Text>
                      <Text style={styles.recordMetricLabel}>Heart Rate</Text>
                    </View>
                    <View style={styles.recordMetric}>
                      <Text style={[styles.recordMetricValue, { color: "#2563eb" }]}>
                        {record.spo2}<Text style={styles.recordMetricUnit}>%</Text>
                      </Text>
                      <Text style={styles.recordMetricLabel}>SpO₂</Text>
                    </View>
                  </View>

                  {/* Right: status */}
                  <View style={[styles.statusPill, { backgroundColor: getStatusBg(record.status) }]}>
                    <Text style={[styles.statusPillText, { color: getStatusColor(record.status) }]}>
                      {record.status ?? "—"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const graphStyles = StyleSheet.create({
  empty: { height: GRAPH_H, alignItems: "center", justifyContent: "center" },
  emptyText: { color: "#94a3b8", fontSize: 13, fontWeight: "500" },
  trendRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  trendLabel: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  trendValue: { fontSize: 14, fontWeight: "700" },
  trendDelta: { fontSize: 13, fontWeight: "600" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { padding: 20, paddingBottom: 50 },

  // Header — identical to dashboard
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    marginTop: 8,
  },
  greeting: { fontSize: 15, color: "#64748b", fontWeight: "500", marginBottom: 2 },
  title: { fontSize: 30, fontWeight: "800", color: "#0f172a", letterSpacing: -0.5 },
  backBtn: { backgroundColor: "#f1f5f9", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, marginTop: 4 },
  backText: { color: "#334155", fontSize: 14, fontWeight: "600" },

  // Range pills
  rangeRow: { flexDirection: "row", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  rangeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  rangeBtnActive: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  rangeBtnText: { color: "#64748b", fontSize: 13, fontWeight: "600" },
  rangeBtnTextActive: { color: "#fff" },

  // Card — identical to dashboard
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
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
    marginBottom: 14,
  },

  // Average card internals
  avgRow: { flexDirection: "row", alignItems: "center" },
  avgItem: { flex: 1, alignItems: "center" },
  avgOrb: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avgOrbIcon: { fontSize: 22, marginBottom: 2 },
  avgValue: { fontSize: 26, fontWeight: "800", letterSpacing: -1 },
  avgLabel: { fontSize: 12, color: "#94a3b8", fontWeight: "600" },
  avgDivider: { width: 1, height: 70, backgroundColor: "#f1f5f9", marginHorizontal: 12 },

  // Empty state
  emptyContainer: { alignItems: "center", marginTop: 60 },
  emptyIcon: { fontSize: 52, marginBottom: 14 },
  emptyText: { fontSize: 19, fontWeight: "700", color: "#334155" },
  emptySubtext: { fontSize: 14, color: "#94a3b8", marginTop: 6, fontWeight: "500" },

  // Section heading
  sectionHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },

  // Record card internals
  recordRow: { flexDirection: "row", alignItems: "center" },
  recordLeft: { marginRight: 14, minWidth: 58, alignItems: "flex-start" },
  recordIndexBadge: {
    backgroundColor: "#e0e7ff",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 5,
    alignSelf: "flex-start",
  },
  recordIndexText: { fontSize: 11, color: "#6366f1", fontWeight: "700" },
  recordDate: { fontSize: 11, color: "#64748b", fontWeight: "600", lineHeight: 15 },
  recordTime: { fontSize: 11, color: "#94a3b8", fontWeight: "500" },

  recordMetrics: { flex: 1, flexDirection: "row", gap: 16 },
  recordMetric: {},
  recordMetricValue: { fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  recordMetricUnit: { fontSize: 12, fontWeight: "600", color: "#94a3b8" },
  recordMetricLabel: { fontSize: 11, color: "#94a3b8", fontWeight: "500", marginTop: 1 },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
});