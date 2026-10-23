import { separerFusion } from '../carte/reconstruction.js';
import { dureeSeance } from '../emploi/grille.js';
import { seanceTerminee } from '../emploi/consultation.js';
import { semaineDansAnnee } from '../planning/semaines.js';
import { lundiPremiereSemaine } from '../planning/anneeScolaire.js';

/**
 * ═══ L'ÉCART DE SAISIE e-note / eDTpro, FORMATEUR PAR FORMATEUR ═══
 * (2026-10-01, demande du porteur : « en accueil, un tableau qui montre
 * l'écart entre EDT pro et e-note pour chaque semaine » — le tableau Excel
 * tenu à la main : E-note, EDT, Écart, par semaine, et « Manque à saisir ».)
 *
 * ═══ ⚠️ E-NOTE NE DONNE QU'UN CUMUL ═══
 * L'export « AvancementProgramme » porte le réalisé DEPUIS LA RENTRÉE, pas
 * celui d'une semaine. Ce qu'un formateur a saisi entre deux dépôts est donc la
 * DIFFÉRENCE de son cumul entre deux imports successifs — d'où la règle « une
 * seule base e-note par semaine » (`enoteImport.service.js`), qui fait de
 * chaque dépôt un point hebdomadaire.
 *
 * ═══ ⚠️ DEUX COLONNES, EN CUMUL DEPUIS S1 (2026-10-23, demande du porteur) ═══
 * « affiche seulement la semaine en cours et la semaine en cours − 1, lorsque
 * j'insère une base e-note » :
 *   S−1 : avancement e-note − EDT réalisé de S1 à S−1 ;
 *   S   : avancement e-note − EDT réalisé de S1 à S.
 * La semaine en cours est celle du DERNIER dépôt ; l'avancement e-note, son
 * cumul depuis la rentrée — le même pour les deux colonnes. Un écart NÉGATIF
 * est un manque de saisie, un écart POSITIF une avance ; les deux s'affichent.
 *
 * ⚠️ LA COLONNE S RETIENT TOUTES LES SÉANCES RÉALISÉES DE LA SEMAINE, même
 * tenues après l'export : c'est la formule demandée. Celle de S−1 est la juste
 * mesure du retard quand l'export est fait en cours de semaine.
 *
 * ⚠️ LE CUMUL S'ARRÊTE À L'EXPORT, PAS À L'IMPORT (2026-10-22, signalé par le
 * porteur). Un fichier « AvancementProgramme…_25_09_2026_13_58_48 » importé le
 * 27/09 ne contient rien après le 25/09. Le jour d'export se lit dans le nom
 * du fichier ; à défaut, le jour de l'import.
 *
 * ⚠️ LE PRÉSENTIEL ET LE SYNCHRONE S'ADDITIONNENT : la grille ne distingue les
 * deux que par la salle, et le formateur saisit les deux dans e-note. Une séance
 * synchrone MUTUALISÉE ne compte qu'une fois — e-note la porte sur chaque
 * groupe de l'ensemble, la grille en une seule séance.
 */

/**
 * @param {object} params
 * @param {Array<{importeLe: Date|string, nomFichier?: string, lignes: Array}>} params.imports
 *   les imports de l'année, leurs lignes déjà lues par `lireAvancementEnote`
 * @param {Array} params.seances — `semaine jour seance date statut estEfm formateurMatricule groupe`
 * @param {Array} params.formateurs — `Base.formateurs`
 * @param {number} params.anneeScolaire
 * @param {Array} [params.rentrees]
 * @returns {{semaines: Array, periodes: Array, formateurs: Array}} une période
 *   par colonne — S−1 puis S —, `formateurs[].cellules` dans le même ordre
 */
