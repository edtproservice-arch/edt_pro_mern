import { TYPES_COURS } from '../../constants/index.js';
import { separerFusion } from '../carte/reconstruction.js';

/**
 * Conflits d'une séance : formateur, groupe, salle.
 * ← `checkGroupConflict()` et `checkRoomConflict()` de emploi.html
 *
 * ═══ POURQUOI CE CONTRÔLE PASSE CÔTÉ SERVEUR ═══
 * L'existant parcourait le modèle chargé dans la page : il ne voyait donc que
 * ce qui était affiché, et deux onglets ouverts sur la même semaine pouvaient
 * poser deux séances dans la même salle sans que ni l'un ni l'autre ne le sache.
 * Les index de `Seance` permettent au serveur de répondre par requête — c'est le
 * point 3 du constat §4.4 du plan.
 *
 * Les règles vivent ici pour être testées, et pour que l'écran puisse les
 * rejouer sans aller-retour quand il a déjà la semaine en mémoire.
 */

/**
 * ⚠️ TEAMS ET ABSENT NE SONT PAS DES SALLES.
 *
 * « TEAMS » désigne une séance à distance — il n'y a pas de local à occuper, et
 * dix groupes peuvent l'employer en même temps. « ABSENT » était la convention
 * de l'existant pour marquer un formateur absent : le modèle porte désormais
 * `statut`, mais la valeur peut encore arriver d'un import ou d'une saisie.
 *
 * Les traiter comme des salles ordinaires ferait refuser toutes les séances à
 * distance de la semaine à partir de la deuxième.
 */
export const SALLE_DISTANCIEL = 'TEAMS';
export const SALLES_SANS_CONFLIT = [SALLE_DISTANCIEL, 'ABSENT'];

/**
 * De quel TYPE est une séance : à distance, ou en salle.
 *
 * ⚠️ C'EST LA SALLE QUI LE DIT, et c'est la seule marque dont on dispose —
 * `Seance` ne porte pas de champ `type`. « TEAMS » n'est pas un local : la
 * séance est mutualisée, elle pèse sur la masse SYNCHRONE du module. Toute autre
 * salle, ou aucune, désigne un cours en salle.
 *
 * ⚠️ DÉFINIE UNE SEULE FOIS. La grille s'en sert pour choisir ses listes de
 * groupes, les indicateurs pour choisir la masse de référence, et le serveur
 * pour contrôler le quota : trois copies auraient dérivé, et la même séance
 * aurait pu compter dans un quota et s'afficher dans l'autre.
 */
export function typeDeSeance(seance) {
  return String(seance?.salle ?? '').trim().toUpperCase() === SALLE_DISTANCIEL
    ? TYPES_COURS.SYNCHRONE
    : TYPES_COURS.PRESENTIEL;
}

export const estSalleReelle = (salle) => {
  const valeur = String(salle ?? '').trim();
  return valeur !== '' && !SALLES_SANS_CONFLIT.includes(valeur.toUpperCase());
};

/**
 * Les groupes RÉELS d'une valeur de cellule, en majuscules.
 *
 * ⚠️ Une cellule peut porter une FUSION (« GM101 GM102 ») : `separerFusion`
 * connaît déjà la règle — découper sur les espaces casserait « ACADA101 (FQ) »
 * en deux groupes fantômes. Un groupe FQ est remplacé en plus par ses
 * constituants (voir `elargirAuxFq`).
 *
 * ⚠️ LES NOMS SONT RENDUS ENTIERS, suffixe compris. Comparer deux groupes passe
 * par `memeGroupe` — jamais par l'égalité de chaînes, ni par la présence dans
 * l'ensemble : c'est elle qui sait que « GE102 » et « GE102 (GC) » sont une
 * même classe, et que « GE101 (GC) » et « GE101 (GE) » n'en sont pas une.
 */
export function groupesCompares(valeur, groupesFq = []) {
  const compares = new Set(
    separerFusion(valeur)
      .map((groupe) => normaliserNom(groupe))
      .filter(Boolean)
  );

  return elargirAuxFq(compares, groupesFq);
}

const normaliserNom = (nom) => String(nom ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

const sansSuffixe = (nom) => String(nom ?? '').replace(/\s*\([^)]*\)/g, '').trim();

/*
 * Décomposition mémorisée : la grille compare des milliers de paires par rendu,
 * sur quelques dizaines de noms distincts — les reparser à chaque fois serait
 * payer le même travail mille fois.
 */
const decompositions = new Map();

