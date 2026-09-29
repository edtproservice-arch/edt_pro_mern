import { logger } from '../../lib/logger.js';

/**
 * Exploration DIRECTE des sites de supports OFPPT — ofppt.life et ofppt.info.
 *
 * ═══ ⚠️ POURQUOI PAS SEULEMENT UN MOTEUR DE RECHERCHE ═══ (2026-09-28)
 * DuckDuckGo, Bing, Brave et Mojeek répondent tous aux requêtes d'un SERVEUR
 * par un captcha — ou, pour Bing, par des résultats sans rapport. Mesuré en
 * quelques dizaines de requêtes : un moteur ne peut pas être la source
 * principale. Les deux sites, eux, s'explorent sans obstacle :
 *   - **ofppt.life** autorise l'exploration (`robots.txt`), publie un sitemap,
 *     et chaque page embarque en JSON la liste des modules d'une filière
 *     (`initialModules`) et les supports d'un module (`initialContent`), avec
 *     le lien DIRECT du PDF ;
 *   - **ofppt.info** est un WordPress : son API de recherche
 *     (`/wp-json/wp/v2/search`) rend titres et adresses.
 *
 * ⚠️ POLITESSE : l'index d'ofppt.life (une quarantaine de pages) se construit
 * au plus une fois par jour, quatre pages à la fois ; les supports d'un module
 * sont gardés un jour aussi.
 */

const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAI = 10_000;
const UN_JOUR = 24 * 60 * 60 * 1000;
const LIFE = 'https://ofppt.life';

const TYPES_LIFE = [
  { chemin: 'courses', type: 'cours', etiquette: 'Cours' },
  { chemin: 'exercises', type: 'exercices', etiquette: 'Exercices' },
  { chemin: 'efms', type: 'exercices', etiquette: 'EFM' },
  { chemin: 'effs', type: 'exercices', etiquette: 'EFF' },
];

let index = null; // { pose, entrees: Promise<Array> }
const contenus = new Map(); // url → { pose, elements }

export function oublierExploration() {
  index = null;
  contenus.clear();
}

async function lire(url, { json = false } = {}) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI);
  try {
    const reponse = await fetch(url, {
      signal: controleur.signal,
      headers: { 'User-Agent': AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    });
    if (!reponse.ok) {
      logger.warn({ statut: reponse.status, url }, 'exploration OFPPT : réponse en échec');
      return null;
    }
    return json ? await reponse.json() : await reponse.text();
  } catch (erreur) {
    logger.warn({ erreur: erreur.message, url }, 'exploration OFPPT : appel impossible');
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/* ═══ Rapprochement des intitulés ═══ */

const MOTS_VIDES = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'en', 'et', 'a', 'au', 'aux', 'un', 'une',
  'pour', 'dans', 'sur', 'l', 'd', 'annee', 'ere', 'eme', 'module',
]);

export function motsSignificatifs(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length > 1 && !MOTS_VIDES.has(mot));
}

/**
 * Ressemblance de deux intitulés, de 0 à 1 : la part des mots du PLUS COURT
 * retrouvés dans l'autre. « Hygiène, Sécurité et Environnement » contre
 * « Hygiène, Santé, Sécurité et Environnement au travail » → 1.
 */
export function ressemblance(a, b) {
  const x = new Set(motsSignificatifs(a));
  const y = new Set(motsSignificatifs(b));
  if (x.size === 0 || y.size === 0) return 0;
  const [court, long] = x.size <= y.size ? [x, y] : [y, x];
  let communs = 0;
  for (const mot of court) if (long.has(mot)) communs += 1;
  // ⚠️ Un seul mot commun sur un intitulé d'un seul mot (« Arabe ») est un vrai
  // rapprochement ; sur des intitulés longs, il faut davantage.
  return communs / Math.max(court.size, Math.min(long.size, 2));
}

/* ═══ ofppt.life — l'index des modules ═══ */

/**
 * ⚠️ LE JSON EST DANS UNE CHAÎNE JAVASCRIPT (flux RSC de Next.js) : ses
 * guillemets y sont échappés (`\"`). On lit donc les objets par expression
 * régulière sur la forme échappée, puis on décode chaque valeur.
 */
function decoderChaine(brute) {
  // Deux couches : la chaîne JavaScript du flux, puis la valeur JSON qu'elle porte.
  let texte = brute;
  for (let couche = 0; couche < 2; couche += 1) {
    try {
      texte = JSON.parse(`"${texte}"`);
    } catch {
      break;
    }
  }
  return texte;
}

