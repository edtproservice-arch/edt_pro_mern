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
 * ═══ ⚠️ LA PÉRIODE VA D'UN DÉPÔT AU SUIVANT, PAS DU LUNDI AU SAMEDI ═══
 * Comparer les heures saisies entre deux dépôts aux séances d'une semaine
 * CIVILE fausserait l'écart dès que le dépôt n'est pas fait le lundi : un
 * fichier exporté le mercredi contient déjà lundi et mardi. Les séances eDTpro
 * comptées sont celles qui ont eu lieu DANS LA MÊME FENÊTRE : du jour du dépôt
 * précédent (inclus) au jour du dépôt (exclu) — les séances du jour même n'ont
 * en général pas encore été saisies au moment de l'export.
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
 * @returns {{periodes: Array, formateurs: Array}}
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
  const retenus = retenirDepots(imports, anneeScolaire, rentrees);

  const lignesParFormateur = new Map();
  const ligneDe = (cle, nom) => {
    if (!lignesParFormateur.has(cle)) {
      lignesParFormateur.set(cle, { cle, nom, cellules: retenus.map(() => ({ enote: 0, edt: 0, ecart: 0 })) });
    }
    return lignesParFormateur.get(cle);
  };

  /* ── E-note : le cumul de chaque dépôt, puis la différence ─────────────── */
  let precedent = new Map();
  retenus.forEach((depot, index) => {
    const cumul = cumulEnote(depot.lignes ?? [], identite);
    for (const cle of new Set([...cumul.keys(), ...precedent.keys()])) {
      const actuel = cumul.get(cle) ?? { heures: 0, nom: precedent.get(cle)?.nom };
      const avant = precedent.get(cle)?.heures ?? 0;
      ligneDe(cle, actuel.nom).cellules[index].enote = arrondir(actuel.heures - avant);
    }
    precedent = cumul;
  });

  /* ── eDTpro : les séances tenues dans la fenêtre de chaque dépôt ───────── */
  for (const seance of seances) {
    if (!realisee(seance)) continue;

    const jour = debutDuJour(seance.date);
    // Première fenêtre dont le dépôt est postérieur au jour de la séance.
    const index = retenus.findIndex((depot) => jour < depot.jour);
    if (index === -1) continue;

    const { cle, nom } = identite(seance.formateurMatricule);
    if (!cle) continue;
    const cellule = ligneDe(cle, nom).cellules[index];
    cellule.edt = arrondir(cellule.edt + dureeSeance(seance.seance));
  }

  const periodes = retenus.map((depot, index) => {
    const debut = index === 0 ? null : retenus[index - 1].jour;
    const fin = new Date(depot.jour);
    fin.setDate(fin.getDate() - 1);
    return {
      semaine: depot.semaine,
      /* Les semaines SANS dépôt qui précèdent celle-ci : leur saisie est comptée
         ici, faute de point intermédiaire dans e-note. */
      depuisSemaine: index === 0 ? 1 : retenus[index - 1].semaine + 1,
      debut: debut ? jourLocal(debut) : null,
      fin: jourLocal(fin),
      fichier: depot.nomFichier ?? '',
      importeLe: jourLocal(depot.jour),
    };
  });

  /* Toutes les semaines de S1 au dernier dépôt, avec leurs dates — une colonne
     chacune, qu'un dépôt y ait eu lieu ou non. */
  const derniere = retenus.at(-1)?.semaine ?? 0;
  const semaines = Array.from({ length: derniere }, (_, i) => {
    const numero = i + 1;
    const lundi = lundiPremiereSemaine(anneeScolaire, rentrees);
    lundi.setDate(lundi.getDate() + i * 7);
    const samedi = new Date(lundi);
    samedi.setDate(samedi.getDate() + 5);
    const periode = retenus.findIndex((depot) => depot.semaine === numero);
    return {
      numero,
      debut: jourLocal(lundi),
      fin: jourLocal(samedi),
      periode: periode === -1 ? null : periode,
    };
  });

  const lignes = [...lignesParFormateur.values()]
    .map((ligne) => {
      for (const cellule of ligne.cellules) cellule.ecart = arrondir(cellule.enote - cellule.edt);
      return ligne;
    })
    // Un formateur sans aucune heure, ni d'un côté ni de l'autre, n'a rien à dire.
    .filter((ligne) => ligne.cellules.some((cellule) => cellule.enote !== 0 || cellule.edt !== 0))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  return { semaines, periodes, formateurs: lignes };
}

/**
 * ═══ LE DÉTAIL D'UNE CARTE ═══ (2026-10-01, demande du porteur : « lorsque je
 * clique sur la card, afficher le détail des séances non saisies »).
 *
 * ⚠️ E-NOTE NE DIT PAS QUELLE SÉANCE A ÉTÉ SAISIE — seulement des heures par
 * (groupe, module). Le détail descend donc à ce grain : pour chaque groupe et
 * module du formateur, ce qu'il a saisi sur la période, ce que la grille
 * portait, et les séances de la grille qui le composent. Les séances d'un
 * couple en écart négatif sont celles qui restent, au moins en partie, à saisir.
 *
 * @returns {{semaine, debut, fin, lignes: Array}|null} `null` sans dépôt cette semaine
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
  const retenus = retenirDepots(imports, anneeScolaire, rentrees);
  const index = retenus.findIndex((depot) => depot.semaine === semaine);
  if (index === -1) return null;

  const debut = index === 0 ? null : retenus[index - 1].jour;
  const fin = retenus[index].jour;

  const lignes = new Map();
  const ligneDe = (groupe, module) => {
    const code = cleCouple(groupe, module);
    if (!lignes.has(code)) {
      lignes.set(code, { groupe, module, enote: 0, edt: 0, ecart: 0, seances: [] });
    }
    return lignes.get(code);
  };

  /* ── E-note : la différence de cumul, couple par couple ────────────────── */
  const actuel = cumulParCouple(retenus[index].lignes ?? [], identite, cle);
  const avant = index === 0 ? new Map() : cumulParCouple(retenus[index - 1].lignes ?? [], identite, cle);
  for (const code of new Set([...actuel.keys(), ...avant.keys()])) {
    const reference = actuel.get(code) ?? avant.get(code);
    ligneDe(reference.groupe, reference.module).enote = arrondir(
      (actuel.get(code)?.heures ?? 0) - (avant.get(code)?.heures ?? 0)
    );
  }

  /* ── eDTpro : les séances du formateur dans la fenêtre ─────────────────── */
  for (const seance of seances) {
    if (!realisee(seance)) continue;
    const jour = debutDuJour(seance.date);
    if (jour >= fin || (debut && jour < debut)) continue;
    if (identite(seance.formateurMatricule).cle !== cle) continue;

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

  const finAffichee = new Date(fin);
  finAffichee.setDate(finAffichee.getDate() - 1);

  return {
    semaine,
    debut: debut ? jourLocal(debut) : null,
    fin: jourLocal(finAffichee),
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
    .map((depot) => ({ ...depot, jour: debutDuJour(depot.importeLe) }))
    .sort((a, b) => a.jour - b.jour)
    .forEach((depot) => {
      const semaine = semaineDansAnnee(anneeScolaire, depot.jour, rentrees).numero;
      parSemaine.set(semaine, { ...depot, semaine });
    });
  return [...parSemaine.values()].sort((a, b) => a.semaine - b.semaine);
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