export function ecartsDeSaisie({
  imports = [],
  seances = [],
  formateurs = [],
  anneeScolaire,
  rentrees = [],
  maintenant = null,
  horaires,
}) {
  const realisee = estRealisee(maintenant, horaires);
  const identite = indexerFormateurs(formateurs);
  const depot = retenirDepots(imports, anneeScolaire, rentrees).at(-1);
  if (!depot) return { semaines: [], periodes: [], formateurs: [] };

  const colonnes = colonnesDuDepot(depot, anneeScolaire, rentrees);

  const lignesParFormateur = new Map();
  const ligneDe = (cle, nom) => {
    if (!lignesParFormateur.has(cle)) {
      lignesParFormateur.set(cle, { cle, nom, cellules: colonnes.map(() => ({ enote: 0, edt: 0, ecart: 0 })) });
    }
    return lignesParFormateur.get(cle);
  };

  /* ── E-note : l'avancement du dernier dépôt, depuis la rentrée ─────────── */
  for (const [cle, { heures, nom }] of cumulEnote(depot.lignes ?? [], identite)) {
    for (const cellule of ligneDe(cle, nom).cellules) cellule.enote = arrondir(heures);
  }

  /* ── eDTpro : le réalisé de S1 à la fin de chaque colonne ──────────────── */
  const unParCreneau = creneauUnique();
  for (const seance of seances) {
    if (!realisee(seance)) continue;
    const jour = debutDuJour(seance.date);
    const { cle, nom } = identite(seance.formateurMatricule);
    if (!cle || !unParCreneau(cle, jour, seance.seance)) continue;

    const heures = dureeSeance(seance.seance);
    colonnes.forEach((colonne, index) => {
      if (jour >= colonne.fin) return;
      const cellule = ligneDe(cle, nom).cellules[index];
      cellule.edt = arrondir(cellule.edt + heures);
    });
  }

  const lignes = [...lignesParFormateur.values()]
    .map((ligne) => {
      for (const cellule of ligne.cellules) cellule.ecart = arrondir(cellule.enote - cellule.edt);
      return ligne;
    })
    // Un formateur sans aucune heure, ni d'un côté ni de l'autre, n'a rien à dire.
    .filter((ligne) => ligne.cellules.some((cellule) => cellule.enote !== 0 || cellule.edt !== 0))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const premierLundi = jourLocal(lundiDe(1, anneeScolaire, rentrees));
  const periodes = colonnes.map((colonne) => ({
    semaine: colonne.numero,
    depuisSemaine: 1,
    debut: premierLundi,
    fin: jourLocal(colonne.samedi),
    fichier: depot.nomFichier ?? '',
    importeLe: jourLocal(depot.importe),
    exporteLe: jourLocal(depot.jour),
  }));
  const semaines = colonnes.map((colonne, index) => ({
    numero: colonne.numero,
    debut: jourLocal(colonne.lundi),
    fin: jourLocal(colonne.samedi),
    periode: index,
  }));

  return { semaines, periodes, formateurs: lignes };
}

/**
 * ═══ LE DÉTAIL D'UNE CARTE ═══ (2026-10-01, demande du porteur : « lorsque je
 * clique sur la card, afficher le détail des séances non saisies »).
 *
 * ⚠️ E-NOTE NE DIT PAS QUELLE SÉANCE A ÉTÉ SAISIE — seulement des heures par
 * (groupe, module). Le détail descend donc à ce grain : pour chaque groupe et
 * module du formateur, son avancement e-note, le réalisé de la grille de S1 à
 * la semaine de la colonne, et les séances qui le composent.
 *
 * @returns {{semaine, debut, fin, lignes: Array}|null} `null` hors des deux colonnes
 */
export function detailEcartDeSaisie({
  imports = [],
  seances = [],
  formateurs = [],
  anneeScolaire,
  rentrees = [],
  maintenant = null,
  horaires,
  cle,
  semaine,
}) {
  const realisee = estRealisee(maintenant, horaires);
  const identite = indexerFormateurs(formateurs);
  const depot = retenirDepots(imports, anneeScolaire, rentrees).at(-1);
  if (!depot) return null;
  const colonne = colonnesDuDepot(depot, anneeScolaire, rentrees).find((c) => c.numero === semaine);
  if (!colonne) return null;

  const lignes = new Map();
  const ligneDe = (groupe, module) => {
    const code = cleCouple(groupe, module);
    if (!lignes.has(code)) {
      lignes.set(code, { groupe, module, enote: 0, edt: 0, ecart: 0, seances: [] });
    }
    return lignes.get(code);
  };

  /* ── E-note : l'avancement du dernier dépôt, couple par couple ─────────── */
  for (const { groupe, module, heures } of cumulParCouple(depot.lignes ?? [], identite, cle).values()) {
    ligneDe(groupe, module).enote = arrondir(heures);
  }

  /* ── eDTpro : les séances réalisées du formateur, de S1 à la colonne ───── */
  const unParCreneau = creneauUnique();
  for (const seance of seances) {
    if (!realisee(seance)) continue;
    const jour = debutDuJour(seance.date);
    if (jour >= colonne.fin) continue;
    if (identite(seance.formateurMatricule).cle !== cle) continue;
    if (!unParCreneau(cle, jour, seance.seance)) continue;

    const ligne = ligneDe(String(seance.groupe ?? '').trim(), String(seance.module ?? '').trim());
    const heures = dureeSeance(seance.seance);
    ligne.edt = arrondir(ligne.edt + heures);
    ligne.seances.push({
      date: jourLocal(jour),
      jour: seance.jour ?? '',
      creneau: seance.seance,
      salle: seance.salle ?? '',
      heures,
    });
  }

  return {
    semaine,
    debut: jourLocal(lundiDe(1, anneeScolaire, rentrees)),
    fin: jourLocal(colonne.samedi),
    lignes: [...lignes.values()]
      .map((ligne) => ({
        ...ligne,
        ecart: arrondir(ligne.enote - ligne.edt),
        seances: ligne.seances.sort((a, b) => a.date.localeCompare(b.date) || a.creneau.localeCompare(b.creneau)),
      }))
      .filter((ligne) => ligne.enote !== 0 || ligne.edt !== 0)
      .sort((a, b) => a.ecart - b.ecart || a.groupe.localeCompare(b.groupe, 'fr')),
  };
}

