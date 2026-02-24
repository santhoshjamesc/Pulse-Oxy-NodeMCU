import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from "react-native";
import { addDoc, collection } from "firebase/firestore";
import { db, auth } from "../firebase";
import { useRouter } from "expo-router";

export default function AddPatient() {
  const [name, setName] = useState("");
  const router = useRouter();

  const addPatient = async () => {
    if (!name.trim()) {
      alert("Please enter a patient name.");
      return;
    }
    try {
      await addDoc(collection(db, "users", auth.currentUser!.uid, "patients"), {
        name,
      });
      router.back();
    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Add a Loved One 🩺</Text>
        <Text style={styles.subtitle}>Enter loved one's details below</Text>

        <TextInput
          placeholder=" Name"
          placeholderTextColor="#999"
          style={styles.input}
          onChangeText={setName}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={addPatient}>
          <Text style={styles.primaryButtonText}>Save</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
  },
  inner: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  backText: {
    fontSize: 18,
    color: "#4f46e5",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#111",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 25,
  },
  input: {
    backgroundColor: "#f1f3f5",
    padding: 18,
    borderRadius: 14,
    fontSize: 18,
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: "#4f46e5",
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 10,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
});