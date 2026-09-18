import {
  TYPES,
  anneeDuNomGroupe,
  chargesHebdomadaires,
  dateRentree,
  fusionnerCellules,
  fusionnerVacances,
  lireFeuilleChronogramme,
  semainesChronogramme,
  semainesEnFormation,
  semaineDe,
  separerFusion,
} from 'shared/domain';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import mongoose from 'mongoose';
import { lireToutesLesFeuilles } from '../../lib/classeur.js';
import { construireClasseur } from './classeur.service.js';
import { TYPES_COURS } from 'shared/constants';
import { Base } from '../../models/Base.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Repartition } from '../../models/Repartition.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { conditionVersion, estDoublon, versionPerimee } from '../../lib/versionOptimiste.js';
import { joursFeries as joursFeriesEtablissement } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';

/**
 * Vacances RÉELLES d'un établissement : celles du réseau, moins celles qu'il a
 * écartées, plus les siennes.
 * (demande du porteur, 2026-09-02.)
 *
 * ⚠️ LA MÊME FUSION QUE `seances.service.js`. Lire ici les seules vacances de
 * l'établissement ferait diverger le chronogramme de l'emploi du temps : une
 * semaine fermée d'un côté, ouverte de l'autre, sans que rien ne l'explique.
 */
function vacancesEffectives(national, etablissement) {
  return fusionnerVacances(
    national.vacances,
    etablissement?.calendrier?.vacances ?? [],
    etablissement?.calendrier?.vacancesEcartees ?? []
  );
}

/**
 * Chronogramme : planning annuel prévisionnel, par groupe (F7).
 * ← api/profile/get_chronogramme_data.php + save_chronogramme.php
 *   + includes/chrono_modules.php
 *
 * ⚠️ LE SERVEUR CALCULE SES SEMAINES. L'existant les recevait du navigateur
 * (`generate_chronogramme.php:56-63`), pour éviter que la règle des fériés et
 * des vacances vive en deux exemplaires. Ici elle vit dans `shared/domain`,
 * importée des deux côtés : le serveur peut donc les calculer sans divergence
 * possible, et cesser de faire confiance au client sur ce qui BORNE la saisie.
 */

/**
 * Modules d'un groupe, tirés de la base de l'année.
 * ← chrono_extract_group_modules()
 *
 * ⚠️ `Base.affectations` ne retient que les lignes POURVUES d'un formateur, et
 * n'en garde que le code du module. C'est suffisant ici — le chronogramme
 * planifie des heures, pas des personnes — mais cela veut dire qu'un module non
 * encore affecté n'apparaît pas dans la grille. L'écran doit le dire plutôt que
 * de laisser croire que le groupe n'a que ces modules-là.
 */
/**
 * Matricule → nom complet.
 * ← `tableDesNoms()` de reconstruction.js, même raison : les affectations
 * portent l'identifiant, pas le nom.
 */
function nomDuFormateur(base, cle) {
  const formateur = (base?.formateurs ?? []).find(
    (candidat) => String(candidat.matricule ?? '').trim() === cle
  );
  return formateur?.nomComplet ?? cle;
}

/**
 * Masse statutaire ANNUELLE, par matricule OU par nom complet.
 * ← `formateurs_details.masse_horaire_statutaire`, ~1 000 h dans les données
 * réelles. Ce n'est PAS une charge de semaine : s'en servir comme repère
 * hebdomadaire rend l'échelle de couleurs du chronogramme inatteignable.
 */
function masseStatutaire(base, cle) {
  const recherche = String(cle ?? '').trim().toUpperCase();
  const formateur = (base?.formateurs ?? []).find(
    (candidat) =>
      String(candidat.matricule ?? '').trim().toUpperCase() === recherche ||
      String(candidat.nomComplet ?? '').trim().toUpperCase() === recherche
  );
  return formateur?.masseHoraire ?? 0;
}

/** Le formateur de la base, par matricule — pour apparier ses formations. */
function formateurDeCle(base, cle) {
  return (
    (base?.formateurs ?? []).find(
      (candidat) => String(candidat.matricule ?? '').trim() === cle
    ) ?? { matricule: '', nomComplet: cle }
  );
}