/**
 * Les deux colonnes du dernier dépôt : S−1 (si elle existe) puis S, la
 * semaine de l'import. `fin` est le lundi qui suit la semaine, exclu.
 */
function colonnesDuDepot(depot, anneeScolaire, rentrees) {
  return [depot.semaine - 1, depot.semaine]
    .filter((numero) => numero >= 1)
    .map((numero) => {
      const lundi = lundiDe(numero, anneeScolaire, rentrees);
      const samedi = new Date(lundi);
      samedi.setDate(samedi.getDate() + 5);
      return { numero, lundi, samedi, fin: lundiDe(numero + 1, anneeScolaire, rentrees) };
    });
}

function lundiDe(numero, anneeScolaire, rentrees) {
  const date = lundiPremiereSemaine(anneeScolaire, rentrees);
  date.setDate(date.getDate() + (numero - 1) * 7);
  return debutDuJour(date);
}

/**
 * ═══ ⚠️ L'EDT COMPTE LES SÉANCES RÉALISÉES, PAS LES SÉANCES PLANIFIÉES ═══
 * (2026-10-01, demande du porteur : « le calcul sur la base des séances
 * réalisées et non pas planifiées ».) La règle est celle du réalisé eDTpro de
 * l'avancement : séance TERMINÉE à l'horaire officiel (`seanceTerminee`), non
 * marquée absente — le cours n'a pas eu lieu — et hors surveillance d'EFM, qui
 * n'est pas un cours. Une séance de rattrapage compte : elle a eu lieu.
 *
 * @param {{date: string, heure: string}|null} maintenant — `null` : seule la
 *   date du dépôt borne la fenêtre (tests).
 */
function estRealisee(maintenant, horaires) {
  return (seance) =>
    seance.statut !== 'absent' &&
    !seance.estEfm &&
    Boolean(seance.date) &&
    (!maintenant || seanceTerminee(seance, maintenant, horaires));
}

/**
 * Les dépôts retenus, un par semaine scolaire.
 *
 * ═══ ⚠️ UNE COLONNE PAR SEMAINE (2026-10-01, demande du porteur : « pour
 * chaque semaine ») ═══
 * Un dépôt appartient à la semaine scolaire de son import — la règle « une
 * seule base par semaine » et la frise de l'avancement l'entendent ainsi.
 * Deux dépôts d'une même semaine (données antérieures à la règle) n'en font
 * qu'un : le dernier fait foi, comme pour la frise.
 */
function retenirDepots(imports, anneeScolaire, rentrees) {
  const parSemaine = new Map();
  imports
    .filter((depot) => depot?.importeLe)
    .map((depot) => ({ ...depot, importe: debutDuJour(depot.importeLe) }))
    .sort((a, b) => a.importe - b.importe)
    .forEach((depot) => {
      const semaine = semaineDansAnnee(anneeScolaire, depot.importe, rentrees).numero;
      parSemaine.set(semaine, { ...depot, semaine });
    });

  /* `jour` borne la fenêtre : le jour d'EXPORT du fichier. ⚠️ JAMAIS EN
     ARRIÈRE du dépôt précédent — un vieux fichier réimporté rendrait une
     fenêtre à l'envers. */
  let borne = null;
  return [...parSemaine.values()]
    .sort((a, b) => a.semaine - b.semaine)
    .map((depot) => {
      const exporte = jourDExport(depot.nomFichier);
      let jour = exporte && exporte <= depot.importe ? exporte : depot.importe;
      if (borne && jour < borne) jour = borne;
      borne = jour;
      return { ...depot, jour };
    });
}

/**
 * Le jour d'export inscrit par e-note dans le nom du fichier :
 * « AvancementProgramme2026_EOS0_25_09_2026_13_58_48.xlsx » → 25/09/2026.
 * `null` si le fichier a été renommé.
 */
