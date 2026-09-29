import { anneeScolaire, lundiPremiereSemaine } from './anneeScolaire.js';

/**
 * Semaines scolaires — conversion entre dates et identifiants « 2026-W3 ».
 *
 * ← public/emploi.html (getWeekInfo, parseWeekValue, getDateFromAcademicWeek)
 *
 * ⚠️ Ce ne sont PAS les semaines ISO 8601. La numérotation est propre à
 * l'établissement : **S1 est la semaine contenant le 1er septembre**, et elle
 * s'incrémente ensuite sans remise à zéro au 1er janvier. La S18 tombe donc en
 * plein hiver.
 *
 * L'identifiant `AAAA-Wn` est la clé de `emplois_du_temps.valeur_semaine` :
 * s'il change, les grilles déjà saisies deviennent introuvables. Caractérisé
 * sur les 50 semaines réellement enregistrées en production.
 */

const MS_PAR_SEMAINE = 7 * 24 * 60 * 60 * 1000;

/*
 * ═══ ⚠️ SEPT JOURS — CE N'EST PAS LE `JOURS` DES CONSTANTES ═══
 * Celui-ci sert à CALCULER DES DATES : il lui faut la semaine civile entière,
 * dimanche compris. `JOURS` de `shared/constants` en compte SIX — les jours
 * OUVRÉS, ceux que porte une grille.
 *
 * Les deux portaient le même nom, et le barillet du domaine les ré-exportait
 * tous les deux : un écran qui importait `JOURS` de `shared/domain` recevait
 * celui-ci, et dessinait une colonne « Dimanche » que le domaine ne remplissait
 * jamais. Constaté sur la page de consultation. Renommé — deux listes
 * différentes ne peuvent pas porter le même nom, c'est la leçon déjà tirée sur
 * `calculerCharges`.
 */
const JOURS_SEMAINE_CIVILE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function auDebutDuJour(date) {
  const copie = new Date(date);
  copie.setHours(0, 0, 0, 0);
  return copie;
}

/** Lundi de la semaine contenant cette date. */
export function lundiDeLaSemaine(date) {
  const lundi = new Date(date);
  const jour = lundi.getDay();
  // Dimanche (0) appartient à la semaine qui s'achève, d'où le -6.
  lundi.setDate(lundi.getDate() - jour + (jour === 0 ? -6 : 1));
  return auDebutDuJour(lundi);
}

/**
 * Numéro de semaine d'une date DANS une année scolaire IMPOSÉE.
 *
 * ═══ ⚠️ CE N'EST PAS `semaineDe` ═══
 * Celle-ci répond à « à quelle semaine de SON année appartient cette date ? ».
 * Ici l'année est donnée par l'appelant, et c'est le seul calcul juste dès que
 * la date et l'année ne coïncident pas — le cas de l'import e-note, préparé fin
 * août pour l'année qui s'ouvre : `semaineDe` le rangerait en S51 de l'année qui
 * s'achève, alors qu'il alimente la S1 de la suivante.
 *
 * ⚠️ UNE DATE ANTÉRIEURE À L'ANCRE RELÈVE DE LA S1 — comportement de l'existant,
 * conservé : un travail fait avant la rentrée vaut pour la première semaine.
 *
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees] — celles
 *   de `annee` ; voir `lundiPremiereSemaine`. Omises, S1 reste au 1er septembre.
 * @returns {{anneeScolaire: number, numero: number, lundi: Date}}
 */
export function semaineDansAnnee(annee, date, rentrees = []) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('semaineDansAnnee attend une année scolaire entière');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('semaineDansAnnee attend une Date valide');
  }

  const ancre = lundiPremiereSemaine(annee, rentrees);
  const lundi = lundiDeLaSemaine(date);

  const numero =
    lundi >= ancre ? Math.floor((lundi.getTime() - ancre.getTime()) / MS_PAR_SEMAINE) + 1 : 1;

  return { anneeScolaire: annee, numero, lundi };
}

/**
 * Le numéro de semaine à AFFICHER dans un calendrier, ou `null` avant que
 * l'année n'ait commencé.
 *
 * ═══ ⚠️ CE N'EST PAS `semaineDansAnnee` (2026-09-27, demande du porteur :
 * « il faut qu'il y ait un seul S1 ») ═══
 * Celle-ci RANGE une date antérieure à l'ancre dans la S1 — une règle juste
 * pour CLASSER une donnée (un import e-note fait avant la rentrée compte pour
 * la première semaine), mais fausse pour un CALENDRIER : dès que S1 s'ouvre
 * sur une rentrée tardive (le 7 septembre, par exemple), toutes les semaines
 * d'août se voyaient alors étiquetées « 1 » — la même colonne « Sem » répétant
 * un même numéro sur cinq lignes, quand chacune est une semaine CALENDAIRE
 * différente. Ici, une semaine antérieure à l'ancre ne porte simplement AUCUN
 * numéro — elle n'est pas encore dans l'année scolaire qu'on affiche.
 *
 * @param {number} annee — l'année scolaire AFFICHÉE, donnée par l'appelant
 *   (comme `semaineDansAnnee`, pour la même raison : la déduire de `date`
 *   romprait sur un jour d'août qui précède encore l'ancre).
 * @param {Date} date
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees]
 * @returns {number|null}
 */
export function semaineAffichable(annee, date, rentrees = []) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('semaineAffichable attend une année scolaire entière');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('semaineAffichable attend une Date valide');
  }

  const ancre = lundiPremiereSemaine(annee, rentrees);
  const lundi = lundiDeLaSemaine(date);
  if (lundi < ancre) return null;

  return semaineDansAnnee(annee, date, rentrees).numero;
}

