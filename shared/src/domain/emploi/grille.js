import { JOURS, PERIODES, SEANCES } from '../../constants/index.js';
import { bornesAnneeScolaire, lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import { analyserSemaine, valeurSemaine } from '../planning/semaines.js';

/**
 * La grille d'emploi du temps d'une semaine.
 * ← `generateTimetable()` et `generateSoirTimetable()` de emploi.html
 *
 * ═══ ⚠️ LA GRILLE DE JOUR VA DE S1 À S4, PAS À S5 ═══
 * C'est ce que dit l'en-tête de l'existant : `colspan="4"` par jour, quatre
 * `time-header` de S1 à S4. **S5 est le créneau du SOIR**, dans un second
 * tableau. Étaler la grille de jour sur cinq colonnes ajouterait partout une
 * case que personne ne peut remplir, et ferait croire à un créneau libre.
 *
 * Le modèle `Seance` les distingue par `periode` — l'index unique la porte —,
 * donc un S5 de jour et un S5 du soir peuvent coexister sans se marcher dessus.
 */

/** Créneaux de la grille de JOUR. */
export const SEANCES_JOUR = SEANCES.slice(0, 4);

/** Le créneau unique de la grille du SOIR. */
export const SEANCE_SOIR = SEANCES[4];

/**
 * Les trois lignes que chaque sujet occupe.
 * ← les `type-cell` « Groupe » / « Module » / « Salle » de l'existant.
 *
 * En vue par groupe, la première ligne porte le FORMATEUR à la place du groupe :
 * c'est l'axe qu'on a déjà en tête de ligne qui change de place.
 */
export const LIGNES_FORMATEUR = ['Groupe', 'Module', 'Salle'];
export const LIGNES_GROUPE = ['Formateur', 'Module', 'Salle'];

/**
 * Seuils d'heures hebdomadaires d'un formateur, repris de l'existant.
 * `> 35` rouge, `> 22.5` orange — au-delà, la semaine ne tient pas.
 */
export const HEURES_SURCHARGE = 35;
export const HEURES_ELEVEES = 22.5;

/**
 * Durée d'une séance, en heures. ← `getSeanceDuration()`.
 *
 * ⚠️ LE CRÉNEAU DU SOIR DURE 2 H, PAS 2,5. C'est ce que dit l'existant, et une
 * constante plate faisait compter une demi-heure de trop par séance du soir —
 * la charge d'un formateur CDS aurait été surévaluée sans que rien ne le
 * signale.
 */
export const DUREE_JOUR = 2.5;
export const DUREE_SOIR = 2;

export const dureeSeance = (creneau) => (creneau === SEANCE_SOIR ? DUREE_SOIR : DUREE_JOUR);

/**
 * Indexe les séances d'une semaine pour un accès direct.
 *
 * ⚠️ LA CLÉ PORTE LA PÉRIODE. Sans elle, la séance du soir et celle du jour de
 * même créneau se remplaceraient l'une l'autre à l'affichage — et c'est
 * précisément le cas qui existe, S5 étant le créneau du soir.
 *
 * @returns {Map<string, object>} « sujet||jour||séance||période » → séance
 */
export function indexerSeances(seances = [], axe = 'formateur') {
  const index = new Map();

  for (const seance of seances) {
    const sujet = axe === 'groupe' ? seance.groupe : seance.formateurMatricule;
    if (!sujet) continue;

    index.set(cle(sujet, seance.jour, seance.seance, seance.periode), seance);
  }

  return index;
}

export const cle = (sujet, jour, seance, periode = PERIODES.JOUR) =>
  `${sujet}||${jour}||${seance}||${periode}`;

/**
 * Heures de la semaine, par sujet.
 *
 * ⚠️ UNE SÉANCE ABSENTE NE COMPTE PAS. Le formateur n'a pas assuré ces heures :
 * les additionner ferait croire sa semaine pleine alors qu'il faut la rattraper.
 * C'est aussi ce que fait le badge de l'existant, qui ne s'affiche pas sur une
 * cellule absente.
 */
export function heuresParSujet(seances = [], axe = 'formateur') {
  const heures = new Map();

  for (const seance of seances) {
    if (seance.statut === 'absent') continue;

    const sujet = axe === 'groupe' ? seance.groupe : seance.formateurMatricule;
    if (!sujet) continue;

    heures.set(sujet, (heures.get(sujet) ?? 0) + dureeSeance(seance.seance));
  }

  return heures;
}

/** La teinte du bloc de tête, selon la charge de la semaine. */
export function niveauCharge(heures) {
  if (heures > HEURES_SURCHARGE) return 'surcharge';
  if (heures > HEURES_ELEVEES) return 'eleve';
  return 'normal';
}

/**
 * Les groupes qui ont cours le SOIR.
 * ← `getCDSGroupes()` : ceux dont le nom porte « CDS ».
 *
 * ⚠️ C'est bien le NOM qui fait foi, pas un champ dédié : le suffixe « (CDS) »
 * est posé par le renommage de l'import e-note, et c'est la seule marque que
 * la base en garde.
 */
export function groupesDuSoir(groupes = []) {
  return groupes.filter((groupe) => String(groupe).toUpperCase().includes('CDS'));
}

/**
 * Assemble les lignes d'une grille : un sujet, ses trois lignes, ses colonnes.
 *
 * Rendre cette structure ici plutôt que dans le composant permet de la tester,
 * et surtout de n'avoir qu'UNE définition de ce qu'est une grille — la vue par
 * groupe et la vue par formateur ne sont que deux axes du même assemblage.
 *
 * @param {object} options
 * @param {string[]} options.sujets    matricules (vue formateur) ou noms de groupe
 * @param {Array} options.seances      séances de la semaine
 * @param {'formateur'|'groupe'} options.axe
 * @param {'jour'|'soir'} options.periode
 */
export function assemblerGrille({ sujets = [], seances = [], axe = 'formateur', periode = PERIODES.JOUR }) {
  const index = indexerSeances(seances, axe);
  const heures = heuresParSujet(seances, axe);
  const creneaux = periode === PERIODES.SOIR ? [SEANCE_SOIR] : SEANCES_JOUR;

  return sujets.map((sujet) => ({
    sujet,
    heures: arrondir(heures.get(sujet) ?? 0),
    niveau: niveauCharge(heures.get(sujet) ?? 0),
    cases: JOURS.flatMap((jour) =>
      creneaux.map((creneau) => ({
        jour,
        seance: creneau,
        contenu: index.get(cle(sujet, jour, creneau, periode)) ?? null,
      }))
    ),
  }));
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;

export { JOURS, PERIODES };

/**
 * Le week-end, on regarde la semaine QUI VIENT, pas celle qui s'achève.
 * ← `getSemaineActiveParRegle()` de emploiFormateur.html et emploiStagiaire.html
 *
 * ⚠️ SAMEDI À PARTIR DE 06H30, ET TOUT LE DIMANCHE. Le seuil n'est pas rond
 * parce qu'il suit la journée de cours : le samedi matin on enseigne encore,
 * l'après-midi la semaine est finie et ce qu'on vient consulter est la suivante.
 * Sans cette règle, un formateur qui ouvre son emploi du temps le dimanche soir
 * tombe sur une semaine terminée — et croit son planning vide.
 */
export function basculeVersSemaineSuivante(maintenant = new Date()) {
  const jour = maintenant.getDay(); // 0 = dimanche, 6 = samedi
  if (jour === 0) return true;
  if (jour !== 6) return false;
  return maintenant.getHours() > 6 || (maintenant.getHours() === 6 && maintenant.getMinutes() >= 30);
}

/**
 * Le prochain samedi 06h30 STRICTEMENT après `maintenant` — l'instant où la
 * semaine qui fait foi change toute seule. Les écrans consultatifs s'en servent
 * pour relire la semaine à ouvrir à cette heure-là, sans attendre qu'on
 * recharge la page.
 */
export function prochaineBascule(maintenant = new Date()) {
  const bascule = new Date(maintenant);
  bascule.setHours(6, 30, 0, 0);
  bascule.setDate(bascule.getDate() + ((6 - bascule.getDay() + 7) % 7));
  if (bascule <= maintenant) bascule.setDate(bascule.getDate() + 7);
  return bascule;
}

/**
 * La semaine à ouvrir pour une année scolaire donnée.
 * ← `getInitialDateForSelectedYear()` de emploi.html, et la priorité de
 *   `loadPageData()` des deux écrans consultatifs.
 *
 * ⚠️ LA SEMAINE DU JOUR N'APPARTIENT PAS FORCÉMENT À L'ANNÉE ACTIVE. Un
 * directeur qui prépare 2026-2027 au mois d'août est encore, au calendrier,
 * dans l'année 2025-2026 : ouvrir sur « la semaine d'aujourd'hui » lui
 * présenterait une semaine qui ne peut porter AUCUNE de ses séances — la grille
 * reviendrait vide, sans que rien ne l'explique.
 *
 * ═══ LA DATE D'ABORD, LA PUBLICATION NE PEUT QU'AVANCER ═══
 *  - la semaine « par la date » : aujourd'hui si la date tombe dans l'année (sa
 *    première semaine sinon), avancée d'une semaine dès le samedi 06h30 quand on
 *    demande la règle du week-end ;
 *  - la semaine PUBLIÉE ne l'emporte que si elle est PLUS TARDIVE.
 *
 * ⚠️⚠️ RÉVISE L'ORDRE DU 2026-09-06, où la publication passait avant tout
 * (demande du porteur, 2026-09-14 : « chaque samedi à 6:30, même si le directeur
 * n'a pas publié »). Une publication oubliée FIGEAIT formateurs, stagiaires et
 * gestionnaires sur une semaine révolue — la S2 publiée le 6 septembre s'ouvrait
 * encore le 14. Publier sert à montrer une semaine EN AVANCE (le jeudi, la
 * suivante) ; jamais à retenir tout le monde dans le passé.
 *
 * ⚠️ LES DEUX OPTIONS SONT EXPLICITES, JAMAIS DÉDUITES DU RÔLE : le domaine ne
 * sait pas qui regarde. C'est l'écran qui décide — le DIRECTEUR garde sa
 * navigation libre (il publie, il ne se fait pas déplacer par sa propre
 * publication), le gestionnaire, le formateur et le stagiaire ouvrent sur ce
 * qui fait foi.
 *
 * @param {object} [options]
 * @param {string|null} [options.semainePubliee] — « 2026-W12 », déjà normalisée
 * @param {boolean} [options.regleWeekEnd] — appliquer la bascule du samedi
 */
export function semaineAOuvrir(annee, maintenant = new Date(), options = {}) {
  const { semainePubliee = null, regleWeekEnd = false } = options;
  const parLaDate = semaineParLaDate(annee, maintenant, regleWeekEnd);

  /* ⚠️ ON NE VÉRIFIE PAS QU'ELLE EXISTE EN BASE : une semaine publiée sans
     séance reste la semaine qui fait foi, et l'écran doit l'ouvrir — vide, ce
     qui est une information — plutôt que d'en choisir une autre en silence.
     ⚠️ Une valeur illisible ne l'emporte pas : on ne sait pas la situer. */
  const publiee = analyserSemaine(semainePubliee);
  if (publiee && publiee.debut > analyserSemaine(parLaDate).debut) {
    return `${publiee.anneeScolaire}-W${publiee.numero}`;
  }
  return parLaDate;
}

function semaineParLaDate(annee, maintenant, regleWeekEnd) {
  const bornes = bornesAnneeScolaire(annee);
  const jour = enTexte(maintenant);
  const dansLAnnee = jour >= bornes.debut && jour <= bornes.fin;

  if (!dansLAnnee) return valeurSemaine(lundiPremiereSemaine(annee));

  if (regleWeekEnd && basculeVersSemaineSuivante(maintenant)) {
    const suivante = new Date(maintenant);
    suivante.setDate(suivante.getDate() + 7);
    /* ⚠️ ON NE SORT PAS DE L'ANNÉE : la dernière semaine d'août n'a pas de
       suivante, et basculer y ouvrirait l'année d'après. */
    return enTexte(suivante) <= bornes.fin ? valeurSemaine(suivante) : valeurSemaine(maintenant);
  }

  return valeurSemaine(maintenant);
}

/** `Date` → « AAAA-MM-JJ », dans le fuseau LOCAL. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