function modulesDuGroupe(base, groupe, intitules = new Map(), contexte = {}) {
  const recherche = String(groupe).trim().toUpperCase();
  const parCode = new Map();

  for (const affectation of base?.affectations ?? []) {
    /*
     * La colonne « Groupe » d'une affectation peut porter une FUSION
     * (« GM101 GM102 ») : le groupe cherché est l'un des noms qu'elle liste.
     *
     * ⚠️ Découper sur les ESPACES ne suffit pas — un nom en porte une dès qu'il
     * a un suffixe, « ACADA101 (FQ) ». Cette naïveté fabriquait les groupes
     * fantômes « ACADA101 » et « (FQ) », et le vrai groupe ressortait SANS
     * AUCUN MODULE — constaté sur les données réelles. `separerFusion` connaît
     * déjà la règle et elle est testée : on ne l'écrit pas une seconde fois.
     */
    const groupes = separerFusion(affectation.groupe).map((nom) => nom.toUpperCase());

    if (!groupes.includes(recherche)) continue;

    const code = String(affectation.module ?? '').trim();
    if (code === '') continue;

    const existant = parCode.get(code) ?? {
      code,
      s1: 0,
      s2: 0,
      presentiel: 0,
      synchrone: 0,
      formateurs: new Set(),
      /*
       * ⚠️ SÉPARÉS PAR TYPE. Un module peut être assuré à deux — l'un le
       * présentiel, l'autre le synchrone. La feuille de charge des formateurs
       * rattache chaque cellule à SON formateur : les confondre attribuerait à
       * l'un les heures de l'autre.
       */
      formateursPresentiel: new Set(),
      formateursSynchrone: new Set(),
      /*
       * Libellé de fusion de la ligne synchrone (« GM101 GM102 »). Une séance
       * mutualisée est diffusée à plusieurs groupes mais ne PÈSE qu'une fois sur
       * le formateur : c'est cette étiquette qui permet de la compter une seule
       * fois.
       */
      fusionSynchrone: '',
      estRegional: false,
    };
    const heures = arrondir((affectation.s1Heures ?? 0) + (affectation.s2Heures ?? 0));

    /*
     * ⚠️ Les masses S'ACCUMULENT par TYPE. Un module apparaît souvent DEUX fois
     * pour le même groupe — une ligne présentielle et une ligne synchrone. Les
     * écraser ferait perdre l'une des deux, et le plafond de saisie serait faux.
     */
    if (affectation.type === TYPES_COURS.SYNCHRONE) {
      existant.synchrone += heures;
      if (affectation.formateur) {
        existant.formateursSynchrone.add(String(affectation.formateur).trim());
      }
      const fusion = String(affectation.groupe ?? '').trim();
      if (fusion !== '') existant.fusionSynchrone = fusion;
    } else {
      existant.presentiel += heures;
      if (affectation.formateur) {
        existant.formateursPresentiel.add(String(affectation.formateur).trim());
      }
    }

    // Le semestre se lit sur le CUMUL des deux types : un module donné en
    // présentiel au S1 et en synchrone au S2 est annuel.
    existant.s1 += affectation.s1Heures ?? 0;
    existant.s2 += affectation.s2Heures ?? 0;

    /*
     * ⚠️ `affectation.formateur` porte le MATRICULE quand il existe — jamais un
     * nom. L'afficher tel quel mettrait « 18448 » dans la colonne Formateur ;
     * c'est le défaut déjà rencontré à la reconstruction de la carte. La table
     * des noms le traduit.
     */
    if (affectation.formateur) existant.formateurs.add(String(affectation.formateur).trim());
    // Un EFM régional l'est pour le module, quelle que soit la ligne qui le dit.
    if (affectation.estRegional) existant.estRegional = true;

    parCode.set(code, existant);
  }

  return [...parCode.values()]
    .map((module) => ({
      code: module.code,
      /*
       * ⚠️ L'INTITULÉ VIENT DE LA RÉPARTITION DRIF, pas de la base.
       * `Base.affectations` ne retient que le CODE du module — « M102 » — et
       * l'écran ne peut donc pas dire ce que ce module enseigne. Le référentiel
       * national, lui, porte le libellé : c'est déjà ainsi que la carte
       * d'établissement retrouve ses intitulés à la reconstruction.
       */
      intitule: intitules.get(module.code) ?? '',
      masses: {
        presentiel: arrondir(module.presentiel),
        synchrone: arrondir(module.synchrone),
      },
      estRegional: module.estRegional,
      // Plusieurs formateurs sur un même module — présentiel et synchrone
      // assurés par deux personnes — sont nommés ensemble : la colonne dit QUI
      // enseigne, pas « le premier trouvé ».
      formateurs: [...module.formateurs].map((cle) => nomDuFormateur(base, cle)).sort(),
      formateursPresentiel: [...module.formateursPresentiel]
        .map((cle) => nomDuFormateur(base, cle))
        .sort(),
      formateursSynchrone: [...module.formateursSynchrone]
        .map((cle) => nomDuFormateur(base, cle))
        .sort(),
      fusionSynchrone: module.fusionSynchrone,
      /*
       * ⚠️ SEMAINES DE FORMATION — VERROUILLAGE PAR LIGNE, PAS PAR COLONNE.
       * Une formation retient une PERSONNE, pas un groupe : fermer la colonne
       * entière rendrait insaisissables les dix autres modules du groupe, dont
       * les formateurs sont là. C'est la même règle que le stage en vue
       * formateur, prise par l'autre bout.
       *
       * ⚠️ Et il faut que TOUS les formateurs du module y soient. Un module
       * assuré à deux — l'un le présentiel, l'autre le synchrone — reste
       * enseignable quand un seul s'absente ; le verrouiller ferait perdre une
       * semaine de cours qui a bien lieu.
       */
      formationSemaines: semainesToutesEnFormation(
        contexte.semaines ?? [],
        [...module.formateurs].map((cle) => formateurDeCle(base, cle)),
        contexte.formations ?? []
      ),
      // Même règle que les badges de la grille d'affectations, pas une seconde
      // écriture : S1 seul, S2 seul, ou annuel.
      semestre: module.s1 > 0 && module.s2 > 0 ? 'annuel' : module.s1 > 0 ? 'S1' : 'S2',
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'fr'));
}

/**
 * Semaines où AUCUN des formateurs du module n'est disponible.
 *
 * ⚠️ ON RETIENT LE PLUS PETIT NOMBRE DE JOURS (2026-08-26). Depuis que les
 * absences se comptent en jours, le module n'est empêché que sur les jours où
 * TOUS ses formateurs manquent : si l'un s'absente cinq jours et l'autre deux,
 * le cours reste assurable trois jours par le premier revenu.
 */
function semainesToutesEnFormation(semaines, formateurs, formations) {
  if (formateurs.length === 0 || formations.length === 0) return [];

  const parFormateur = formateurs.map(
    (formateur) =>
      new Map(
        semainesEnFormation(semaines, formateur, formations).map((s) => [s.numero, s.jours])
      )
  );

  return semaines
    .filter((semaine) => parFormateur.every((absentes) => absentes.has(semaine.numero)))
    .map((semaine) => ({
      numero: semaine.numero,
      jours: Math.min(...parFormateur.map((absentes) => absentes.get(semaine.numero))),
    }));
}

/**
 * Code de module → intitulé, depuis la répartition DRIF.
 *
 * Une seule requête, bornée aux codes réellement présents : le référentiel
 * compte 13 359 lignes, les charger toutes pour en lire vingt serait le défaut
 * que le §4.4 relève sur les emplois du temps.
 */
/** Intitulés d'une liste de codes — la requête que les deux vues partagent. */
async function intitulesParCode(codes) {
  const uniques = [...new Set(codes.filter((code) => String(code).trim() !== ''))];
  if (uniques.length === 0) return new Map();

  const lignes = await Repartition.find({ codeModule: { $in: uniques } })
    .select('codeModule module')
    .lean();

  return new Map(
    lignes
      .filter((ligne) => String(ligne.module ?? '').trim() !== '')
      .map((ligne) => [ligne.codeModule, ligne.module])
  );
}

async function intitulesModules(base, groupe) {
  const codes = new Set();

  for (const affectation of base?.affectations ?? []) {
    const groupes = separerFusion(affectation.groupe).map((nom) => nom.toUpperCase());
    if (!groupes.includes(String(groupe).trim().toUpperCase())) continue;

    const code = String(affectation.module ?? '').trim();
    if (code !== '') codes.add(code);
  }

  return intitulesParCode([...codes]);
}

/** Groupes de l'année, avec l'état de leur chronogramme. ← get_chrono_status.php */
export async function listerGroupes(etablissementId, anneeScolaire) {
  const [base, plannings] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('groupes'),
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning'),
  ]);

  const remplis = new Map(
    plannings.map((chrono) => [
      chrono.groupe,
      // Un planning existant mais VIDE n'est pas un chronogramme fait : le
      // compter comme tel laisserait croire le travail terminé.
      [...chrono.planning.values()].some((cellules) => cellules.length > 0),
    ])
  );

  return (base?.groupes ?? []).map((groupe) => ({
    groupe,
    planifie: remplis.get(groupe) === true,
  }));
}