function decomposer(nom) {
  const cle = normaliserNom(nom);
  let resultat = decompositions.get(cle);
  if (!resultat) {
    resultat = {
      base: sansSuffixe(cle),
      suffixes: new Set([...cle.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim())),
    };
    decompositions.set(cle, resultat);
  }
  return resultat;
}

const inclus = (petit, grand) => [...petit].every((suffixe) => grand.has(suffixe));

/**
 * Deux noms désignent-ils la MÊME classe — donc les mêmes stagiaires ?
 *
 * ⚠️ « GE102 (GC) » ET « GE102 » SONT LA MÊME CLASSE. Le suffixe est ajouté
 * APRÈS coup, quand une autre filière arrive sur le même préfixe : une séance
 * saisie avant porte encore le nom nu. Sans ce rapprochement, on pourrait placer
 * deux cours au même moment pour les mêmes stagiaires — c'est ce que faisait
 * `stripGroupSuffix()` de l'existant.
 *
 * ═══ ⚠️⚠️ MAIS « GE101 (GC) » ET « GE101 (GE) » SONT DEUX CLASSES ═══
 * (corrigé le 2026-09-11, signalé par le porteur.) C'est précisément ce que le
 * suffixe de secteur existe pour distinguer : Gestion des Entreprises et Génie
 * électrique, deux filières, deux promotions. La règle précédente retirait TOUT
 * suffixe des deux côtés : les deux devenaient « GE101 », et poser un cours à
 * l'une marquait l'autre « PRIS » sur le même créneau.
 *
 * La règle : même base, et les suffixes de l'un CONTENUS dans ceux de l'autre.
 *   GE102 ≡ GE102 (GC)           — {} ⊂ {GC}
 *   GE101 (CDS) ≡ GE101 (CDS) (GE) — {CDS} ⊂ {CDS, GE}
 *   GE101 (GC) ≢ GE101 (GE)      — ni l'un ni l'autre
 */
export function memeGroupe(a, b) {
  const x = decomposer(a);
  const y = decomposer(b);
  if (!x.base || x.base !== y.base) return false;
  return inclus(x.suffixes, y.suffixes) || inclus(y.suffixes, x.suffixes);
}

/**
 * Deux valeurs de cellule partagent-elles au moins une classe ?
 * Fusions découpées, groupes FQ remplacés par leurs constituants.
 */
export function groupesSeCroisent(valeurA, valeurB, groupesFq = []) {
  const a = groupesCompares(valeurA, groupesFq);
  const b = groupesCompares(valeurB, groupesFq);
  return croisement(a, b);
}

const croisement = (a, b) => [...a].some((x) => [...b].some((y) => memeGroupe(x, y)));

/**
 * Les deux écritures sous lesquelles un groupe FQ peut être désigné par une
 * séance : « APILC101 (FQ) », et le nom nu « APILC101 ».
 *
 * ⚠️ POUR LE PARENT SEULEMENT. Les constituants, eux, entrent ENTIERS dans
 * l'ensemble : y ajouter leur nom nu ferait croiser « GE101 (GC) » avec
 * « GE101 (GE) » par ce détour — le défaut que `memeGroupe` vient de fermer.
 */
const clesDe = (nom) => {
  const brut = normaliserNom(nom);
  return [brut, sansSuffixe(brut)].filter(Boolean);
};

/*
 * ⚠️ L'INDEX EST MÉMORISÉ SUR LE TABLEAU REÇU. La grille interroge cette
 * fonction pour CHAQUE case — plus d'un millier de fois par rendu en vue par
 * groupe — et le reconstruire à chaque appel, c'est exactement le coût qui avait
 * figé la carte d'affectations et le chronogramme. Une `WeakMap` : la liste
 * vient du cache de requêtes, elle garde sa référence tant qu'elle ne change
 * pas, et l'entrée disparaît d'elle-même quand elle change.
 */
const indexParListe = new WeakMap();

/** Les constituants déclarés de chaque groupe FQ, sous ses deux écritures. */
function indexerFq(groupesFq) {
  const memorise = indexParListe.get(groupesFq);
  if (memorise) return memorise;

  const constituants = new Map();

  for (const lien of groupesFq ?? []) {
    for (const parent of clesDe(lien?.groupeFq)) {
      if (!constituants.has(parent)) constituants.set(parent, new Set());
      const enfant = normaliserNom(lien?.groupeConstituant);
      if (enfant) constituants.get(parent).add(enfant);
    }
  }

  indexParListe.set(groupesFq, constituants);
  return constituants;
}

