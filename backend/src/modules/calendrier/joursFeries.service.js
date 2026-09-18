import { bornesAnneeScolaire } from 'shared/domain';
import { feriesDeLAnnee } from './agendaMaroc.service.js';
import { JoursFeriesNationaux } from '../../models/JoursFeriesNationaux.js';
import { logger } from '../../lib/logger.js';

/**
 * Jours fériés marocains d'une année scolaire.
 * ← api/data/morocco_holidays.php
 *
 * Deux origines :
 *   - fériés CIVILS : dates fixes, connues d'avance, aucune dépendance externe ;
 *   - fêtes RELIGIEUSES : estimations lunaires, obtenues d'api.aladhan.com.
 *
 * L'API fait foi à chaque appel ; `JoursFeriesNationaux` n'est plus une source
 * mais une SAUVEGARDE, servie uniquement lorsque la récupération revient
 * amputée. Un cache mémoire d'une heure évite de rappeler l'API à chaque
 * rafraîchissement de page. Voir `obtenirNationaux`.
 */

/*
 * Cache MÉMOIRE, par processus. Il évite de rappeler l'API à chaque
 * rafraîchissement de page sans jamais figer une donnée plus d'une heure —
 * là où les 30 jours du cache en base avaient figé 34 dates fausses.
 */
const TTL_MEMOIRE = 60 * 60 * 1000;
const memoire = new Map();

/*
 * ⚠️ À INCRÉMENTER dès que la composition des jours change — source, filtre,
 * champs. Une sauvegarde portant une autre version n'est jamais servie : elle
 * décrirait une année selon des règles qui n'ont plus cours.
 *
 * 1 : bornes sur l'année scolaire (et non deux années civiles), source
 *     agendamaroc avec intitulés fr/ar, `estime` réservé aux fêtes lunaires.
 */
const VERSION_REGLE = 1;
const DELAI_APPEL = 5000; // ms — sans quoi 24 appels bloqués figent la requête

/**
 * Correspondance libellé AlAdhan → libellés français officiels au Maroc.
 * Reprise à l'identique de morocco_holidays.php:20-31, symbole ﷺ compris : la
 * clé doit correspondre EXACTEMENT à ce que renvoie l'API.
 * Deuxième entrée = second jour férié, quand la fête en compte deux.
 */
const FETES = {
  'Eid-ul-Fitr': ['Aïd Al Fitr', 'Aïd Al Fitr (2e jour)'],
  'Eid-ul-Adha': ['Aïd Al Adha', 'Aïd Al Adha (2e jour)'],
  'Al-Hijra; Islamic New Year': ['1er Moharram (Nouvel An islamique)', null],
  'Mawlid (Birth) al-Nabi ﷺ': [
    'Aïd Al Mawlid (Naissance du Prophète)',
    'Aïd Al Mawlid (Naissance du Prophète) (2e jour)',
  ],
  // Variantes rencontrées sur d'autres années, conservées par prudence.
  'Mawlid-un-Nabi; Shab-e-Meeladun Nabi': [
    'Aïd Al Mawlid (Naissance du Prophète)',
    'Aïd Al Mawlid (Naissance du Prophète) (2e jour)',
  ],
  'Mawlid-un-Nabi': [
    'Aïd Al Mawlid (Naissance du Prophète)',
    'Aïd Al Mawlid (Naissance du Prophète) (2e jour)',
  ],
};

/** Fériés civils d'une année civile. ← getCivilHolidays(), même liste. */
function feriesCivils(annee) {
  return [
    ['01-01', 'Nouvel An'],
    ['01-11', "Anniversaire du Manifeste de l'Indépendance"],
    ['01-14', 'Nouvel An Amazigh'],
    ['05-01', 'Fête du Travail'],
    ['07-30', 'Fête du Trône'],
    ['08-14', 'Anniversaire de la Récupération de Oued Eddahab'],
    ['08-20', 'Révolution du Roi et du Peuple'],
    ['08-21', 'Fête de la Jeunesse'],
    // « Fête de de l'Unité » en PHP (morocco_holidays.php:73) — coquille
    // corrigée ici, seul écart volontaire avec la liste d'origine.
    ['10-31', "Fête de l'Unité"],
    ['11-06', 'Anniversaire de la Marche Verte'],
    ['11-18', "Fête de l'Indépendance"],
    // Mêmes champs que la source officielle, pour que le repli soit
    // indiscernable à la lecture. Une date FIXE n'est jamais une estimation.
  ].map(([jour, libelle]) => ({
    date: `${annee}-${jour}`,
    libelle,
    libelleAr: '',
    type: jour === '01-14' ? 'amazigh' : 'national',
    estime: false,
  }));
}

/**
 * Fêtes religieuses d'un mois grégorien, via le calendrier hégirien d'AlAdhan.
 *
 * @returns {Promise<{repondu: boolean, fetes: Array<{fete, date}>}>}
 *   `repondu: false` distingue « l'API n'a pas répondu » de « ce mois ne
 *   contient aucune fête ». Les confondre est ce qui produit un calendrier
 *   amputé présenté comme complet.
 */