/**
 * Les semaines d'absence et de rattrapage, par ligne de chronogramme
 * (2026-09-14, demande du porteur : « la séance absente aussi en
 * chronogramme … avec un style rattrapage »).
 *
 * `{ "GM101||M101": { 3: { absences: 1, rattrapages: 0 } } }` — la clé est celle
 * d'une ligne, `groupe||module`, en MAJUSCULES : la séance et la base e-note ne
 * s'accordent pas toujours sur la casse (même règle que `reporterRattrapage`).
 *
 * ⚠️ UN REPÈRE, PAS UNE DONNÉE DU PLANNING. Le chronogramme stocke des heures
 * par semaine, sans dire d'où elles viennent ; ajouter un drapeau dans chaque
 * cellule aurait changé sa forme de stockage pour un affichage. Le repère se
 * recalcule depuis le registre des absences, qui fait foi.
 *
 * ⚠️ UNE FUSION MARQUE CHACUN DE SES GROUPES : la séance synchrone manquée
 * l'était pour tous, et son rattrapage est reporté dans chacun de leurs
 * chronogrammes (`groupesConcernes`).
 *
 * ⚠️ LA LIAISON FINE EMPLOI ↔ CHRONOGRAMME EST REPORTÉE (décision du porteur) :
 * ce repère dit « une absence cette semaine », il ne relie pas encore la cellule
 * à la séance.
 */