async function construireIndex() {
  const sitemap = await lire(`${LIFE}/sitemap.xml`);
  if (!sitemap) return [];

  const selections = [
    ...new Set(
      [...sitemap.matchAll(/<loc>https:\/\/ofppt\.life\/module-selection\/([^/<]+)\/([^/<]+)<\/loc>/g)].map(
        (m) => `${m[1]}/${m[2]}`
      )
    ),
  ];

  const entrees = [];
  const file = [...selections];
  const ouvriers = Array.from({ length: 4 }, async () => {
    while (file.length > 0) {
      const chemin = file.shift();
      const [niveau, specialite] = chemin.split('/');
      const html = await lire(`${LIFE}/module-selection/${chemin}`);
      if (!html) continue;

      const filiere = html.match(
        /\\"name\\":\\"((?:[^"\\]|\\\\.)*?)\\",\\"code\\":\\"[^"\\]*\\",\\"description\\":\\"Fili/
      );
      const bloc = html.slice(html.indexOf('initialModules'));
      for (const m of bloc.matchAll(/\{\\"id\\":\d+,\\"name\\":\\"((?:[^"\\]|\\\\.)*?)\\",\\"code\\":\\"([^"\\]+)\\"/g)) {
        entrees.push({
          niveau,
          specialite,
          annee: Number((niveau.match(/\d/) ?? ['1'])[0]),
          filiere: filiere ? decoderChaine(filiere[1]) : specialite,
          intitule: decoderChaine(m[1]).replace(/\s+/g, ' ').trim(),
          code: m[2].toLowerCase(),
        });
      }
    }
  });
  await Promise.all(ouvriers);

  logger.info({ modules: entrees.length, filieres: selections.length }, 'exploration OFPPT : index ofppt.life');
  return entrees;
}

function indexLife() {
  if (index && Date.now() - index.pose < UN_JOUR) return index.entrees;
  const entrees = construireIndex().then((liste) => {
    // Un index vide (site injoignable) ne doit pas rester une journée.
    if (liste.length === 0) index = null;
    return liste;
  });
  index = { pose: Date.now(), entrees };
  return entrees;
}

/**
 * Les modules d'ofppt.life qui correspondent au nôtre.
 *
 * ⚠️ LE CODE SEUL NE SUFFIT PAS — « M105 » change d'intitulé d'une filière à
 * l'autre ; c'est tout le défaut corrigé le même jour sur les écrans. On exige
 * donc un INTITULÉ ressemblant ; le code, la filière et l'année ne font que
 * départager. Seule exception : un module transversal (`EGTS…`) est le même
 * dans toutes les filières, son code suffit.
 */