async function feriesReligieusesDuMois(mois, annee) {
  const url = `https://api.aladhan.com/v1/gToHCalendar/${mois}/${annee}`;

  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_APPEL) });
    if (!reponse.ok) return { repondu: false, fetes: [] };

    const charge = await reponse.json();
    if (charge?.code !== 200 || !Array.isArray(charge.data)) return { repondu: false, fetes: [] };

    const trouvees = [];

    for (const jour of charge.data) {
      const fetes = jour?.hijri?.holidays ?? [];
      if (fetes.length === 0) continue;

      // L'API donne « JJ-MM-AAAA ».
      const [j, m, a] = String(jour.gregorian.date).split('-');
      const date = `${a}-${m}-${j}`;

      for (const fete of fetes) trouvees.push({ fete, date });
    }

    return { repondu: true, fetes: trouvees };
  } catch (erreur) {
    logger.warn({ erreur: erreur.message, mois, annee }, 'jours fériés : appel API en échec');
    return { repondu: false, fetes: [] };
  }
}

/** Un mois, avec une seconde tentative — un échec isolé ampute l'année entière. */
async function avecReprise(mois, annee) {
  const premier = await feriesReligieusesDuMois(mois, annee);
  if (premier.repondu) return premier;

  await new Promise((suite) => setTimeout(suite, 400));
  return feriesReligieusesDuMois(mois, annee);
}

/**
 * Exécute les tâches par vagues de `largeur`.
 *
 * Ni séquentiel (le PHP l'était : ~20 s par requête), ni 24 appels d'un coup —
 * mesuré, AlAdhan en laisse tomber deux ou trois sur les 24 lancés ensemble, et
 * l'année sortait sans l'Aïd Al Fitr.
 */
async function parVagues(taches, largeur) {
  const resultats = [];
  for (let debut = 0; debut < taches.length; debut += largeur) {
    const vague = taches.slice(debut, debut + largeur);
    resultats.push(...(await Promise.all(vague.map((tache) => tache()))));
  }
  return resultats;
}

/**
 * Fêtes religieuses des deux années civiles couvertes par l'année scolaire.
 *
 * 24 mois à interroger, par vagues de 4. Le PHP les enchaînait un par un, d'où
 * les ~20 s par requête qui plombaient le chargement de profile.html.
 *
 * @returns {Promise<{jours: Array, complet: boolean}>} `complet` est faux dès
 *   qu'un seul mois n'a pas répondu, même après reprise.
 */
async function feriesReligieuses(debut, fin) {
  const mois = [];
  for (let m = 1; m <= 12; m += 1) {
    mois.push([m, debut], [m, fin]);
  }

  const resultats = await parVagues(
    mois.map(([m, a]) => () => avecReprise(m, a)),
    4
  );

  const complet = resultats.every((resultat) => resultat.repondu);
  const vues = new Set();
  const jours = [];
  const inconnues = new Set();

  for (const { fete, date } of resultats.flatMap((resultat) => resultat.fetes)) {
    const libelles = FETES[fete];
    if (!libelles) {
      inconnues.add(fete);
      continue;
    }

    const cle = `${fete}|${date}`;
    if (vues.has(cle)) continue;
    vues.add(cle);

    // Ce sont des fêtes LUNAIRES : toujours des estimations, contrairement aux
    // fériés civils. C'est la distinction que `variable` porte côté agendamaroc.
    const religieux = { libelleAr: '', type: 'religieux', estime: true };

    jours.push({ date, libelle: libelles[0], ...religieux });

    if (libelles[1]) {
      jours.push({ date: lendemain(date), libelle: libelles[1], ...religieux });
    }
  }

  if (inconnues.size > 0) {
    // Journalisé, pas écrit dans un fichier : le journal d'origine avait
    // atteint 2,7 Mo (morocco_holidays.php:157-168).
    logger.info({ inconnues: [...inconnues] }, 'jours fériés : libellés AlAdhan non reconnus');
  }

  return { jours, complet };
}

function lendemain(date) {
  const suivant = new Date(`${date}T12:00:00Z`); // midi : à l'abri des changements d'heure
  suivant.setUTCDate(suivant.getUTCDate() + 1);
  return suivant.toISOString().slice(0, 10);
}