export async function marquesRattrapage(etablissementId, anneeScolaire, groupes) {
  const cibles = new Set([...groupes].map((groupe) => String(groupe).trim().toUpperCase()));
  if (cibles.size === 0) return {};

  const absences = await AbsenceFormateur.find({ etablissementId, anneeScolaire })
    .select('groupe module dateAbsence dateRattrapage')
    .lean();

  const marques = {};
  const noter = (groupe, module, date, champ) => {
    if (!date) return;
    const { numero } = semaineDe(date instanceof Date ? date : new Date(date));
    if (!Number.isInteger(numero)) return;
    const cle = `${groupe}||${String(module).trim().toUpperCase()}`;
    const ligne = (marques[cle] ??= {});
    const semaine = (ligne[numero] ??= { absences: 0, rattrapages: 0 });
    semaine[champ] += 1;
  };

  for (const absence of absences) {
    if (!absence.module) continue;
    for (const membre of separerFusion(absence.groupe)) {
      const groupe = String(membre).trim().toUpperCase();
      if (!cibles.has(groupe)) continue;
      noter(groupe, absence.module, absence.dateAbsence, 'absences');
      noter(groupe, absence.module, absence.dateRattrapage, 'rattrapages');
    }
  }

  return marques;
}

/** Grille complète d'un groupe : modules, semaines, planning. */
export async function obtenir(etablissementId, anneeScolaire, groupe) {
  const [base, etablissement, chrono] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }),
    Etablissement.findById(etablissementId).select('calendrier stages formations'),
    Chronogramme.findOne({ etablissementId, anneeScolaire, groupe }),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  if (!(base.groupes ?? []).includes(groupe)) {
    throw notFound(`Le groupe « ${groupe} » n’existe pas dans la base`, { code: 'GROUPE_INCONNU' });
  }

  // Fériés nationaux FUSIONNÉS avec les ajustements de l'établissement : une
  // date corrigée localement doit verrouiller la bonne colonne, pas celle que
  // l'API proposait.
  const [{ joursFeries }, national] = await Promise.all([
    joursFeriesEtablissement(etablissementId, anneeScolaire),
    calendrierNational(anneeScolaire),
  ]);

  /*
   * ⚠️ EN MODE GROUPE, LA RENTRÉE FERME LA COLONNE. Le tableau ne porte qu'un
   * groupe, donc une seule année de formation : `semainesChronogramme` la lit
   * dans son nom et gèle ce qui précède. En mode formateur, la même règle doit
   * descendre ligne par ligne — voir `parFormateur`.
   */
  const semaines = semainesChronogramme(anneeScolaire, {
    joursFeries,
    vacances: vacancesEffectives(national, etablissement),
    stages: etablissement?.stages ?? [],
    groupe,
    rentrees: national.rentrees,
  });

  return {
    groupe,
    anneeScolaire,
    modules: modulesDuGroupe(base, groupe, await intitulesModules(base, groupe), {
      semaines,
      formations: etablissement?.formations ?? [],
    }),
    semaines,
    planning: chrono ? depuisMongo(chrono.planning) : {},
    // La version que l'écran renverra (étape d3) ; 0 tant qu'aucun planning n'existe.
    version: chrono?.version ?? 0,
    marques: await marquesRattrapage(etablissementId, anneeScolaire, [groupe]),
  };
}

/**
 * Formateurs de l'année, avec le nombre de modules qu'ils portent.
 * Sert à peupler le sélecteur du mode formateur.
 */
