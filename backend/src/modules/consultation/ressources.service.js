import { logger } from '../../lib/logger.js';
import { explorerOfpptInfo, explorerOfpptLife } from './explorationOfppt.js';

/**
 * Ressources en ligne d'un module — vidéos, cours, exercices (F14).
 * ← `search_ofppt.php` de l'existant (tiroir de `tableMatieres.html`).
 *
 * ═══ ⚠️ TROIS SOURCES, DANS CET ORDRE ═══ (2026-09-28)
 *   1. **ofppt.life** et **ofppt.info**, explorés DIRECTEMENT
 *      (`explorationOfppt.js`) — la source principale : supports faits pour ce
 *      programme, liens PDF directs, et aucun captcha ;
 *   2. **DuckDuckGo**, en complément — il met un captcha aux serveurs dès
 *      quelques dizaines de requêtes : un disjoncteur le coupe alors 30 min ;
 *   3. **YouTube** pour les vidéos.
 *
 * ═══ ⚠️ POURQUOI DU SCRAPING, ET PAS UNE API ═══
 * **Aucune clé d'API**, même critère que la météo (`meteo.service.js`) :
 * l'existant passait par Google avec une clé qui a fini dans l'historique Git.
 * Ici, on lit la page HTML de DuckDuckGo (`html.duckduckgo.com`, la version sans
 * JavaScript, stable et légère) et la page de résultats de YouTube, dont les
 * vidéos sont embarquées dans le JSON `ytInitialData`.
 *
 * ⚠️ LES REQUÊTES PORTENT LES MOTS-CLÉS DU RÉSEAU — « ofppt », « ofppt life »,
 * « ofppt info » — et les résultats dont le domaine contient « ofppt » passent
 * DEVANT les autres : ce sont les supports faits pour ce programme-là.
 *
 * ⚠️ CÔTÉ SERVEUR : le navigateur ne peut pas lire ces pages (CORS), et le cache
 * est partagé par tous les stagiaires qui suivent le même module.
 */

const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAI = 8_000;
const MAX_PAR_TYPE = 10;

/** ⚠️ DOUZE HEURES : les ressources d'un module ne bougent pas d'une heure à l'autre. */
const DUREE_CACHE = 12 * 60 * 60 * 1000;
const cache = new Map();

export function oublierMemoire() {
  cache.clear();
  duckDuckGoCoupeJusqua = 0;
}

/**
 * @param {string} intitule  nom du module (« Hygiène et sécurité »)
 * @param {{filiere?: string, code?: string}} precision
 *   `filiere` — intitulé de la filière du groupe : il entre dans les requêtes,
 *   c'est lui qui distingue « M102 » en Génie électrique de « M102 » en
 *   Restauration. `code` — le code du module : il ne sert qu'au CLASSEMENT.
 * @returns {Promise<{videos, cours, exercices, filiere}>} chaque liste peut être
 *   vide — une source en échec n'empêche jamais les autres de répondre.
 */
export async function ressourcesDuModule(intitule, { filiere = '', code = '', annee = null } = {}) {
  const sujet = nettoyer(intitule);
  const domaine = nettoyer(filiere);
  const cle = `${sujet}||${domaine}||${code}`.toLowerCase();
  const garde = cache.get(cle);
  if (garde && Date.now() - garde.pose < DUREE_CACHE) return garde.resultat;

  /*
   * ⚠️ DEUX REQUÊTES AVEC LA FILIÈRE, UNE SANS. Avec elle, les résultats sont
   * ceux du bon programme ; mais un intitulé de filière long ou rare peut n'en
   * ramener presque aucun — la requête sans filière garde la liste pleine, et
   * le classement ci-dessous remet devant ce qui parle de la filière.
   */
  const avec = domaine ? `${sujet} ${domaine}` : sujet;
  const pertinence = criteres(domaine, code);

  const module = { intitule: sujet, code, filiere: domaine, annee };
  const [videos, life, info, webCours, webExercices] = await Promise.all([
    chercherVideos([`${avec} ofppt`, ...(domaine ? [`${sujet} ofppt`] : [])], pertinence),
    explorerOfpptLife(module).catch(journaliser('ofppt.life')),
    explorerOfpptInfo(module).catch(journaliser('ofppt.info')),
    // ⚠️ UNE requête par type, plus trois : c'est le volume qui déclenche le captcha.
    chercherPages([`${avec} ofppt cours pdf`], pertinence),
    chercherPages([`${avec} ofppt exercices corrigés`], pertinence),
  ]);

  const directs = [...life, ...info];
  const cours = fusionner(directs.filter((e) => e.type === 'cours'), webCours);
  const exercices = fusionner(directs.filter((e) => e.type === 'exercices'), webExercices);

  const resultat = { videos, cours, exercices, filiere: domaine };

  /* ⚠️ ON NE MET EN CACHE QU'UNE RÉPONSE QUI APPORTE QUELQUE CHOSE : garder un
     échec douze heures ferait durer un blocage passager bien au-delà de lui. */
  if (videos.length + cours.length + exercices.length > 0) {
    cache.set(cle, { pose: Date.now(), resultat });
  }
  return resultat;
}

