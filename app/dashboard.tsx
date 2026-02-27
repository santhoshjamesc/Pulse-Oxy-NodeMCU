import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { useRouter } from "expo-router";
import { onAuthStateChanged, signOut, User } from "firebase/auth";

export default function Dashboard() {
  const [patients, setPatients] = useState<any[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Auth persistence: Firebase SDK handles this automatically in React Native
    // using AsyncStorage under the hood — no extra setup needed.
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setPatients([]);
      return;
    }

    // Real-time listener: updates patients immediately whenever Firestore changes
    const q = query(
      collection(db, "users", user.uid, "patients"),
      orderBy("name")
    );

    const unsubscribeSnapshot = onSnapshot(
      q,
      (snap) => {
        setPatients(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to listen to patients:", err);
      }
    );

    // Cleanup listener when user changes or component unmounts
    return () => unsubscribeSnapshot();
  }, [user]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (err) {
      console.error("Failed to sign out:", err);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 50 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good day👋</Text>
            <Text style={styles.title}>Your Loveds Ones</Text>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.countBadge}>
              <Text style={styles.countNumber}>{patients.length}</Text>
              <Text style={styles.countLabel}>Total</Text>
            </View>

            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Add Patient */}
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push("/add-patient")}
          activeOpacity={0.85}
        >
          <Text style={styles.addButtonText}>＋  Add New Member</Text>
        </TouchableOpacity>

        {/* Patient List */}
        {patients.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🏥</Text>
            <Text style={styles.emptyText}>No patients yet.</Text>
            <Text style={styles.emptySubtext}>Add your first one above!</Text>
          </View>
        ) : (
          patients.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {p.name?.charAt(0).toUpperCase() ?? "?"}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{p.name}</Text>
                  <Text style={styles.cardMeta}>
                    {p.age ? `Age ${p.age}` : ""}
                    {p.age && p.condition ? "  ·  " : ""}
                    {p.condition ?? ""}
                  </Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.viewButton}
                  onPress={() => router.push(`/patient/${p.id}`)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.viewButtonText}>📋  View Records</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.measureButton}
                  onPress={() =>
                    router.push({
                      pathname: "/Sensorscreen",
                      params: { patientId: p.id, patientName: p.name },
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Text style={styles.measureButtonText}>❤️  Measure</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, marginTop: 8 },
  headerRight: { flexDirection: "column", alignItems: "center", gap: 8 },
  greeting: { fontSize: 15, color: "#64748b", fontWeight: "500", marginBottom: 2 },
  title: { fontSize: 30, fontWeight: "800", color: "#0f172a", letterSpacing: -0.5 },
  countBadge: {
    backgroundColor: "#6366f1",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    minWidth: 60,
  },
  countNumber: { fontSize: 22, fontWeight: "800", color: "#fff" },
  countLabel: { fontSize: 11, color: "#c7d2fe", fontWeight: "600", marginTop: -2 },
  signOutButton: {
    backgroundColor: "#f87171",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  signOutText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  addButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 28,
    shadowColor: "#6366f1",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  addButtonText: { color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: 0.3 },
  emptyContainer: { alignItems: "center", marginTop: 60 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyText: { fontSize: 20, fontWeight: "700", color: "#334155" },
  emptySubtext: { fontSize: 15, color: "#94a3b8", marginTop: 6 },
  card: { backgroundColor: "#fff", borderRadius: 20, marginBottom: 16, padding: 18, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#e0e7ff", alignItems: "center", justifyContent: "center", marginRight: 14 },
  avatarText: { fontSize: 22, fontWeight: "800", color: "#6366f1" },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 19, fontWeight: "700", color: "#0f172a" },
  cardMeta: { fontSize: 13, color: "#94a3b8", marginTop: 2, fontWeight: "500" },
  cardActions: { flexDirection: "row", gap: 10 },
  viewButton: { flex: 1, backgroundColor: "#f1f5f9", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  viewButtonText: { fontSize: 14, fontWeight: "700", color: "#334155" },
  measureButton: { flex: 1, backgroundColor: "#fef2f2", paddingVertical: 12, borderRadius: 12, alignItems: "center", borderWidth: 1.5, borderColor: "#fecaca" },
  measureButtonText: { fontSize: 14, fontWeight: "700", color: "#dc2626" },
});