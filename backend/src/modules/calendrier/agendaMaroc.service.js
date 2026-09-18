import { logger } from '../../lib/logger.js';

/**
 * Jours fériés marocains officiels — agendamaroc.com.
 *
 * ═══ POURQUOI CETTE SOURCE PLUTÔT QUE api.aladhan.com ═══
 * `aladhan` ne donne que les fêtes RELIGIEUSES, mois par mois : 24 appels pour
 * une année scolaire, dont deux à trois échouaient régulièrement. Les fériés
 * civils devaient être codés en dur à côté, avec leurs libellés.
 *
 * Cette API rend l'année entière en UN appel, avec :
 *   - `name_fr` / `name_ar` — les intitulés officiels, plus besoin de les tenir
 *     à la main ni de les traduire ;
 *   - `variable` — qui distingue enfin une ESTIMATION lunaire d'une date fixe.
 *     L'écran marquait « (estimé) » sur tout, Nouvel An et Fête du Travail
 *     compris, ce qui privait la mention de son sens.
 *
 * ⚠️ Elle ne couvre que **2026, 2027 et 2028** (vérifié : `year=2025` répond
 * « Year 2025 not supported »). L'ancienne chaîne reste donc en place pour les
 * années hors de cette fenêtre — voir `obtenirNationaux`.
 */

const RACINE = 'https://agendamaroc.com/api/agenda/feries';
const DELAI = 10_000;

/** Années servies par l'API, d'après sa propre documentation. */
export const ANNEES_COUVERTES = [2026, 2027, 2028];

export const couvre = (annee) => ANNEES_COUVERTES.includes(annee);

/**
 * Fériés d'une année CIVILE.
 *
 * @returns {Promise<Array<{date, libelle, libelleAr, type, estime}>|null>}
 *   `null` si l'année n'est pas couverte ou si l'appel échoue — l'appelant
 *   bascule alors sur l'autre source plutôt que de rendre une année amputée.
 */
export async function feriesDeLAnnee(annee) {
  if (!couvre(annee)) return null;

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI);

  try {
    const reponse = await fetch(`${RACINE}?year=${annee}&lang=fr`, {
      signal: controleur.signal,
      headers: { Accept: 'application/json' },
    });

    if (!reponse.ok) {
      logger.warn({ annee, statut: reponse.status }, 'agendamaroc : réponse en échec');
      return null;
    }

    const donnees = await reponse.json();

    // L'API répond 200 avec `{error: ...}` pour une année non servie : le
    // statut HTTP ne suffit pas à valider la réponse.
    if (donnees?.error || !Array.isArray(donnees?.holidays)) {
      logger.warn({ annee, erreur: donnees?.error }, 'agendamaroc : réponse inexploitable');
      return null;
    }

    return donnees.holidays.map(normaliser).filter((ferie) => ferie !== null);
  } catch (erreur) {
    logger.warn({ annee, erreur: erreur.message }, 'agendamaroc : appel impossible');
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/** Une entrée de l'API vers la forme du domaine, ou `null` si inexploitable. */
function normaliser(brut) {
  const date = String(brut?.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const libelle = String(brut?.name_fr || brut?.name || '').trim();
  if (libelle === '') return null;

  return {
    date,
    libelle,
    libelleAr: String(brut?.name_ar ?? '').trim(),
    // `national`, `religieux` ou `amazigh` — sert à la couleur et au tri.
    type: ['national', 'religieux', 'amazigh'].includes(brut?.type) ? brut.type : 'national',
    /*
     * Le point qui rend la mention « estimé » utile : seules les fêtes du
     * calendrier lunaire sont des estimations, confirmées après observation de
     * la lune par le ministère des Habous. Une date fixe n'en est pas une.
     */
    estime: brut?.variable === true,
  };
}