function journaliser(source) {
  return (erreur) => {
    logger.warn({ erreur: erreur.message, source }, 'ressources : exploration en échec');
    return [];
  };
}

/**
 * Les supports trouvés sur les sites OFPPT d'abord — ce sont ceux du programme —
 * puis les pages du moteur, sans doublon d'adresse.
 * ⚠️ PLUS LARGE que `MAX_PAR_TYPE` : un module d'ofppt.life porte souvent une
 * dizaine d'EFM à lui seul, et les couper masquerait les cours du second site.
 */
function fusionner(directs, web) {
  const vus = new Set();
  return [...directs, ...web]
    .filter((element) => {
      const cle = element.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    })
    .slice(0, 30);
}

/**
 * Les mots qui disent qu'un résultat parle de CETTE filière et de CE module.
 * ⚠️ SANS ACCENTS ET SANS MOTS VIDES : « de », « en », « et » se trouvent
 * partout, et « hygiène » doit reconnaître « hygiene ».
 */
const MOTS_VIDES = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'en', 'et', 'a', 'au', 'aux', 'un', 'une', 'pour', 'dans', 'sur']);

function sansAccents(texte) {
  return String(texte ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function criteres(filiere, code) {
  const mots = sansAccents(filiere)
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length > 2 && !MOTS_VIDES.has(mot));
  const codeModule = sansAccents(code).replace(/[^a-z0-9]/g, '');
  return { mots, codeModule };
}

/** Score d'un résultat : domaine OFPPT, mots de la filière, code du module. */
function score(texte, { mots, codeModule }, ofppt) {
  const brut = sansAccents(texte);
  const trouves = mots.filter((mot) => brut.includes(mot)).length;
  const partFiliere = mots.length ? trouves / mots.length : 0;
  const aCode = codeModule && brut.replace(/[^a-z0-9]/g, ' ').split(' ').includes(codeModule);
  return (ofppt ? 2 : 0) + partFiliere * 3 + (aCode ? 1 : 0);
}

/** Tri STABLE par score : l'ordre du moteur départage les ex æquo. */
function classer(elements, noter) {
  return elements
    .map((element, rang) => ({ element, rang, note: noter(element) }))
    .sort((a, b) => b.note - a.note || a.rang - b.rang)
    .map(({ element }) => element);
}

function nettoyer(texte) {
  return String(texte ?? '')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function lire(url) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI);
  try {
    const reponse = await fetch(url, {
      signal: controleur.signal,
      headers: { 'User-Agent': AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    });
    if (!reponse.ok) {
      logger.warn({ statut: reponse.status, url }, 'ressources : réponse en échec');
      return null;
    }
    return await reponse.text();
  } catch (erreur) {
    logger.warn({ erreur: erreur.message, url }, 'ressources : appel impossible');
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/* ═══ Pages web — DuckDuckGo ═══ */

async function chercherPages(requetes, pertinence) {
  const lots = await Promise.all(requetes.map(chercherDuckDuckGo));
  const vus = new Set();
  const pages = [];

  // Entrelacé : le premier résultat de chaque requête, puis le deuxième…
  const longueur = Math.max(0, ...lots.map((lot) => lot.length));
  for (let rang = 0; rang < longueur; rang += 1) {
    for (const lot of lots) {
      const page = lot[rang];
      if (!page) continue;
      const cle = page.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (vus.has(cle)) continue;
      vus.add(cle);
      pages.push(page);
    }
  }

  return classer(pages, (page) =>
    score(`${page.titre} ${page.extrait} ${page.url}`, pertinence, page.ofppt)
  ).slice(0, MAX_PAR_TYPE);
}

/**
 * ⚠️ LE DISJONCTEUR : DuckDuckGo répond aux serveurs par une page « bots use
 * DuckDuckGo too » (statut 202). La redemander ne fait que prolonger le blocage ;
 * on cesse donc de l'appeler pendant trente minutes.
 */
let duckDuckGoCoupeJusqua = 0;

async function chercherDuckDuckGo(requete) {
  if (Date.now() < duckDuckGoCoupeJusqua) return [];
  const html = await lire(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(requete)}&kl=fr-fr`);
  if (!html) return [];
  if (/bots use DuckDuckGo|anomaly-modal|challenge-form/i.test(html)) {
    duckDuckGoCoupeJusqua = Date.now() + 30 * 60 * 1000;
    logger.warn('ressources : DuckDuckGo demande un captcha — coupé 30 min');
    return [];
  }

  const resultats = [];
  const blocs = html.split(/<div class="result results_links/).slice(1);
  for (const bloc of blocs) {
    // Les annonces portent `result--ad` : ce n'est pas une ressource.
    if (bloc.slice(0, 120).includes('result--ad')) continue;

    const lien = bloc.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!lien) continue;
    const url = urlReelle(decoderEntites(lien[1]));
    if (!url || !/^https?:\/\//.test(url)) continue;

    const extrait = bloc.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const titre = texteBrut(lien[2]);
    let domaine = '';
    try {
      domaine = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }

    resultats.push({
      titre,
      url,
      extrait: extrait ? texteBrut(extrait[1]) : '',
      source: domaine,
      format: /\.pdf($|\?)/i.test(url) || /^PDF\b/.test(titre) ? 'pdf' : 'page',
      ofppt: /ofppt/i.test(domaine),
    });
  }
  return resultats;
}

/** DuckDuckGo enveloppe chaque lien dans `//duckduckgo.com/l/?uddg=<url>`. */
function urlReelle(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const cible = url.searchParams.get('uddg');
    return cible || url.href;
  } catch {
    return null;
  }
}

function decoderEntites(texte) {
  return texte
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function texteBrut(html) {
  return decoderEntites(html.replace(/<[^>]+>/g, ''))
    .replace(/^PDF\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ═══ Vidéos — YouTube ═══ */

async function chercherVideos(requetes, pertinence) {
  const lots = await Promise.all(requetes.map(chercherYouTube));
  const vus = new Set();
  const videos = [];
  const longueur = Math.max(0, ...lots.map((lot) => lot.length));
  for (let rang = 0; rang < longueur; rang += 1) {
    for (const lot of lots) {
      const video = lot[rang];
      if (!video || vus.has(video.id)) continue;
      vus.add(video.id);
      videos.push(video);
    }
  }
  return classer(videos, (video) =>
    score(video.titre, pertinence, /ofppt/i.test(`${video.chaine} ${video.titre}`))
  ).slice(0, MAX_PAR_TYPE);
}

async function chercherYouTube(requete) {
  const html = await lire(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(requete)}&hl=fr`
  );
  if (!html) return [];

  const debut = html.match(/var ytInitialData\s*=\s*/);
  if (!debut) return [];
  const depart = debut.index + debut[0].length;
  const fin = html.indexOf(';</script>', depart);
  if (fin < 0) return [];

  let donnees;
  try {
    donnees = JSON.parse(html.slice(depart, fin));
  } catch {
    logger.warn('ressources : ytInitialData illisible');
    return [];
  }

  const rendus = [];
  collecter(donnees, rendus);

  const vus = new Set();
  const videos = [];
  for (const video of rendus) {
    if (!video.videoId || vus.has(video.videoId)) continue;
    vus.add(video.videoId);
    videos.push({
      id: video.videoId,
      titre: texteRuns(video.title),
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      miniature: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
      chaine: texteRuns(video.ownerText),
      duree: video.lengthText?.simpleText ?? '',
      vues: video.shortViewCountText?.simpleText ?? texteRuns(video.shortViewCountText),
      publiee: video.publishedTimeText?.simpleText ?? '',
    });
    if (videos.length >= MAX_PAR_TYPE) break;
  }
  return videos;
}

/** Parcours en profondeur : YouTube change souvent l'emboîtement, jamais le nom `videoRenderer`. */
function collecter(noeud, sortie, profondeur = 0) {
  if (!noeud || typeof noeud !== 'object' || profondeur > 40) return;
  if (Array.isArray(noeud)) {
    for (const element of noeud) collecter(element, sortie, profondeur + 1);
    return;
  }
  if (noeud.videoRenderer) {
    sortie.push(noeud.videoRenderer);
    return;
  }
  for (const valeur of Object.values(noeud)) collecter(valeur, sortie, profondeur + 1);
}

function texteRuns(champ) {
  if (!champ) return '';
  if (champ.simpleText) return champ.simpleText;
  return (champ.runs ?? []).map((run) => run.text).join('');
}
