require('dotenv').config();
const express = require('express');
const https = require('https');

// 🔒 Variables d'environnement (à configurer sur Render)
const ANYSPORT_API_KEY = process.env.ANYSPORT_API_KEY || '';
const FACEBOOK_TOKEN = process.env.FACEBOOK_TOKEN || '';
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';

const app = express();
const PORT = process.env.PORT || 10000;
const etatMatchs = new Map(); // Évite de publier 2 fois la même chose

// 📞 Appel API sécurisé
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

// ➕ Calcul score 2e mi-temps
function calculDeuxiemeMiTemps(ht, ft) {
  try {
    const [h1, a1] = ht.split('-').map(Number);
    const [h2, a2] = ft.split('-').map(Number);
    return `${h2 - h1}-${a2 - a1}`;
  } catch { return '0-0'; }
}

// 📝 Formatage style ScoreZone (exactement comme tu veux)
function formaterMatch(m) {
  let texte = '';

  // 🔮 Match à venir
  if (!m.status || m.status === 'notstarted') {
    texte = `🕒 ${m.time} | ${m.home} 🆚 ${m.away}`;
  }
  // ⏸️ Mi-temps
  else if (m.status === 'halftime') {
    texte = `⏸️ HALF TIME !
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : 0-0`;
  }
  // ✅ Match terminé
  else if (m.status === 'finished') {
    texte = `⏳ FULL TIME !
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : ${calculDeuxiemeMiTemps(m.ht_score, m.score)}`;
  }
  // ⚽ But (avec nom du joueur si disponible)
  else if (m.goals?.length > 0) {
    const dernierBut = m.goals.at(-1);
    const nomJoueur = dernierBut.player?.trim() || "Joueur inconnu";
    const nomEquipe = dernierBut.team === 'home' ? m.home : m.away;
    texte = `🔥 ${dernierBut.time}' | GOOOOOAL 😊
   🚩 ${nomEquipe} marque par ${nomJoueur}
   ${m.home} ${m.score || '0-0'} ${m.away}
   ➡️ 1st Half : ${m.ht_score || '0-0'} | 2nd Half : ${calculDeuxiemeMiTemps(m.ht_score, m.score)}`;
  }

  // Ajoute les corners si présents dans les stats
  const corners = m.stats?.find(s => s.type === 'Corners');
  if (corners) texte += `\n   🏳️ Corners : ${corners.home}-${corners.away}`;

  return texte;
}

// 📤 Publication sur Facebook
async function publierSurFacebook(titre, contenu) {
  const heureGMT = new Date().toLocaleTimeString('fr-FR', {
    timeZone: 'Africa/Brazzaville', hour: '2-digit', minute: '2-digit'
  });
  const message = `⚽🚩 voltixai live SCORE 🕒 ${heureGMT} - GMT+1

${titre}
${contenu}

#VoltixaiLive #Football #LiveScore`;

  const url = `https://graph.facebook.com/v25.0/${FACEBOOK_PAGE_ID}/feed`;
  const params = new URLSearchParams({
    message: message,
    access_token: FACEBOOK_TOKEN
  });

  await appelAPI(`${url}?${params}`);
  console.log('✅ Publication envoyée sur Facebook');
}

// 📅 Publier la liste des matchs à venir
async function publierMatchsAVenir() {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const data = await appelAPI(`https://api.anysport.io/v1/matches?date=${aujourdhui}`);
  if (!data.success) return;

  const matchsAVenir = data.data.filter(m => !m.status || m.status === 'notstarted');
  if (matchsAVenir.length === 0) return;

  // Regroupe par ligue
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

      // Ne publie que si quelque chose a changé
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

// 🛠️ Route pour garder Render éveillé
app.get('/', (req, res) => {
  res.send('✅ Voltixai Infosport en ligne - Render');
});

// 🚀 Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log('⏱️ Vérification des matchs chaque minute...');
  console.log('📅 Publication matchs à venir à 00h, 5h, 10h, 16h, 21h');
});

// ⏱️ Planification
// 1. Surveillance continue (chaque minute)
surveillerEvenements();
setInterval(surveillerEvenements, 60 * 1000);

// 2. Publication matchs à venir (horaires fixes Congo/Brazzaville)
function verifierEtPublierAVenir() {
  const h = new Date().getHours();
  if ([0, 5, 10, 16, 21].includes(h)) {
    publierMatchsAVenir();
  }
}
verifierEtPublierAVenir();
setInterval(verifierEtPublierAVenir, 60 * 60 * 1000); // Vérifie chaque heure
                          