export async function listerFormateurs(etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select(
    'formateurs affectations'
  );

  const comptes = new Map();

  for (const affectation of base?.affectations ?? []) {
    const cle = String(affectation.formateur ?? '').trim();
    if (cle === '') continue;
    comptes.set(cle, (comptes.get(cle) ?? 0) + 1);
  }

  return [...comptes]
    .map(([cle, modules]) => ({
      identifiant: cle,
      nom: nomDuFormateur(base, cle),
      modules,
      /*
       * ⚠️ MASSE ANNUELLE, PAS HEBDOMADAIRE. `formateurs_details.masse_horaire_statutaire`
       * vaut ~1 000 h dans les données réelles : c'est une capacité d'ANNÉE, pas
       * une charge de semaine. Le champ s'appelait `masseHoraire` comme dans la
       * base, et je l'ai pris pour un repère hebdomadaire — l'écran a affiché
       * « masse statutaire 1000 h/semaine », et le seuil de couleur du pied de
       * grille devenait inatteignable, donc l'échelle entière morte. Le nom
       * porte désormais l'unité.
       */
      masseAnnuelle: masseStatutaire(base, cle),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * Grille d'un FORMATEUR : ses modules, dans TOUS les groupes où il intervient.
 * ← le mode formateur de profil-principal.js:5589-5640
 *
 * ═══ POURQUOI CETTE VUE EXISTE ═══
 * Par groupe, on répond à « ce groupe a-t-il toutes ses heures ? ». Par
 * formateur, à « cette personne est-elle chargée régulièrement, ou tout tombe-t-il
 * la même semaine ? ». Les deux questions se posent, et la seconde ne se lit pas
 * en ouvrant vingt grilles de groupe l'une après l'autre.
 *
 * ⚠️ LES SEMAINES NE SONT PAS LES MÊMES POUR TOUTES LES LIGNES. Les vacances et
 * les fériés valent pour tout l'établissement, mais un STAGE ne ferme que le
 * groupe concerné. On renvoie donc les semaines communes, plus les semaines de
 * stage PAR GROUPE : l'écran verrouille alors ligne par ligne. Marquer la
 * colonne entière dès qu'un seul groupe est en stage ferait croire la semaine
 * fermée pour tout le monde.
 */
export async function obtenirParFormateur(etablissementId, anneeScolaire, formateur) {
  const [base, etablissement] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }),
    Etablissement.findById(etablissementId).select('calendrier stages formations'),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  const recherche = String(formateur).trim().toUpperCase();
  const correspond = (valeur) =>
    String(valeur ?? '').trim().toUpperCase() === recherche ||
    nomDuFormateur(base, String(valeur ?? '').trim()).toUpperCase() === recherche;

  const groupes = new Set();
  const parCle = new Map();

  /*
   * ⚠️ MODULE CO-ENSEIGNÉ. Un module peut être assuré à un groupe par DEUX
   * personnes — l'une le présentiel, l'autre le synchrone. La grille du
   * formateur affiche alors les cellules du module (elles sont stockées par
   * groupe et par module, pas par personne) alors que la masse affichée n'est
   * que SA part : l'écart paraîtrait faux sans explication. On repère donc ces
   * cas pour que l'écran les signale plutôt que de laisser conclure à un bug.
   */
  const autresFormateurs = new Map();
  for (const affectation of base.affectations ?? []) {
    if (correspond(affectation.formateur)) continue;
    const code = String(affectation.module ?? '').trim();
    if (code === '') continue;
    for (const groupe of separerFusion(affectation.groupe)) {
      const cle = `${groupe}||${code}`;
      autresFormateurs.set(
        cle,
        (autresFormateurs.get(cle) ?? new Set()).add(
          nomDuFormateur(base, String(affectation.formateur ?? '').trim())
        )
      );
    }
  }

  for (const affectation of base.affectations ?? []) {
    if (!correspond(affectation.formateur)) continue;

    const code = String(affectation.module ?? '').trim();
    if (code === '') continue;

    // Une affectation FUSIONNÉE porte plusieurs groupes : la ligne est
    // dupliquée, chacun ayant son propre planning et ses propres stages.
    for (const groupe of separerFusion(affectation.groupe)) {
      groupes.add(groupe);
      const cle = `${groupe}||${code}`;

      const existant = parCle.get(cle) ?? {
        groupe,
        code,
        s1: 0,
        s2: 0,
        presentiel: 0,
        synchrone: 0,
        fusionSynchrone: '',
        estRegional: false,
      };

      const heures = arrondir((affectation.s1Heures ?? 0) + (affectation.s2Heures ?? 0));
      if (affectation.type === TYPES_COURS.SYNCHRONE) {
        existant.synchrone += heures;
        const fusion = String(affectation.groupe ?? '').trim();
        if (fusion !== '') existant.fusionSynchrone = fusion;
      } else {
        existant.presentiel += heures;
      }

      existant.s1 += affectation.s1Heures ?? 0;
      existant.s2 += affectation.s2Heures ?? 0;
      if (affectation.estRegional) existant.estRegional = true;

      parCle.set(cle, existant);
    }
  }

  if (parCle.size === 0) {
    throw notFound(`Aucun module affecté à « ${formateur} »`, { code: 'FORMATEUR_SANS_MODULE' });
  }

  const [{ joursFeries }, national] = await Promise.all([
    joursFeriesEtablissement(etablissementId, anneeScolaire),
    calendrierNational(anneeScolaire),
  ]);
  const vacances = vacancesEffectives(national, etablissement);

  // Semaines COMMUNES : vacances et fériés seulement, sans stage — celui-ci
  // dépend du groupe et se traite ligne par ligne.
  const semaines = semainesChronogramme(anneeScolaire, { joursFeries, vacances });

  /*
   * ⚠️ ICI, LA FORMATION VAUT POUR TOUTE LA GRILLE. Le tableau ne porte qu'une
   * personne : si elle est en formation, aucune de ses lignes n'est saisissable
   * cette semaine-là, quel que soit le groupe. C'est l'inverse exact du stage,
   * qui ne ferme qu'une ligne — les deux portées se croisent sur cet écran, et
   * c'est pour cela qu'elles voyagent séparément.
   */
  const formationSemaines = semainesEnFormation(
    semaines,
    formateurDeCle(base, String(formateur).trim()),
    etablissement?.formations ?? []
  );

  /*
   * ═══ ⚠️ EN MODE FORMATEUR, LA RENTRÉE NE PEUT PAS FERMER LA COLONNE ═══
   * (2026-09-02.) Le même enseignant a ses 2ᵉ années dès le 7 septembre et rien
   * avec ses 1ʳᵉ avant le 11 : geler la colonne lui interdirait un cours qui a
   * bien lieu. Le gel descend donc LIGNE PAR LIGNE, exactement comme le stage —
   * et c'est bien la même règle de domaine qui s'applique aux deux.
   */
  const rentreesParGroupe = {};
  const stagesParGroupe = {};
  for (const groupe of groupes) {
    const gel = semainesChronogramme(anneeScolaire, {
      joursFeries,
      vacances,
      groupe,
      rentrees: national.rentrees,
    })
      .filter((semaine) => (semaine.joursRentree ?? 0) > 0)
      .map((semaine) => ({ numero: semaine.numero, jours: semaine.joursRentree }));

    if (gel.length > 0) {
      rentreesParGroupe[groupe] = {
        date: dateRentree(anneeDuNomGroupe(groupe), national.rentrees),
        semaines: gel,
      };
    }

    /*
     * ⚠️ ON REMONTE LE NOMBRE DE JOURS, plus la seule liste des semaines
     * fermées : un stage en plage libre peut ne couvrir que trois jours, et la
     * ligne doit rester saisissable sur les trois autres.
     */
    stagesParGroupe[groupe] = semainesChronogramme(anneeScolaire, {
      joursFeries,
      vacances,
      stages: etablissement?.stages ?? [],
      groupe,
    })
      .filter((semaine) => (semaine.joursStage ?? 0) > 0)
      .map((semaine) => ({ numero: semaine.numero, jours: semaine.joursStage }));
  }

  const intitules = await intitulesParCode([...parCle.values()].map((ligne) => ligne.code));

  const plannings = await Chronogramme.find({
    etablissementId,
    anneeScolaire,
    groupe: { $in: [...groupes] },
  });

  return {
    formateur,
    // L'écran interroge par IDENTIFIANT — souvent un matricule. Le nom complet
    // repart avec la grille, sinon le titre afficherait « 18448 ».
    nom: nomDuFormateur(base, String(formateur).trim()),
    masseAnnuelle: masseStatutaire(base, formateur),
    anneeScolaire,
    semaines,
    stagesParGroupe,
    rentreesParGroupe,
    formationSemaines,
    lignes: [...parCle.values()]
      .map((ligne) => ({
        groupe: ligne.groupe,
        code: ligne.code,
        intitule: intitules.get(ligne.code) ?? '',
        masses: { presentiel: arrondir(ligne.presentiel), synchrone: arrondir(ligne.synchrone) },
        estRegional: ligne.estRegional,
        formateursPresentiel: ligne.presentiel > 0 ? [nomDuFormateur(base, String(formateur).trim())] : [],
        formateursSynchrone: ligne.synchrone > 0 ? [nomDuFormateur(base, String(formateur).trim())] : [],
        fusionSynchrone: ligne.fusionSynchrone,
        // Les autres personnes qui interviennent sur ce module pour ce groupe.
        partageAvec: [...(autresFormateurs.get(`${ligne.groupe}||${ligne.code}`) ?? [])].sort(),
        semestre: ligne.s1 > 0 && ligne.s2 > 0 ? 'annuel' : ligne.s1 > 0 ? 'S1' : 'S2',
      }))
      .sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr') || a.code.localeCompare(b.code, 'fr')),
    plannings: Object.fromEntries(
      plannings.map((chrono) => [chrono.groupe, depuisMongo(chrono.planning)])
    ),
    // Une version PAR GROUPE : c'est le planning d'un groupe qui s'écrit (étape d3).
    versions: Object.fromEntries(plannings.map((chrono) => [chrono.groupe, chrono.version ?? 0])),
    marques: await marquesRattrapage(etablissementId, anneeScolaire, groupes),
  };
}

/**
 * Enregistre le planning d'un groupe.
 *
 * Remplacement intégral, comme `save_chronogramme.php` : la grille est envoyée
 * en entier, et un envoi partiel n'aurait pas de sens — on ne saurait pas
 * distinguer « cette cellule est vide » de « cette cellule n'a pas été
 * transmise ».
 */
export async function enregistrer(etablissementId, anneeScolaire, groupe, planning, version) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('groupes');

  if (!(base?.groupes ?? []).includes(groupe)) {
    throw badRequest(`Le groupe « ${groupe} » n’existe pas dans la base`, {
      code: 'GROUPE_INCONNU',
    });
  }

  /*
   * ═══ LA VERSION EST DANS LE FILTRE (étape d3) ═══
   * Le planning d'un groupe qu'un collègue vient d'enregistrer ne correspond
   * plus : le filtre ne trouve rien, l'`upsert` tente alors d'INSÉRER un second
   * planning pour le même groupe, et la clé unique le refuse — c'est ce refus
   * qu'on traduit en 409. Un groupe qui n'a encore aucun planning s'insère
   * normalement (version 0 attendue).
   */
  let chrono;
  try {
    chrono = await Chronogramme.findOneAndUpdate(
      { etablissementId, anneeScolaire, groupe, ...conditionVersion('version', version) },
      { $set: { planning: versMongo(planning) }, $inc: { version: 1 } },
      { upsert: true, new: true }
    );
  } catch (erreur) {
    if (estDoublon(erreur)) throw versionPerimee();
    throw erreur;
  }

  /*
   * Le planning TEL QU'ENREGISTRÉ (cellules vides retirées) : la route l'annonce
   * aux collègues connectés, qui l'appliquent sans relire (2026-09-13).
   */
  return {
    groupe,
    cellules: compterCellules(chrono.planning),
    version: chrono.version,
    planning: depuisMongo(chrono.planning),
  };
}

/**
 * Charge hebdomadaire de TOUS les formateurs et de TOUS les groupes de l'année.
 * ← api/profile/get_charge_formateurs.php
 *
 * ⚠️ SUR TOUS LES CHRONOGRAMMES, pas seulement ceux affichés. L'ancien calcul
 * lisait les sélecteurs de la page : pour connaître la charge réelle d'une
 * personne, il fallait cocher les vingt groupes et attendre que les grilles se
 * montent — précisément ce qu'on cherche à éviter en ouvrant ce tableau.
 *
 * ⚠️ LES DEUX VUES DANS UNE SEULE RÉPONSE. Le calcul parcourt les mêmes
 * plannings : les séparer en deux routes ferait lire la base deux fois pour le
 * même travail, et laisserait les deux totaux diverger le jour où l'un serait
 * corrigé.
 */
export async function charge(etablissementId, anneeScolaire) {
  const [base, plannings] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }),
    Chronogramme.find({ etablissementId, anneeScolaire }),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  const lignes = [];
  const groupesIgnores = [];
  let groupesLus = 0;

  for (const chrono of plannings) {
    const modules = modulesDuGroupe(base, chrono.groupe);

    /*
     * Le groupe existe-t-il ENCORE dans la base ? Un chronogramme survivant à
     * un changement de carte porterait une charge que plus personne n'assure —
     * et la personne à qui elle est attribuée n'y peut rien.
     */
    if (modules.length === 0) {
      groupesIgnores.push(chrono.groupe);
      continue;
    }
    groupesLus += 1;

    const planning = depuisMongo(chrono.planning);

    for (const module of modules) {
      const cellules = planning[module.code];
      if (!cellules) continue;

      /*
       * ⚠️ UNE LIGNE PAR FORMATEUR ET PAR TYPE. Un module assuré à deux — l'un
       * le présentiel, l'autre le synchrone — attribuerait sinon à l'un les
       * heures de l'autre. Chaque ligne ne porte donc que les cellules de SON
       * type, et le domaine n'a plus à deviner.
       */
      for (const [type, titulaires] of [
        [TYPES.PRESENTIEL, module.formateursPresentiel],
        [TYPES.SYNCHRONE, module.formateursSynchrone],
      ]) {
        const duType = Object.fromEntries(
          Object.entries(cellules).filter(([, cellule]) => cellule.type === type)
        );
        if (Object.keys(duType).length === 0) continue;

        // Sans titulaire connu, la ligne compte pour le GROUPE mais pour
        // personne : c'est ce que fait `calculerCharges` d'un formateur vide.
        for (const formateur of titulaires.length > 0 ? titulaires : ['']) {
          lignes.push({
            groupe: chrono.groupe,
            module: module.code,
            formateur,
            ensemble: module.fusionSynchrone || chrono.groupe,
            planning: duType,
          });
        }
      }
    }
  }

  return { anneeScolaire, groupesLus, groupesIgnores, ...chargesHebdomadaires(lignes) };
}

