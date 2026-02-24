import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA95zN83L4H1GrvotsdjXONTGsDUllDwN8",
  authDomain: "pulse-oxy.firebaseapp.com",
  projectId: "pulse-oxy",
  storageBucket: "pulse-oxy.firebasestorage.app",
  messagingSenderId: "213088746485",
  appId: "1:213088746485:web:9d27454aeddb7249ee7ebc",
  measurementId: "G-46DMVJJC6G"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);