/**
 * Liste consolidée pour une année scolaire.
 *
 * ═══ L'API FAIT FOI, LA COLLECTION EST UN FILET ═══
 * Décision du 2026-08-16, après la question « pourquoi une collection si les
 * fériés viennent d'une API ? ». Elle était juste : le stockage existait parce
 * qu'`aladhan` demandait 24 appels dont deux ou trois échouaient à chaque
 * passage. Avec agendamaroc, c'est UN appel par année civile — la raison a
 * disparu, et le cache 30 jours a fini par figer des données fausses pendant un
 * mois (les 34 dates d'avant le correctif).
 *
 * La priorité est donc inversée :
 *   1. un cache MÉMOIRE d'une heure, pour ne pas rappeler l'API à chaque
 *      rafraîchissement de page ;
 *   2. l'API, systématiquement, et c'est elle qui fait foi ;
 *   3. la collection UNIQUEMENT si la récupération revient amputée — mieux vaut
 *      une liste plus ancienne mais complète qu'une année sans ses fêtes.
 *
 * Ce qui est écrit en base n'est donc plus une source, c'est une sauvegarde.
 *
 * @param {number} anneeScolaire année de septembre (2025 pour « 2025-2026 »)
 * @returns {Promise<{jours: Array, complet: boolean, recupereLe: Date}>}
 */
export async function obtenirNationaux(anneeScolaire) {
  const enMemoire = memoire.get(anneeScolaire);
  if (enMemoire && enMemoire.expire > Date.now()) return enMemoire.valeur;

  const debut = anneeScolaire;
  const fin = anneeScolaire + 1;

  /*
   * ═══ AGENDAMAROC D'ABORD, ANNÉE CIVILE PAR ANNÉE CIVILE ═══
   * Un appel rend l'année entière avec ses intitulés officiels (fr + ar) et le
   * drapeau `variable` qui distingue une estimation lunaire d'une date fixe.
   * L'API ne couvrant que 2026-2028, chaque année non servie retombe sur
   * l'ancienne chaîne — fériés civils codés + `aladhan` pour le religieux.
   * Le repli est PAR ANNÉE : une année reste ainsi cohérente avec elle-même.
   */
  const [officielsDebut, officielsFin] = await Promise.all([
    feriesDeLAnnee(debut),
    feriesDeLAnnee(fin),
  ]);

  const anneesAReplier = [
    [debut, officielsDebut],
    [fin, officielsFin],
  ].filter(([, officiels]) => officiels === null);

  const religieuses = anneesAReplier.length
    ? await feriesReligieuses(
        Math.min(...anneesAReplier.map(([annee]) => annee)),
        Math.max(...anneesAReplier.map(([annee]) => annee))
      )
    : { jours: [], complet: true };

  /*
   * ⚠️ Le filtre portait sur les DEUX ANNÉES CIVILES chevauchées
   * (`2025-01-01` → `2026-12-31`), soit deux ans de fériés : l'écran en
   * affichait 34 au lieu de 17. Les bornes de l'ANNÉE SCOLAIRE viennent
   * maintenant du domaine.
   */
  const bornes = bornesAnneeScolaire(anneeScolaire);

  const jours = trier(
    [
      ...(officielsDebut ?? feriesCivils(debut)),
      ...(officielsFin ?? feriesCivils(fin)),
      // Les religieuses de `aladhan` ne concernent que les années repliées.
      ...religieuses.jours,
    ].filter((ferie) => ferie.date >= bornes.debut && ferie.date <= bornes.fin)
  );

  /*
   * Récupération amputée : on ressort la sauvegarde plutôt qu'une année sans
   * ses fêtes religieuses. Deux mois tombés — mesuré sur l'API réelle —
   * suffisent à retirer l'Aïd Al Fitr du calendrier.
   * ← même arbitrage qu'en PHP (morocco_holidays.php:180), rendu explicite.
   */
  if (!religieuses.complet) {
    const secours = await JoursFeriesNationaux.findOne({
      anneeScolaire,
      version: VERSION_REGLE,
      complet: true,
    });

    if (secours) {
      logger.warn(
        { anneeScolaire, recupereLe: secours.recupereLe },
        'jours fériés : récupération incomplète, la sauvegarde prend le relais'
      );
      return retenir(anneeScolaire, {
        jours: secours.jours,
        complet: true,
        recupereLe: secours.recupereLe,
      });
    }
  }

  // La sauvegarde ne se met à jour QUE sur une récupération complète : une
  // liste amputée ne doit pas écraser une bonne.
  const recupereLe = new Date();

  if (religieuses.complet) {
    await JoursFeriesNationaux.findOneAndUpdate(
      { anneeScolaire },
      { $set: { jours, complet: true, recupereLe, version: VERSION_REGLE } },
      { upsert: true }
    );
  }

  return retenir(anneeScolaire, { jours, complet: religieuses.complet, recupereLe });
}

/** Garde une heure en mémoire de processus, et rend la valeur telle quelle. */
function retenir(anneeScolaire, valeur) {
  memoire.set(anneeScolaire, { valeur, expire: Date.now() + TTL_MEMOIRE });
  return valeur;
}

/** Vide le cache mémoire — utilisé par les tests, qui rejouent la même année. */
export function oublierMemoire() {
  memoire.clear();
}

/** Tri par date, doublons `date|libellé` écartés. */
function trier(feries) {
  const vues = new Set();
  return feries
    .filter((ferie) => {
      const cle = `${ferie.date}|${ferie.libelle}`;
      if (vues.has(cle)) return false;
      vues.add(cle);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
