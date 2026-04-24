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
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO_ID",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