/**
 * Classeur d'export — un onglet par sujet, plus la feuille de bilan.
 * ← export_chronogramme.php
 */
export async function exporter(etablissementId, anneeScolaire, { mode, sujets }) {
  const feuilles = [];

  for (const sujet of sujets) {
    if (mode === 'formateur') {
      const grille = await obtenirParFormateur(etablissementId, anneeScolaire, sujet);

      /*
       * ⚠️ La feuille d'un formateur mêle des modules de PLUSIEURS groupes : ses
       * lignes portent donc leur groupe, et le planning est mis à plat sous la
       * même clé `groupe||module` que l'écran. Sans cette mise à plat, deux
       * groupes suivant le même module se retrouveraient sur la même ligne.
       */
      const plat = {};
      for (const ligne of grille.lignes) {
        plat[`${ligne.groupe}||${ligne.code}`] = grille.plannings[ligne.groupe]?.[ligne.code] ?? {};
      }

      feuilles.push({
        sujet: grille.nom || sujet,
        modules: grille.lignes.map((ligne) => ({ ...ligne, cle: `${ligne.groupe}||${ligne.code}` })),
        planning: plat,
        semaines: grille.semaines,
        stagesParGroupe: grille.stagesParGroupe,
      });
      continue;
    }

    const grille = await obtenir(etablissementId, anneeScolaire, sujet);
    feuilles.push({
      sujet,
      modules: grille.modules,
      planning: grille.planning,
      semaines: grille.semaines,
      stagesParGroupe: {},
    });
  }

  return construireClasseur({
    mode,
    anneeScolaire: `${anneeScolaire}-${anneeScolaire + 1}`,
    feuilles,
  });
}