/**
 * Numéro de semaine scolaire d'une date, dans SA propre année.
 *
 * ⚠️ SANS `rentrees`, L'ANNÉE ELLE-MÊME (`anneeScolaire(date)`) RESTE ANCRÉE AU
 * 1er SEPTEMBRE : la classifier par rentrée demanderait de connaître déjà LA
 * rentrée de l'année qui la contient — une dépendance circulaire que cette
 * fonction ne résout pas. Seul le NUMÉRO à l'intérieur de cette année en tient
 * compte.
 *
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees]
 * @returns {{anneeScolaire: number, numero: number, lundi: Date}}
 */
export function semaineDe(date, rentrees = []) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('semaineDe attend une Date valide');
  }

  return semaineDansAnnee(anneeScolaire(date), date, rentrees);
}

/**
 * Identifiant de semaine, au format de `emplois_du_temps.valeur_semaine`.
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees]
 */
export function valeurSemaine(date, rentrees = []) {
  const { anneeScolaire: annee, numero } = semaineDe(date, rentrees);
  return `${annee}-W${numero}`;
}

/**
 * Décompose un identifiant « 2026-W3 ».
 *
 * @param {string} valeur
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees] — celles
 *   de l'année portée par `valeur` ; voir `lundiPremiereSemaine`.
 * @returns {{anneeScolaire: number, numero: number, debut: Date, fin: Date}|null}
 *   null si le format est invalide — jamais une exception : ces valeurs
 *   viennent d'URL et de données anciennes.
 */
export function analyserSemaine(valeur, rentrees = []) {
  // ⚠️ `\d{1,3}` et non `\d{1,2}` : la production contient « 2026-W039 »,
  // avec un zéro de remplissage. `parseWeekValue()` l'acceptait sans le savoir
  // (`parseInt` ignore les zéros initiaux). Une expression plus stricte ferait
  // silencieusement disparaître cette grille lors de l'ETL.
  const correspondance = /^(\d{4})-W(\d{1,3})$/.exec(String(valeur ?? '').trim());
  if (!correspondance) return null;

  const annee = Number.parseInt(correspondance[1], 10);
  const numero = Number.parseInt(correspondance[2], 10);
  if (numero < 1) return null;

  const debut = new Date(lundiPremiereSemaine(annee, rentrees));
  debut.setDate(debut.getDate() + (numero - 1) * 7);

  const fin = new Date(debut);
  fin.setDate(debut.getDate() + 6);

  return { anneeScolaire: annee, numero, debut: auDebutDuJour(debut), fin: auDebutDuJour(fin) };
}

/**
 * Forme canonique d'un identifiant de semaine.
 *
 * Nécessaire à l'ETL : `emplois_du_temps` contient « 2026-W039 » à côté de
 * « 2026-W3 », « 2026-W37 »… Sans normalisation, la même semaine peut exister
 * sous deux clés, et une grille devient introuvable selon la façon dont on la
 * cherche.
 *
 * @returns {string|null} « 2026-W39 », ou null si l'entrée est inexploitable.
 */
export function normaliserValeurSemaine(valeur, rentrees = []) {
  const semaine = analyserSemaine(valeur, rentrees);
  return semaine ? `${semaine.anneeScolaire}-W${semaine.numero}` : null;
}

/**
 * Date d'un jour nommé dans une semaine donnée.
 * ← getDateFromAcademicWeek(), utilisée pour dater les absences.
 *
 * @param {string} valeur  « 2026-W3 »
 * @param {string} jour    « Lundi » … « Dimanche »
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees]
 * @returns {Date|null}
 */
export function dateDuJour(valeur, jour, rentrees = []) {
  const semaine = analyserSemaine(valeur, rentrees);
  if (!semaine) return null;

  const decalage = JOURS_SEMAINE_CIVILE.indexOf(jour);
  if (decalage === -1) return null;

  const date = new Date(semaine.debut);
  date.setDate(date.getDate() + decalage);
  return auDebutDuJour(date);
}

/**
 * Les sept dates d'une semaine, du lundi au dimanche.
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees]
 */
export function datesDeLaSemaine(valeur, rentrees = []) {
  const semaine = analyserSemaine(valeur, rentrees);
  if (!semaine) return [];

  return JOURS_SEMAINE_CIVILE.map((_, index) => {
    const date = new Date(semaine.debut);
    date.setDate(date.getDate() + index);
    return auDebutDuJour(date);
  });
}

export { JOURS_SEMAINE_CIVILE };

/**
 * Le libellé LISIBLE d'une semaine — « S1 - 2026 », ou « S1 » en court.
 *
 * ⚠️ `2026-W1` EST LA VALEUR STOCKÉE, pas un affichage. C'est la forme de
 * `emplois_du_temps.valeur_semaine`, lisible seulement pour qui connaît le
 * format. À l'écran une semaine scolaire se dit « S1 », comme dans le
 * chronogramme et sur la colonne « Sem » des stages.
 *
 * La règle vit ICI et non dans un écran : elle est déjà employée par la barre de
 * navigation, le panneau de statistiques et les menus d'import et de
 * réinitialisation. Quatre exemplaires auraient dérivé.
 */
export function libelleSemaine(valeur, { court = false } = {}) {
  const analyse = analyserSemaine(valeur);
  if (!analyse) return String(valeur ?? '—');

  return court ? `S${analyse.numero}` : `S${analyse.numero} - ${analyse.anneeScolaire}`;
}
