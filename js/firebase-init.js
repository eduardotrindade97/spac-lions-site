// Módulo central: inicializa o Firebase uma única vez e exporta os serviços
// usados pelo resto do site (app.js e admin/js/admin.js importam daqui).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Sem Firebase Storage de propósito: o Google passou a exigir cartão
// cadastrado (plano Blaze) só pra habilitar o Storage, mesmo no uso
// gratuito. Pra não depender disso, os escudos dos times são guardados
// como imagem comprimida direto nos documentos do Firestore (veja
// compressImageToDataUrl em js/app.js) — zero cartão, zero custo.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const CATS = ["Masculino Adulto","Feminino Adulto","Vets","Juvenil","Universitário Masculino","Universitário Feminino"];
export const EVENT_DATE = new Date('2026-12-12T08:00:00-03:00');
