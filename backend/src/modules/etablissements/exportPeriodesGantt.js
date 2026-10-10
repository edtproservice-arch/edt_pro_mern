import { semaineAffichable } from 'shared/domain';

/**
 * La grille GANTT de l'export des périodes — ce que la frise de l'écran montre
 * à l'échelle « Mois » (2026-10-10, demande du porteur : « en mode calendrier,
 * l'export applique le même affichage »).
 *
 * Une colonne par SEMAINE scolaire, regroupées sous leur mois ; une ligne par
 * sujet ; une case colorée quand une période touche la semaine, de la teinte
 * de son RANG dans la ligne (1re bleue, 2e magenta…), comme les barres de la
 * frise. Les semaines de vacances sont teintées en bleu pâle.
 *
 * ⚠️ À LA SEMAINE, PAS AU JOUR : un document imprimé n'a pas la place de 322
 * colonnes. Les dates exactes suivent, dans le tableau de liste du même
 * document.
 *
 * ⚠️ LES JOURS SONT COMPTÉS EN UTC (`Date.UTC`) : une soustraction de dates
 * locales tomberait d'une heure à côté au changement d'heure, et l'arrondi
 * pourrait décaler une période d'une semaine.
 */

export const NOMBRE_SEMAINES = 46; // de la semaine du 1er septembre à mi-juillet, comme la frise

// Mêmes teintes que la frise (`TEINTES` de FrisePeriodes.jsx), en hexadécimal.
export const TEINTES_GANTT = ['2563EB', 'DB2777', '059669', 'F59E0B'];
/*
 * ⚠️ LE BLEU DES VACANCES DU CHRONOGRAMME (2026-10-10, demande du porteur) :
 * `bg-primary/10` sur la colonne, soit le bleu primaire #0075DE à 10 % sur
 * blanc. Une même notion garde sa couleur d'un écran — et d'un document — à
 * l'autre.
 */
export const TEINTE_VACANCES = 'E6F1FC';
// Le badge « VAC » : `bg-primary/20 text-primary`.
export const BADGE_VACANCES = 'CCE3F8';
export const TEXTE_VACANCES = '0075DE';
// Le badge « N JF » : `bg-warning/40` (ambre #F59E0B à 40 % sur blanc).
export const BADGE_FERIE = 'FBD89D';

const UN_JOUR = 86400000;
const jourUtc = (texte) => {
  const [annee, mois, date] = String(texte).split('-').map(Number);
  return Date.UTC(annee, mois - 1, date) / UN_JOUR;
};

/** Les vacances qui s'appliquent — la règle de `frontend/src/lib/vacancesEffectives.js`. */
export function vacancesEffectives(calendrier) {
  const cle = (nom) => String(nom ?? '').trim().toLowerCase();
  const ecartees = new Set((calendrier?.ecartees ?? []).map(cle));
  const vues = new Set();
  return [
    ...(calendrier?.nationales ?? []).filter((periode) => !ecartees.has(cle(periode.intitule))),
    ...(calendrier?.vacances ?? []),
  ].filter((periode) => {
    const identite = `${periode.debut}|${periode.fin}`;
    if (!periode.debut || !periode.fin || vues.has(identite)) return false;
    vues.add(identite);
    return true;
  });
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * @param {{sujets: Array<{sujet: string, periodes: Array<{debut: string, fin: string}>}>, anneeScolaire: number}} donnees
 * @param {object} [calendrier] — la réponse de `calendrier.service.obtenir`
 */
export function grilleGantt({ sujets, anneeScolaire }, calendrier) {
  // Le lundi de la semaine du 1er septembre — en jours UTC.
  const premier = Date.UTC(anneeScolaire, 8, 1) / UN_JOUR;
  const jourSemaine = new Date(premier * UN_JOUR).getUTCDay(); // 0 = dimanche
  const debut = premier - ((jourSemaine + 6) % 7);

  const rentrees = calendrier?.rentrees ?? [];
  const semaines = Array.from({ length: NOMBRE_SEMAINES }, (_, rang) => {
    const lundi = debut + rang * 7;
    const date = new Date(lundi * UN_JOUR);
    const locale = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return {
      lundi,
      // Le mois d'une semaine est celui de son JEUDI : la règle ISO, qui évite
      // qu'une semaine à cheval sur deux mois soit comptée dans le mauvais.
      mois: new Date((lundi + 3) * UN_JOUR).getUTCMonth(),
      annee: new Date((lundi + 3) * UN_JOUR).getUTCFullYear(),
      numero: semaineAffichable(anneeScolaire, locale, rentrees),
    };
  });

  const mois = [];
  for (const semaine of semaines) {
    const cle = `${semaine.annee}-${semaine.mois}`;
    if (mois.at(-1)?.cle !== cle) mois.push({ cle, libelle: `${MOIS[semaine.mois]} ${String(semaine.annee).slice(2)}`, semaines: 0 });
    mois.at(-1).semaines += 1;
  }

  const chevauche = (debutPeriode, finPeriode, lundi) =>
    Math.min(finPeriode, lundi + 6) - Math.max(debutPeriode, lundi) + 1;

  // Une semaine est « de vacances » si au moins 4 de ses jours le sont.
  const vacances = vacancesEffectives(calendrier).map((p) => [jourUtc(p.debut), jourUtc(p.fin)]);
  const semainesVacances = semaines.map(({ lundi }) =>
    vacances.some(([a, b]) => chevauche(a, b, lundi) >= 4)
  );

  // Le nombre de jours fériés de chaque semaine (badge « N JF »).
  const feriesParSemaine = semaines.map(() => 0);
  for (const ferie of calendrier?.joursFeries ?? []) {
    const rang = Math.floor((jourUtc(ferie.date) - debut) / 7);
    if (rang >= 0 && rang < NOMBRE_SEMAINES) feriesParSemaine[rang] += 1;
  }

  const lignes = sujets.map((sujet) => ({
    sujet: sujet.sujet,
    detail: sujet.detail,
    // Le rang de la PREMIÈRE période qui touche la semaine, ou null.
    cases: semaines.map(({ lundi }) => {
      const rang = sujet.periodes.findIndex((p) => chevauche(jourUtc(p.debut), jourUtc(p.fin), lundi) > 0);
      return rang === -1 ? null : rang;
    }),
  }));

  return { semaines, mois, semainesVacances, feriesParSemaine, lignes };
}
