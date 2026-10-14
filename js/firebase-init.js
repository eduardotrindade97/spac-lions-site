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

// Tempos padrão de uma partida de rugby sevens, usados pra sugerir horários
// no cronograma e pra calcular atraso em tempo real quando um jogo começa.
export const GAME_MIN = 14;      // duração do jogo (2x7min)
export const BREAK_MIN = 1.5;    // intervalo entre jogos
export const ENTRY_MIN = 1.5;    // entrada em campo + kick off
export const SLOT_MIN = GAME_MIN + BREAK_MIN + ENTRY_MIN; // 17min por partida, de kickoff a kickoff
