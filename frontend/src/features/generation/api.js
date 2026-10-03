import { api } from '@/lib/apiClient';

/**
 * Génération automatique (F6).
 * ← le bouton « Lancer la Génération » de emploi.html
 */

/**
 * Ce qu'une génération remplacerait — sans rien écrire.
 *
 * ⚠️ EN POST BIEN QUE CE SOIT UNE LECTURE : quarante-cinq semaines en chaîne de
 *    requête se heurteraient aux limites de longueur des proxys, et l'échec
 *    serait intermittent.
 */
export function previsualiser(semaines) {
  return api.post('/api/v2/generation/previsualisation', { semaines });
}

/**
 * Les semaines figées de l'année (vacances, ou fériés sur tous les jours) :
 * le dialogue les grise, le serveur ne les génère jamais.
 */
export function chargerSemainesFigees() {
  return api.get('/api/v2/generation/semaines-figees');
}

/**
 * Ce que chaque assouplissement RÉCUPÉRERAIT sur ces semaines — sans rien écrire.
 *
 * ⚠️ LA RÉPONSE EST SOUVENT ZÉRO, ET C'EST L'INFORMATION UTILE. Depuis que les
 *    consignes des formateurs sont souples, le solveur les emploie déjà en
 *    dernier recours : les « lever » ne récupère plus rien. Mieux vaut le dire
 *    que laisser cliquer et attendre.
 */
export function simuler(semaines) {
  return api.post('/api/v2/generation/simulation', { semaines });
}

/**
 * Lance la génération et suit son avancement.
 *
 * ⚠️ LE FLUX RESTITUE, IL NE PILOTE PAS. Si la connexion se coupe, la
 *    génération continue côté serveur et va à son terme : l'interrompre à
 *    moitié laisserait la moitié des semaines écrites et l'autre non, sans que
 *    personne sache lesquelles.
 *
 * @param {object} demande
 * @param {string} [demande.moteur] — `MOTEURS.CPSAT` pour la recherche approfondie
 * @param {(etape: {rang: number, total: number, semaine: string}) => void} onProgres
 * @returns {Promise<object>} le rapport complet
 */
export async function generer({ semaines, graine, assouplissement, moteur }, { onProgres } = {}) {
  let rapport = null;
  let erreur = null;

  await api.flux(
    '/api/v2/generation/flux',
    {
      semaines,
      ...(graine != null ? { graine } : {}),
      assouplissement,
      /*
       * ⚠️ OMIS PLUTÔT QU'ENVOYÉ VIDE : le serveur a un défaut (`glouton`), et
       *    `moteur: undefined` disparaîtrait de toute façon à la sérialisation
       *    JSON. L'écrire explicitement ne dit rien de plus et laisse croire
       *    que le front décide, alors que le défaut est posé côté serveur.
       */
      ...(moteur ? { moteur } : {}),
    },
    {
      onEvenement: (type, charge) => {
        if (type === 'progres') onProgres?.(charge);
        else if (type === 'termine') rapport = charge;
        else if (type === 'erreur') erreur = charge;
      },
    }
  );

  /*
   * ⚠️ UNE ERREUR ARRIVÉE DANS LE FLUX EST UNE VRAIE ERREUR. L'en-tête HTTP
   *    étant déjà parti quand elle survient, le serveur ne peut plus rendre de
   *    code : sans cette relance, la promesse se résoudrait avec `null` et
   *    l'écran annoncerait une génération réussie qui n'a pas eu lieu.
   */
  if (erreur) {
    throw Object.assign(new Error(erreur.message ?? 'La génération a échoué'), {
      code: erreur.code,
    });
  }

  if (!rapport) {
    // Flux interrompu avant la fin : la génération, elle, se poursuit.
    throw Object.assign(new Error('La génération a été interrompue avant son terme'), {
      code: 'FLUX_INTERROMPU',
    });
  }

  return rapport;
}
