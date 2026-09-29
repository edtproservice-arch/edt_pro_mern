import { JOURS, PERIODES } from '../../constants/index.js';
import { propositionSchema, SEANCES_PROPOSABLES } from '../../schemas/proposition.js';

/**
 * Appliquer une proposition : ce qu'il faut vider, poser, et ce qui l'empêche.
 * ← la boucle `foreach ($days_to_process …)` de apply_proposition.php
 *
 * ═══ APPLIQUER UN JOUR REMPLACE LE JOUR (décision du porteur, 2026-09-23) ═══
 * Comme l'existant : les quatre créneaux du formateur ce jour-là deviennent
 * ceux de la proposition, et un créneau laissé vide est VIDÉ. La proposition
 * part de son emploi actuel (la grille est préremplie) : un créneau vide est
 * donc une séance qu'il demande de retirer, pas un oubli.
 *
 * ═══ ⚠️ CE QUI NE SE REMPLACE PAS ═══
 * Une séance PROTÉGÉE — un EFM, une absence, un rattrapage — ne vient pas du
 * formateur mais d'une décision du directeur ou d'un examen régional.
 * L'existant l'écrasait sans le savoir (le blob ne distinguait rien). Ici :
 *  · si la proposition laisse son créneau vide, elle RESTE ;
 *  · si la proposition y met autre chose, le jour est BLOQUÉ — c'est au
 *    directeur de trancher, pas à une proposition de l'effacer en silence.
 *
 * ⚠️ « RETIRER » EST LE MÊME CALCUL, avec les séances SAUVEGARDÉES à
 * l'application pour cible. L'existant vidait le jour, détruisant aussi ce qui
 * existait avant la proposition.
 *
 * @param {object} p
 * @param {string} p.jour
 * @param {Array} p.cible     les séances voulues ce jour-là (proposées, ou sauvegardées)
 * @param {Array} p.actuelles les séances ACTUELLES du formateur ce jour-là
 * @returns {{
 *   aVider: Array, aPoser: Array, inchangees: Array,
 *   protegees: Array, bloquantes: Array<{seance: string, message: string}>
 * }}
 */
export function planDuJour({ jour, cible = [], actuelles = [] }) {
  if (!JOURS.includes(jour)) {
    throw new TypeError(`planDuJour : jour inconnu « ${jour} »`);
  }

  const voulues = new Map(
    cible.filter((s) => s.jour === jour && SEANCES_PROPOSABLES.includes(s.seance)).map((s) => [s.seance, s])
  );
  const presentes = new Map(
    actuelles
      .filter(
        (s) =>
          s.jour === jour &&
          SEANCES_PROPOSABLES.includes(s.seance) &&
          (s.periode ?? PERIODES.JOUR) === PERIODES.JOUR
      )
      .map((s) => [s.seance, s])
  );

  const plan = { aVider: [], aPoser: [], inchangees: [], protegees: [], bloquantes: [] };

  for (const creneau of SEANCES_PROPOSABLES) {
    const voulue = voulues.get(creneau);
    const presente = presentes.get(creneau);

    if (presente && estProtegee(presente)) {
      plan.protegees.push(presente);
      if (voulue && !identiques(voulue, presente)) {
        plan.bloquantes.push({
          seance: creneau,
          message: `${jour} ${creneau} : ${libelleProtection(presente)} occupe déjà ce créneau`,
        });
      }
      continue;
    }

    if (voulue && presente && identiques(voulue, presente)) {
      plan.inchangees.push(presente);
      continue;
    }

    if (presente) plan.aVider.push(presente);
    if (voulue) plan.aPoser.push(voulue);
  }

  return plan;
}

/**
 * Une séance qu'une proposition ne peut pas remplacer.
 * ⚠️ `statut` absent vaut « planifie » : c'est le défaut du modèle.
 */
export function estProtegee(seance) {
  return (
    Boolean(seance?.estEfm) ||
    Boolean(seance?.rattrapageDe) ||
    (seance?.statut ?? 'planifie') !== 'planifie'
  );
}

function libelleProtection(seance) {
  if (seance.estEfm) return 'un EFM';
  if (seance.rattrapageDe || seance.statut === 'rattrape') return 'un rattrapage';
  if (seance.statut === 'absent') return 'une absence';
  return 'une séance protégée';
}

const cle = (valeur) => String(valeur ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Même groupe, même module, même salle : rien à écrire. */
export function identiques(a, b) {
  return cle(a.groupe) === cle(b.groupe) && cle(a.module) === cle(b.module) && cle(a.salle) === cle(b.salle);
}

/**
 * Valide une proposition et la rend en forme canonique.
 *
 * ⚠️ DEUX SÉANCES SUR UN MÊME CRÉNEAU SONT REFUSÉES, jamais départagées : le
 * formateur ne peut pas être à deux endroits, et garder « la dernière » ferait
 * disparaître une séance qu'il croit avoir proposée.
 *
 * @throws {Error} avec `code = 'PROPOSITION_INVALIDE'`
 */
export function normaliserProposition(entree) {
  const resultat = propositionSchema.safeParse(entree);
  if (!resultat.success) {
    throw erreurProposition(resultat.error.issues[0]?.message ?? 'Proposition invalide');
  }

  const vus = new Set();
  for (const s of resultat.data.seances) {
    const creneau = `${s.jour}|${s.seance}`;
    if (vus.has(creneau)) {
      throw erreurProposition(`Deux séances le ${s.jour} en ${s.seance}`);
    }
    vus.add(creneau);
  }

  const ordre = (s) => JOURS.indexOf(s.jour) * 10 + SEANCES_PROPOSABLES.indexOf(s.seance);
  return {
    ...resultat.data,
    seances: [...resultat.data.seances].sort((a, b) => ordre(a) - ordre(b)),
  };
}

function erreurProposition(message) {
  const erreur = new Error(message);
  erreur.code = 'PROPOSITION_INVALIDE';
  return erreur;
}

/**
 * L'état d'ensemble, déduit de celui de chaque jour.
 *
 * ⚠️ UN ÉTAT ENREGISTRÉ, PAS RECALCULÉ. L'existant comparait la proposition à
 * la grille pour deviner si elle était appliquée : qu'un directeur retouche
 * ensuite une case, et la proposition redevenait « à appliquer » — un second
 * clic l'aurait réécrite par-dessus sa correction.
 *
 * @param {Record<string, 'en_attente'|'appliquee'|'refusee'>} jours
 * @returns {'en_attente'|'partielle'|'appliquee'|'refusee'}
 */
export function statutGlobal(jours = {}) {
  const etats = JOURS.map((jour) => jours[jour] ?? 'en_attente');
  if (etats.every((e) => e === 'appliquee')) return 'appliquee';
  if (etats.every((e) => e === 'refusee')) return 'refusee';
  if (etats.some((e) => e === 'appliquee')) return 'partielle';
  return 'en_attente';
}

/** Les jours qu'une action vise : celui qu'on nomme, ou toute la semaine. */
export const joursVises = (jour) => (jour ? [jour] : [...JOURS]);