function jourDExport(nomFichier) {
  const m = String(nomFichier ?? '').match(/_(\d{2})_(\d{2})_(\d{4})_\d{2}_\d{2}_\d{2}(?:\D|$)/);
  if (!m) return null;
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ⚠️ UNE SÉANCE PAR FORMATEUR ET PAR CRÉNEAU : un formateur n'est pas à deux
 * endroits à la fois. Une séance enregistrée en double — par groupe d'un
 * ensemble, ou restée d'une version précédente de la grille — gonflait l'EDT.
 */
function creneauUnique() {
  const vus = new Set();
  return (cle, jour, creneau) => {
    const code = `${cle}|${jourLocal(jour)}|${creneau}`;
    if (vus.has(code)) return false;
    vus.add(code);
    return true;
  };
}

/**
 * Le réalisé e-note cumulé d'UN formateur, par (groupe, module).
 *
 * ⚠️ LE SYNCHRONE SE RANGE SOUS L'ENSEMBLE FUSIONNÉ, une seule fois — c'est
 * aussi le libellé que porte sa séance dans la grille.
 */
function cumulParCouple(lignes, identite, cle) {
  const cumul = new Map();
  const ajouter = (groupe, module, heures) => {
    if (!(heures > 0)) return;
    const code = cleCouple(groupe, module);
    const entree = cumul.get(code) ?? { groupe, module, heures: 0 };
    entree.heures += heures;
    cumul.set(code, entree);
  };
  const vus = new Set();

  for (const ligne of lignes) {
    if (identite(ligne.matriculePresentiel || ligne.formateurPresentiel, ligne.formateurPresentiel).cle === cle) {
      ajouter(ligne.groupe, ligne.module, ligne.realisePresentiel);
    }
    if (identite(ligne.matriculeSynchrone || ligne.formateurSynchrone, ligne.formateurSynchrone).cle === cle) {
      const ensemble = ligne.fusionGroupe || ligne.groupe;
      const code = cleCouple(ensemble, ligne.module);
      if (vus.has(code)) continue;
      vus.add(code);
      ajouter(ensemble, ligne.module, ligne.realiseSynchrone);
    }
  }

  return cumul;
}

/** « GM102 GM101 » et « GM101 GM102 » désignent le même ensemble. */
const cleCouple = (groupe, module) =>
  `${separerFusion(String(groupe ?? '').toUpperCase()).sort().join(' ')}||${String(module ?? '').trim().toUpperCase()}`;

/**
 * Le réalisé e-note cumulé de chaque formateur.
 *
 * ⚠️ LE SYNCHRONE D'UN ENSEMBLE NE COMPTE QU'UNE FOIS par formateur et par
 * module : l'export le répète sur chaque groupe fusionné — même empreinte que
 * `agregerAvancement`.
 */
function cumulEnote(lignes, identite) {
  const cumul = new Map();
  const vus = new Set();
  const ajouter = (identifiant, nomAffiche, heures) => {
    if (!(heures > 0)) return;
    const { cle, nom } = identite(identifiant, nomAffiche);
    if (!cle) return;
    const entree = cumul.get(cle) ?? { heures: 0, nom };
    entree.heures += heures;
    cumul.set(cle, entree);
  };

  for (const ligne of lignes) {
    ajouter(ligne.matriculePresentiel || ligne.formateurPresentiel, ligne.formateurPresentiel, ligne.realisePresentiel);

    const synchrone = ligne.matriculeSynchrone || ligne.formateurSynchrone;
    const empreinte = `${synchrone}||${ligne.fusionGroupe || ligne.groupe}||${ligne.module}`;
    if (vus.has(empreinte)) continue;
    vus.add(empreinte);
    ajouter(synchrone, ligne.formateurSynchrone, ligne.realiseSynchrone);
  }

  return cumul;
}

/**
 * Un identifiant — matricule, nom unique ou nom complet — vers la clé STABLE
 * du formateur et son nom affiché.
 *
 * ⚠️ LE MATRICULE D'ABORD : e-note et la grille l'emploient tous deux. Le nom
 * n'est qu'un repli, pour un formateur importé sans matricule.
 */
function indexerFormateurs(formateurs) {
  const index = new Map();
  for (const formateur of formateurs ?? []) {
    const nom = String(formateur.nomComplet ?? '').trim();
    if (nom === '') continue;
    const matricule = String(formateur.matricule ?? '').trim().toUpperCase();
    const entree = { cle: matricule || nom.toUpperCase(), nom };
    for (const valeur of [matricule, formateur.nomUnique, nom]) {
      const cle = String(valeur ?? '').trim().toUpperCase();
      if (cle !== '' && !index.has(cle)) index.set(cle, entree);
    }
  }

  return (identifiant, nomAffiche = '') => {
    const brut = String(identifiant ?? '').trim().toUpperCase();
    if (brut === '') return { cle: null, nom: '' };
    const connu = index.get(brut) ?? index.get(String(nomAffiche ?? '').trim().toUpperCase());
    return connu ?? { cle: brut, nom: String(nomAffiche || identifiant).trim() };
  };
}

function debutDuJour(valeur) {
  const date = new Date(valeur);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
function jourLocal(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