/**
 * Remplace chaque groupe FQ par les groupes réels qui le composent.
 *
 * ═══ ⚠️⚠️ VERS LE BAS SEULEMENT — C'EST TOUTE LA CORRECTION ═══
 * Un groupe FQ n'a pas de stagiaires à lui : ce sont CEUX de ses constituants.
 * Comparer deux séances revient donc à comparer leurs groupes RÉELS, et il
 * suffit de descendre du FQ vers ses composants. Remonter en plus du composant
 * vers son FQ paraît symétrique et ne l'est pas :
 *
 *   EEM101 → {EEM101, APILC101 (FQ)}   EEM102 → {EEM102, APILC101 (FQ)}
 *
 * les deux ensembles se croisent sur le PARENT, et deux classes distinctes
 * deviennent incompatibles — EEM101 ne pourrait plus jamais avoir cours en même
 * temps qu'EEM102. En ne descendant que vers les composants :
 *
 *   EEM101 → {EEM101}   EEM102 → {EEM102}   APILC101 (FQ) → {…, EEM101, EEM102}
 *
 * le FQ heurte bien chacun de ses composants, et les composants sont libres
 * entre eux. La comparaison reste symétrique — c'est une intersection.
 *
 * ⚠️ DIVERGENCE ASSUMÉE AVEC L'EXISTANT : `findConflict()` (emploi.html:17935)
 * élargit les DEUX sens, sur les deux séances comparées. Il refuse donc
 * réellement EEM101 et EEM102 sur le même créneau. Le seul établissement
 * concerné a deux lignes de composition, ce qui rend le défaut discret — mais
 * il interdit d'aligner deux groupes ordinaires toute l'année.
 *
 * ⚠️ UN GROUPE PEUT COMPOSER PLUSIEURS FQ (décision du porteur, 2026-08-26) :
 * chacun de ces FQ le heurte, sans que les FQ se heurtent pour autant entre eux
 * — sauf s'ils partagent un composant, et c'est alors le bon résultat.
 */
function elargirAuxFq(compares, groupesFq) {
  if (!groupesFq?.length) return compares;

  const constituants = indexerFq(groupesFq);
  const elargi = new Set(compares);

  for (const groupe of compares) {
    for (const enfant of constituants.get(groupe) ?? []) elargi.add(enfant);
  }

  return elargi;
}

/**
 * Ce qui empêche de poser `candidate` sur son créneau.
 *
 * `existantes` ne doit contenir que les séances du MÊME créneau — même semaine,
 * même jour, même séance, même période. C'est ce que la requête indexée du
 * serveur rend, et lui passer la semaine entière ferait refuser tout ce qui se
 * répète d'un jour à l'autre.
 *
 * @param {object} candidate  la séance qu'on veut poser
 * @param {Array} existantes  les séances déjà posées sur ce créneau
 * @param {object} [options]
 * @param {Array<{groupeFq, groupeConstituant}>} [options.groupesFq]
 *        la composition des groupes FQ de l'établissement — sans elle, un cours
 *        posé sur un groupe FQ et un cours posé sur l'un de ses constituants ne
 *        se voient pas, alors que ce sont les mêmes stagiaires
 * @returns {Array<{type, message, seance}>} vide si la pose est possible
 */
export function detecterConflits(candidate, existantes = [], { groupesFq = [] } = {}) {
  const conflits = [];
  const memeSeance = (autre) => autre.id && candidate.id && String(autre.id) === String(candidate.id);

  const groupesCandidats = groupesCompares(candidate.groupe, groupesFq);
  const salleCandidate = String(candidate.salle ?? '').trim();

  for (const autre of existantes) {
    // Modifier une séance ne peut pas entrer en conflit avec elle-même.
    if (memeSeance(autre)) continue;

    /*
     * ═══ FORMATEUR ═══
     * Il ne peut pas être à deux endroits. C'est aussi ce que garantit l'index
     * unique du modèle — mais le dire ICI permet d'expliquer le refus plutôt
     * que de laisser remonter une erreur d'écriture Mongo.
     */
    if (
      candidate.formateurMatricule &&
      autre.formateurMatricule === candidate.formateurMatricule
    ) {
      conflits.push({
        type: 'formateur',
        message: `Ce formateur a déjà ${autre.module} avec ${autre.groupe} sur ce créneau`,
        seance: autre,
      });
    }

    /*
     * ═══ GROUPE ═══ Les mêmes stagiaires ne peuvent pas suivre deux cours.
     *
     * ⚠️ LES DEUX CÔTÉS SONT ÉLARGIS AUX FQ. N'élargir que le candidat
     * suffirait dans la plupart des cas, mais pas tous : la comparaison serait
     * asymétrique, et un même couple de séances passerait ou non selon laquelle
     * on pose en premier.
     */
    if (croisement(groupesCompares(autre.groupe, groupesFq), groupesCandidats)) {
      conflits.push({
        type: 'groupe',
        message: `${autre.groupe} a déjà ${autre.module} sur ce créneau`,
        seance: autre,
      });
    }

    /*
     * ═══ SALLE ═══
     * ⚠️ La présence d'un groupe n'est PAS requise pour que la salle soit
     * occupée — c'est la correction que l'existant porte en toutes lettres.
     */
    if (
      estSalleReelle(salleCandidate) &&
      String(autre.salle ?? '').trim().toUpperCase() === salleCandidate.toUpperCase()
    ) {
      conflits.push({
        type: 'salle',
        message: `La salle ${salleCandidate} est occupée par ${autre.groupe}`,
        seance: autre,
      });
    }
  }

  return conflits;
}