/**
 * Relit un classeur et applique son contenu.
 * ← import_chronogramme.php
 *
 * ⚠️ FUSION, JAMAIS REMPLACEMENT — et l'écriture est TRANSACTIONNELLE. Un
 * classeur à moitié appliqué laisserait des groupes à jour et d'autres non, sans
 * moyen de savoir lesquels. Le tri de ce qui est acceptable, lui, a déjà eu lieu
 * dans le domaine.
 */
export async function importer(etablissementId, anneeScolaire, tampon, nomFichier) {
  const base = await Base.findOne({ etablissementId, anneeScolaire });
  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  // Le référentiel dit ce que le fichier a le DROIT d'écrire.
  const groupes = new Map();
  const modulesParGroupe = new Map();

  for (const groupe of base.groupes ?? []) {
    groupes.set(groupe.toUpperCase(), groupe);
    modulesParGroupe.set(
      groupe.toUpperCase(),
      new Map(
        modulesDuGroupe(base, groupe).map((module) => [module.code.toUpperCase(), module.code])
      )
    );
  }

  const feuilles = await lireToutesLesFeuilles(tampon, nomFichier);
  const rapport = [];
  const cellules = [];

  for (const feuille of feuilles) {
    const lu = lireFeuilleChronogramme(feuille, { groupes, modulesParGroupe });

    // Les feuilles techniques ne sont pas signalées : les nommer encombrerait
    // le rapport de lignes que personne ne peut corriger.
    if (lu.etat === 'technique') continue;

    if (lu.etat === 'ignoree') {
      rapport.push({ feuille: feuille.nom, etat: 'ignoree', raison: lu.raison });
      continue;
    }

    cellules.push(...lu.cellules);
    rapport.push({
      feuille: feuille.nom,
      sujet: lu.sujet,
      mode: lu.mode,
      etat: 'lue',
      cellules: lu.cellules.filter((c) => c.heures !== null).length,
      refus: lu.refus,
    });
  }

  if (cellules.length === 0) {
    throw badRequest('Aucune cellule exploitable dans ce fichier', {
      code: 'CLASSEUR_INEXPLOITABLE',
      rapport,
    });
  }

  // Plannings ACTUELS des groupes touchés : la fusion part d'eux, elle ne
  // reconstruit rien.
  const concernes = [...new Set(cellules.map((c) => c.groupe))];
  const existants = await Chronogramme.find({
    etablissementId,
    anneeScolaire,
    groupe: { $in: concernes },
  });

  const depart = {};
  for (const groupe of concernes) depart[groupe] = {};
  for (const chrono of existants) depart[chrono.groupe] = depuisMongo(chrono.planning);

  const { plannings, ecrites, effacees, groupes: touches } = fusionnerCellules(depart, cellules);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const groupe of touches) {
        await Chronogramme.findOneAndUpdate(
          { etablissementId, anneeScolaire, groupe },
          // L'import réécrit le groupe : une grille ouverte avant est périmée (d3).
          { $set: { planning: versMongo(plannings[groupe]) }, $inc: { version: 1 } },
          { upsert: true, session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return { groupes: touches, ecrites, effacees, rapport };
}

/**
 * `{ module: { semaine: {heures,type} } }` → la forme du modèle Mongoose.
 *
 * ⚠️ EXPORTÉES parce que le report des rattrapages (F8) écrit dans les MÊMES
 * plannings. Une seconde paire de convertisseurs, écrite à côté, aurait dérivé
 * de celle-ci au premier changement de forme — c'est le constat §4.2.
 */
export function versMongo(planning) {
  const converti = {};

  for (const [module, cellules] of Object.entries(planning ?? {})) {
    const seances = Object.entries(cellules ?? {})
      .filter(([, cellule]) => Number(cellule?.heures) > 0)
      .map(([semaine, cellule]) => ({
        semaine: `S${semaine}`,
        heures: Number(cellule.heures),
        type: cellule.type === 'S' ? 'S' : 'P',
      }));

    if (seances.length > 0) converti[module] = seances;
  }

  return converti;
}

/** Et l'inverse — « S12 » redevient la clé 12, celle des colonnes. */
export function depuisMongo(planning) {
  const converti = {};

  for (const [module, seances] of planning ?? new Map()) {
    const cellules = {};
    for (const seance of seances) {
      const numero = Number(String(seance.semaine).replace(/^S/i, ''));
      if (!Number.isInteger(numero)) continue;
      cellules[numero] = { heures: seance.heures, type: seance.type };
    }
    converti[module] = cellules;
  }

  return converti;
}

function compterCellules(planning) {
  let total = 0;
  for (const seances of planning.values()) total += seances.length;
  return total;
}

function arrondir(valeur) {
  return Math.round(valeur * 100) / 100;
}
