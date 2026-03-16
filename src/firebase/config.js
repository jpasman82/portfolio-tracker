import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// PEGÁ TUS LLAVES DIRECTO ACÁ PARA PROBAR SI ES EL .ENV
const firebaseConfig = {
  apiKey: "AIzaSyBJ1HMAqTKEa2xrkOi3BGtHj_WRCF9Bzg4",
  authDomain: "mi-cartera-tracker.firebaseapp.com",
  projectId: "mi-cartera-tracker",
  storageBucket: "mi-cartera-tracker.firebasestorage.app",
  messagingSenderId: "314199812608",
  appId: "1:314199812608:web:a717393302530a70c746e5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

console.log("🔥 Firebase conectado a:", firebaseConfig.projectId);