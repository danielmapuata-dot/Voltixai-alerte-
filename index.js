require('dotenv').config();
const express = require('express');
const https = require('https');

// 🔒 Variables d'environnement
const ANYSPORT_API_KEY = process.env.ANYSPORT_API_KEY || '';
const FACEBOOK_TOKEN = process.env.FACEBOOK_TOKEN || '';
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';

const app = express();
const PORT = process.env.PORT || 10000;
const etatMatchs = new Map();

// 📞 Appel API
function appelAPI(url) {
  return new Promise((resoudre, rejeter) => {
    const req = https.get(new URL(url), {
      headers: { 'X-API-Key': ANYSPORT_API_KEY }
    }, (res) => {
      let donnees = '';
      res.on('data', morceau => donnees += morceau);
      res.on('end', () => resoudre(JSON.parse(donnees)));
    });
    req.on('error', rejeter);
  });
}

// ➕ Calcul 2e mi-temps
function calculDeuxiemeMiTemps(ht, ft) {
  try {
    const [h1, a1] = ht.split('-').map(Number);
    const [h2, a2] = ft.split('-').map(Number);
    return `${h2 - h1}-${a2 - a1}`;
  } catch { return '0-0'; }
}

// 📝 Formatage
function formaterMatch(m) {
  let texte = '';
  if (!m.status || m.status === 'notstarted') {
    texte = `🕒 ${m.time} | ${m.home} 🆚 ${m.away}`;
  } else if (m.status === 'halftime') {
    texte = `⏸️ HALF TIME !
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : 0-0`;
  } else if (m.status === 'finished') {
    texte = `⏳ FULL TIME !
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : ${calculDeuxiemeMiTemps(m.ht_score, m.score)}`;
  } else if (m.goals?.length > 0) {
    const dernierBut = m.goals.at(-1);
    const nomJoueur = dernierBut.player?.trim() || "Joueur inconnu";
    const nomEquipe = dernierBut.team === 'home' ? m.home : m.away;
    texte = `🔥 ${dernierBut.time}' | GOOOOOAL 😊
   🚩 ${nomEquipe} marque par ${nomJoueur}
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : ${calculDeuxiemeMiTemps(m.ht_score, m.score)}`;
  }
  const corners = m.stats?.find(s => s.type === 'Corners');
  if (corners) texte += `\n   🏳️ Corners : ${corners.home}-${corners.away}`;
  return texte;
}

// 📤 Publication Facebook
async function publierSurFacebook(titre, contenu) {
  const heureGMT = new Date().toLocaleTimeString('fr-FR', {
    timeZone: 'Africa/Brazzaville', hour: '2-digit', minute: '2-digit'
  });
  const message = `⚽🚩 voltixai live SCORE 🕒 ${heureGMT} - GMT+1

${titre}
${contenu}

#VoltixaiLive #Football #LiveScore`;

  const url = `https://graph.facebook.com/v25.0/${FACEBOOK_PAGE_ID}/feed`;
  const params = new URLSearchParams({ message, access_token: FACEBOOK_TOKEN });
  await appelAPI(`${url}?${params}`);
  console.log('✅ Publié sur Facebook');
}

// 📅 Publier les matchs à venir
async function publierMatchsAVenir() {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const data = await appelAPI(`https://api.anysport.io/v1/matches?date=${aujourdhui}`);
  if (!data.success) return;

  const matchsAVenir = data.data.filter(m => !m.status || m.status === 'notstarted');
  if (matchsAVenir.length === 0) return;

  const groupesLigues = {};
  matchsAVenir.forEach(m => {
    if (!groupesLigues[m.league]) groupesLigues[m.league] = [];
    groupesLigues[m.league].push(`🕒 ${m.time} | ${m.home} 🆚 ${m.away}`);
  });

  let contenuFinal = '';
  for (const [ligue, liste] of Object.entries(groupesLigues)) {
    contenuFinal += `🌍 ${ligue}\n${liste.join('\n')}\n\n`;
  }

  await publierSurFacebook('📅 UPCOMING GAMES', contenuFinal);
  console.log('📅 Liste des matchs à venir publiée (toutes les heures)');
}

// 🔍 Surveillance des événements chaque minute
async function surveillerEvenements() {
  try {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const data = await appelAPI(`https://api.anysport.io/v1/matches?date=${aujourdhui}`);
    if (!data.success) return;

    for (const match of data.data) {
      const cleUnique = match.match_id;
      const etatActuel = `${match.status}-${match.score}-${JSON.stringify(match.goals || [])}`;

      if (etatMatchs.get(cleUnique) === etatActuel) continue;
      etatMatchs.set(cleUnique, etatActuel);

      const texteFormate = formaterMatch(match);
      if (!texteFormate) continue;

      await publierSurFacebook(`🌍 ${match.league}`, texteFormate);
    }
  } catch (erreur) {
    console.error('💥 Erreur surveillance :', erreur.message);
  }
}

// 🛡️ Route pour éviter la veille
app.get('/', (req, res) => {
  res.send('✅ Voltixai Alerte ACTIF - Aucune veille !');
});

// 🚀 Démarrage
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);

  // 1. Surveillance chaque minute
  surveillerEvenements();
  setInterval(surveillerEvenements, 60 * 1000);

  // 2. 🟢 NOUVEAU : Publication des matchs à venir TOUTES LES HEURES
  publierMatchsAVenir();
  setInterval(() => {
    console.log('⏰ Heure pile : publication des matchs à venir...');
    publierMatchsAVenir();
  }, 60 * 60 * 1000); // <-- TOUTES LES 60 MINUTES

  // 3. Auto-ping anti-veille toutes les 2 minutes
  setInterval(() => {
    https.get(`http://localhost:${PORT}/`, () => {
      console.log("🔄 Auto-ping anti-veille OK");
    });
  }, 120 * 1000);
});
