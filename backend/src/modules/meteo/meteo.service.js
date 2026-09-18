import { localiserEtablissement } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { logger } from '../../lib/logger.js';

/**
 * La météo du moment, là où se trouve l'établissement.
 *
 * ═══ ⚠️ POURQUOI OPEN-METEO ═══
 * **Aucune clé d'API.** C'est le critère décisif ici : le §Phase 0 du plan
 * recense quatre secrets qui ont fini dans l'historique Git (MySQL, SMTP,
 * UltraMsg, Gemini) et qu'il faudra faire tourner. Une source qui n'en demande
 * pas n'ajoute rien à cette dette. Usage non commercial libre, pas d'inscription.
 *
 * ═══ ⚠️ POURQUOI CÔTÉ SERVEUR ═══
 * C'est la règle du §10.1, déjà appliquée aux jours fériés
 * (`agendaMaroc.service.js`) : le domaine ne va jamais chercher de données, et
 * un appel lancé depuis le navigateur devrait être ouvert dans la CSP stricte
 * prévue en Phase 11. Le cache, lui, est PARTAGÉ par tous les utilisateurs de
 * l'établissement au lieu d'être refait par chaque onglet.
 */

const RACINE = 'https://api.open-meteo.com/v1/forecast';
const DELAI = 5_000;

/**
 * ⚠️ UNE DEMI-HEURE. La météo d'un lieu ne change pas plus vite, et ce bloc est
 * relu à chaque ouverture de l'accueil : sans cache, une trentaine d'appels par
 * jour et par directeur pour une icône.
 */
const DUREE_CACHE = 30 * 60 * 1000;

/** Clé : « lat,lon ». Vit dans le processus — se vide au redémarrage, sans conséquence. */
const cache = new Map();

/** Exporté pour les tests : le cache survit d'un test à l'autre sinon. */
export function oublierMemoire() {
  cache.clear();
}

/**
 * @returns {Promise<{ville, code, estJour, temperature}|null>} `null` dès que
 *   quelque chose manque — lieu inconnu, appel en échec, réponse inexploitable.
 *   L'accueil retombe alors sur son emblème horaire : une icône de météo est un
 *   agrément, jamais une raison de casser la page.
 */
export async function meteoDeLEtablissement(etablissementId) {
  const etablissement = await Etablissement.findById(etablissementId)
    .select('nom region')
    .lean();
  if (!etablissement) return null;

  const lieu = localiserEtablissement(etablissement);
  if (!lieu) {
    logger.debug({ etablissementId }, 'météo : lieu non reconnu');
    return null;
  }

  const releve = await releverAvecCache(lieu);
  return releve ? { ville: lieu.ville, ...releve } : null;
}

async function releverAvecCache({ latitude, longitude }) {
  const cle = `${latitude},${longitude}`;
  const garde = cache.get(cle);
  if (garde && Date.now() - garde.pose < DUREE_CACHE) return garde.releve;

  const releve = await relever(latitude, longitude);

  /* ⚠️ ON NE MET EN CACHE QU'UN SUCCÈS : garder un échec pendant trente minutes
     ferait durer une panne d'une seconde bien au-delà d'elle-même. */
  if (releve) cache.set(cle, { pose: Date.now(), releve });

  return releve;
}

async function relever(latitude, longitude) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI);

  const parametres = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'weather_code,temperature_2m,is_day',
    timezone: 'auto',
  });

  try {
    const reponse = await fetch(`${RACINE}?${parametres}`, {
      signal: controleur.signal,
      headers: { Accept: 'application/json' },
    });

    if (!reponse.ok) {
      logger.warn({ statut: reponse.status }, 'open-meteo : réponse en échec');
      return null;
    }

    const donnees = await reponse.json();
    const courant = donnees?.current;

    /* Le statut HTTP ne suffit pas : une réponse bien formée mais sans relevé
       donnerait un code `undefined`, que l'écran rendrait en icône « inconnu ». */
    if (!courant || typeof courant.weather_code !== 'number') {
      logger.warn('open-meteo : réponse inexploitable');
      return null;
    }

    return {
      /* Code météo WMO — la nomenclature de l'OMM, que l'écran traduit en icône. */
      code: courant.weather_code,
      /*
       * ⚠️ LE JOUR VIENT DE L'API, PAS DE L'HEURE DU NAVIGATEUR : le lever et le
       * coucher se déplacent de plus d'une heure dans l'année, et un soleil
       * affiché après la tombée de la nuit se remarque tout de suite.
       */
      estJour: courant.is_day === 1,
      temperature:
        typeof courant.temperature_2m === 'number' ? Math.round(courant.temperature_2m) : null,
    };
  } catch (erreur) {
    logger.warn({ erreur: erreur.message }, 'open-meteo : appel impossible');
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}