/**
 * Ce qu'un formateur peut enseigner, d'après la base de l'année.
 *
 * ⚠️ LES OPTIONS VIENNENT DES AFFECTATIONS, jamais de la liste complète. Offrir
 * tous les groupes reviendrait à laisser poser un cours que personne n'a été
 * affecté à donner — et l'avancement compterait alors des heures que le
 * chronogramme n'a jamais prévues.
 *
 * ═══ ⚠️ LE FILTRE `type` CHANGE CE QU'EST UN « GROUPE » ═══
 * Un cours EN SALLE réunit une classe : ses options sont les groupes un par un.
 * Une séance À DISTANCE est mutualisée : son option est le libellé FUSIONNÉ tel
 * que la carte l'a affecté (« GM101 GM102 »), parce que c'est cette séance-là
 * qu'on pose, une seule fois pour les deux groupes.
 *
 * Sans filtre — c'est le cas du SERVEUR, qui doit accepter les deux — on rend
 * l'union : chaque membre, plus le libellé fusionné.
 *
 * @param {object} [options]
 * @param {string} [options.type] `TYPES_COURS.PRESENTIEL` ou `.SYNCHRONE`
 * @returns {{groupes: string[], modulesParGroupe: Map<string, string[]>}}
 */
export function optionsDuFormateur(affectations = [], matricule, { type } = {}) {
  const cle = String(matricule ?? '').trim().toUpperCase();
  const modulesParGroupe = new Map();

  for (const affectation of affectations) {
    if (String(affectation.formateur ?? '').trim().toUpperCase() !== cle) continue;
    if (type && affectation.type !== type) continue;

    const module = String(affectation.module ?? '').trim();
    if (module === '') continue;

    const libelle = String(affectation.groupe ?? '').trim();
    if (libelle === '') continue;

    const membres = separerFusion(libelle);
    const cibles = ciblesDuType(type, libelle, membres);

    for (const groupe of cibles) {
      if (!modulesParGroupe.has(groupe)) modulesParGroupe.set(groupe, new Set());
      modulesParGroupe.get(groupe).add(module);
    }
  }

  return {
    groupes: [...modulesParGroupe.keys()].sort((a, b) =>
      a.localeCompare(b, 'fr', { numeric: true })
    ),
    modulesParGroupe: new Map(
      [...modulesParGroupe].map(([groupe, modules]) => [groupe, [...modules].sort()])
    ),
  };
}

/**
 * Les groupes qu'une affectation propose, selon le type de séance visé.
 *
 * ⚠️ LE SYNCHRONE NE S'ÉCLATE PAS EN MEMBRES. Poser « GM101 » seul en TEAMS
 * alors que la carte a fusionné « GM101 GM102 » créerait une séance qui ne
 * couvre plus qu'un groupe — l'autre n'aurait jamais ce cours, sans que rien ne
 * le signale. Et le PRÉSENTIEL ne propose pas le libellé fusionné : on ne réunit
 * pas deux classes dans une salle.
 */
function ciblesDuType(type, libelle, membres) {
  if (type === TYPES_COURS.SYNCHRONE) return [libelle];
  if (type === TYPES_COURS.PRESENTIEL) return membres;
  // Sans filtre : l'union, pour que le serveur accepte les deux formes.
  return membres.length > 1 ? [...membres, libelle] : membres;
}
