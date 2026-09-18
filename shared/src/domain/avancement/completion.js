import { lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import { taux } from './agregation.js';

/**
 * L'ACHÈVEMENT des modules — combien sont terminés, lesquels traînent, et
 * quand chacun a réellement tourné.
 * ← `calculateAndDisplayModuleCompletion()` d'avancement.html (l. 3266-3320)
 *   + `get_modules_completion_dates.php`
 *
 * ═══ ⚠️ UN MODULE, C'EST UN COUPLE (GROUPE, MODULE) ═══
 * Pas un code de module. « M101 » n'est pas achevé ou non dans l'absolu : il
 * l'est pour GM101 et pas pour GM102. L'existant itérait déjà
 * `dataByModule[code][groupe]`, et les vues agrégées de l'écran — qui réunissent
 * les groupes d'un module — ne peuvent donc pas répondre à cette question.
 */

/**
 * ⚠️ 95 %, LE SEUIL DE L'EXISTANT (décision du porteur, 2026-08-31 : « comme
 * l'existant »). C'est le chiffre que les établissements connaissent déjà, et
 * l'écart avec 100 % est assumé : un module dont il reste une demi-séance est
 * tenu pour fait.
 */
export const SEUIL_ACHEVEMENT = 95;

/**
 * @param {Array} lignes — telles que la route d'avancement les rend
 * @returns {{acheves, enCours, total, taux, details: Array}}
 */
export function completionModules(lignes = [], { seuil = SEUIL_ACHEVEMENT } = {}) {
  const details = [];

  for (const ligne of lignes) {
    /*
     * ═══ ⚠️ LA LIGNE PORTE LES DEUX TYPES, PAS LEUR SOMME ═══
     * `prevu` et `realise` sont produits par `finaliser()` de l'AGRÉGATION ; une
     * ligne brute, elle, ne connaît que `prevuPresentiel` / `prevuSynchrone`.
     * Ma première version les lisait tels quels : `prevu` valait `undefined`, le
     * garde ci-dessous écartait TOUTES les lignes, et le bloc ne s'affichait
     * jamais — sans la moindre erreur. Mes tests ne l'ont pas vu parce que leur
     * fixture inventait ces deux champs.
     *
     * ⚠️ ON SOMME SANS DÉDOUBLONNER, et c'est juste ICI : une ligne est un couple
     * (groupe, module), et chaque groupe REÇOIT bien la séance mutualisée. Le
     * dédoublonnage ne vaut que lorsqu'on agrège plusieurs groupes.
     */
    const prevu = arrondir((ligne.prevuPresentiel ?? 0) + (ligne.prevuSynchrone ?? 0));
    const realise = arrondir((ligne.realisePresentiel ?? 0) + (ligne.realiseSynchrone ?? 0));

    /*
     * ⚠️ SANS MASSE AFFECTÉE, LE MODULE NE COMPTE PAS — ni au numérateur ni au
     * dénominateur. L'existant testait `if (affecte > 0)` : un module que
     * personne n'assure n'est ni achevé ni en retard, et l'inclure ferait
     * plonger le taux d'achèvement pour une raison qui n'est pas pédagogique.
     */
    if (!(prevu > 0)) continue;

    const pourcentage = taux(realise, prevu);

    details.push({
      groupe: ligne.groupe,
      module: ligne.module,
      /*
       * ⚠️ LES DEUX FORMATEURS, PAS UN SEUL : le présentiel et le synchrone d'un
       * même module peuvent être assurés par deux personnes. N'en nommer qu'une
       * attribuerait le module à qui n'en fait que la moitié.
       */
      formateurs: [
        ...new Set([ligne.formateurPresentiel, ligne.formateurSynchrone].filter(Boolean)),
      ],
      prevu,
      realise,
      taux: pourcentage,
      semestre: ligne.semestre ?? '',
      estRegional: Boolean(ligne.estRegional),
      acheve: pourcentage !== null && pourcentage >= seuil,
    });
  }

  /*
   * ⚠️ « EN COURS » D'ABORD, comme l'existant : c'est la liste de ce qu'il reste
   * à faire. Les modules achevés n'appellent aucune action et n'ont pas à
   * occuper le haut du tableau.
   */
  details.sort((a, b) => {
    if (a.acheve !== b.acheve) return a.acheve ? 1 : -1;
    return a.groupe.localeCompare(b.groupe, 'fr', { numeric: true });
  });

  const acheves = details.filter((detail) => detail.acheve).length;

  return {
    acheves,
    enCours: details.length - acheves,
    total: details.length,
    taux: taux(acheves, details.length),
    details,
  };
}

/**
 * La plage de semaines réellement occupée par une liste de numéros.
 *
 * ⚠️ ON TRIE SUR LE NUMÉRO, jamais sur la chaîne : « S10 » précède « S2 » en
 * ordre alphabétique, et la plage se lirait à l'envers.
 */
export function plageDeSemaines(numeros = []) {
  const valides = numeros.filter((numero) => Number.isInteger(numero) && numero > 0);
  if (valides.length === 0) return null;

  return { debut: Math.min(...valides), fin: Math.max(...valides) };
}

/**
 * Les dates d'une plage de semaines — du lundi de la première au SAMEDI de la
 * dernière.
 *
 * ═══ ⚠️ DEUX DÉFAUTS DE L'EXISTANT NON REPRODUITS ═══
 * 1. Il recalculait le lundi de la S1 à sa façon (`$firstSept` puis un décalage
 *    au lundi suivant) — la variante que le §2 du plan signale comme fausse. On
 *    part de `lundiPremiereSemaine`, comme partout.
 * 2. Il forçait la fin au VENDREDI (`+4 days`). La grille porte SIX jours : un
 *    module qui finit le samedi voyait sa plage close la veille.
 */
export function datesDeLaPlage(anneeScolaire, plage) {
  if (!Number.isInteger(anneeScolaire) || !plage) return null;

  const origine = lundiPremiereSemaine(anneeScolaire);

  const debut = new Date(origine);
  debut.setDate(debut.getDate() + (plage.debut - 1) * 7);

  const fin = new Date(origine);
  fin.setDate(fin.getDate() + (plage.fin - 1) * 7 + 5); // lundi + 5 = samedi

  return { debut: enJour(debut), fin: enJour(fin) };
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
function enJour(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