async function modulesCorrespondants({ intitule, code, filiere, annee }) {
  const entrees = await indexLife();
  const codeBas = String(code ?? '').toLowerCase().replace(/\s+/g, '');
  const transversal = /^egts/.test(codeBas);

  const notes = entrees
    .map((entree) => {
      const titre = ressemblance(intitule, entree.intitule);
      const memeCode = codeBas !== '' && entree.code === codeBas;
      const admis = titre >= 0.6 || (transversal && memeCode && titre >= 0.3) || (transversal && memeCode && !intitule);
      if (!admis) return null;
      return {
        entree,
        note:
          titre * 3 +
          (memeCode ? 1 : 0) +
          ressemblance(filiere, entree.filiere) +
          (annee && entree.annee === annee ? 0.5 : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.note - a.note);

  // Les six meilleurs : l'appelant s'arrête aux deux premiers qui ont du contenu.
  return notes.slice(0, 6).map(({ entree }) => entree);
}

/** Nettoie « Télécharger “Cours X”fichier.pdf – Téléchargé 20954 fois – 3,71 Mo ». */
function titreSupport(brut) {
  const guillemets = brut.match(/[“"«]\s*([^”"»]+?)\s*[”"»]/);
  const titre = guillemets ? guillemets[1] : brut.replace(/^Télécharger\s*/i, '');
  const taille = brut.match(/(\d+(?:[.,]\d+)?\s*[KMG]o)\b/);
  const telechargements = brut.match(/Téléchargé\s+(\d[\d\s]*)\s+fois/);
  return {
    titre: titre.replace(/\s*[-–]\s*Téléchargé.*$/, '').trim(),
    taille: taille ? taille[1] : '',
    telechargements: telechargements ? Number(telechargements[1].replace(/\s/g, '')) : null,
  };
}

async function supportsDuModule(entree, { chemin, type, etiquette }) {
  const page = `${LIFE}/module-details/${entree.niveau}/${entree.specialite}/${entree.code}/${chemin}`;
  const garde = contenus.get(page);
  if (garde && Date.now() - garde.pose < UN_JOUR) return garde.elements;

  const html = await lire(page);
  if (!html) return [];

  const elements = [];
  const bloc = html.slice(html.indexOf('initialContent'));
  for (const m of bloc.matchAll(
    /\\"title\\":\\"((?:[^"\\]|\\\\.)*?)\\"[^{}]*?\\"file_url\\":\\"([^"\\]+)\\"/g
  )) {
    const { titre, taille, telechargements } = titreSupport(decoderChaine(m[1]));
    elements.push({
      titre: titre || `${etiquette} — ${entree.intitule}`,
      url: m[2],
      page,
      extrait: [
        `${etiquette} · ${entree.intitule} (${entree.code.toUpperCase()}) · ${entree.filiere}`,
        taille,
        telechargements ? `${telechargements.toLocaleString('fr-FR')} téléchargements` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      source: 'ofppt.life',
      format: /\.pdf($|\?)/i.test(m[2]) ? 'pdf' : 'page',
      etiquette,
      type,
      ofppt: true,
    });
  }

  contenus.set(page, { pose: Date.now(), elements });
  return elements;
}

/**
 * ⚠️ UN MODULE INDEXÉ N'A PAS FORCÉMENT DE SUPPORTS : « Arabe » existe dans
 * vingt filières d'ofppt.life, et la plupart ont des pages vides. On descend
 * donc la liste par ordre de pertinence jusqu'à DEUX modules qui en portent.
 */
export async function explorerOfpptLife(module) {
  const candidats = await modulesCorrespondants(module);
  const retenus = [];
  let avecContenu = 0;
  for (const entree of candidats) {
    const lots = await Promise.all(TYPES_LIFE.map((type) => supportsDuModule(entree, type)));
    const elements = lots.flat();
    if (elements.length === 0) continue;
    retenus.push(...elements);
    avecContenu += 1;
    if (avecContenu === 2) break;
  }
  const vus = new Set();
  return retenus.filter((element) => !vus.has(element.url) && vus.add(element.url));
}

/* ═══ ofppt.info — l'API de recherche WordPress, puis les pages filière ═══ */

const EXERCICE = /exercice|corrig|\btp\b|travaux pratiques|efm|eff|examen|contr[oô]le|qcm/i;

/**
 * ⚠️ DEUX NIVEAUX. La recherche WordPress rend parfois une page AU NOM du
 * module (« Hygiène, Santé, Sécurité… ») — elle est gardée telle quelle. Mais
 * le plus souvent, elle rend des PAGES FILIÈRE (« ESA : Électromécanique… »)
 * qui listent un PDF par module, en blocs `wp-block-file`. On ouvre alors les
 * plus proches de notre filière et on y relève le PDF dont le nom ressemble au
 * module (« M02_Interprétation-de-schémas-de-plans-et-de-devis »).
 */
export async function explorerOfpptInfo({ intitule, filiere }) {
  // ⚠️ AVEC LEURS ACCENTS : la recherche WordPress y est sensible —
  // « interpretation » ne trouve pas « Interprétation ».
  const termes = String(intitule ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((mot) => mot.length > 1 && !MOTS_VIDES.has(motsSignificatifs(mot)[0] ?? ''))
    .slice(0, 6)
    .join(' ');
  if (!termes) return [];

  const cle = `info||${termes}||${filiere ?? ''}`;
  const garde = contenus.get(cle);
  if (garde && Date.now() - garde.pose < UN_JOUR) return garde.elements;

  const reponse = await lire(
    `https://ofppt.info/wp-json/wp/v2/search?per_page=20&search=${encodeURIComponent(termes)}`,
    { json: true }
  );
  if (!Array.isArray(reponse)) return [];

  const notes = reponse.map((item) => {
    const titre = decoderEntites(String(item.title ?? '')).trim();
    return { url: item.url, titre, note: ressemblance(intitule, titre) };
  });

  const pagesModule = notes
    .filter(({ note }) => note >= 0.5)
    .sort((a, b) => b.note - a.note)
    .map(({ url, titre }) => ({
      titre,
      url,
      extrait: '',
      source: 'ofppt.info',
      format: 'page',
      type: EXERCICE.test(titre) ? 'exercices' : 'cours',
      ofppt: true,
    }));

  const pagesFiliere = notes
    .filter(({ note }) => note < 0.5)
    .map((page) => ({ ...page, proche: ressemblance(filiere, page.titre) }))
    .sort((a, b) => b.proche - a.proche)
    .slice(0, 4);

  const lots = await Promise.all(pagesFiliere.map((page) => pdfsDeLaPage(page, intitule)));
  const elements = [...pagesModule, ...lots.flat()];

  contenus.set(cle, { pose: Date.now(), elements });
  return elements;
}

async function pdfsDeLaPage(page, intitule) {
  const html = await lire(page.url);
  if (!html) return [];

  const trouves = [];
  for (const m of html.matchAll(/<div class="wp-block-file"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    // « M02_Interprétation-de-schémas… » → « Interprétation de schémas… »
    const nom = decoderEntites(m[2].replace(/<[^>]+>/g, ''))
      .replace(/^\s*M\s?\d+\s*[_\-–:.]\s*/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!nom || ressemblance(intitule, nom) < 0.6) continue;
    trouves.push({
      titre: nom,
      url: m[1],
      page: page.url,
      extrait: page.titre,
      source: 'ofppt.info',
      format: /\.pdf($|\?)/i.test(m[1]) ? 'pdf' : 'page',
      type: EXERCICE.test(nom) ? 'exercices' : 'cours',
      ofppt: true,
    });
  }
  return trouves;
}

function decoderEntites(texte) {
  return texte
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8211;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}
