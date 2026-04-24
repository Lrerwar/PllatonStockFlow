// =============================================
// FIREBASE CONFIGURATION
// =============================================
// 1. Acesse https://console.firebase.google.com
// 2. Crie um novo projeto (ou use um existente)
// 3. Adicione um app Web (</> ícone)
// 4. Copie o objeto firebaseConfig abaixo
// 5. Em Authentication > Sign-in method, ative "E-mail/senha"
// 6. Em Firestore Database, crie o banco em modo produção
//    e aplique as regras do arquivo firestore.rules

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚠️  SUBSTITUA PELOS DADOS DO SEU PROJETO FIREBASE
const firebaseConfig = {

  apiKey: "AIzaSyCFKyNNfhLTTiWFXk-aZBDhMtujzFGRLlM",

  authDomain: "stokflow-pllaton.firebaseapp.com",

  projectId: "stokflow-pllaton",

  storageBucket: "stokflow-pllaton.firebasestorage.app",

  messagingSenderId: "31756276670",

  appId: "1:31756276670:web:ef5268f539a92bb63b1fef",

  measurementId: "G-ZX7LSQGLQZ"

};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
