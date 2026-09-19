import mongoose from 'mongoose';
import { PERIODES, TYPES_COURS } from 'shared/constants';
import { JOURS } from 'shared/constants';
import {
  absencesDuJour,
  anneeDuNomGroupe,
  avantRentree,
  separerFusion,
  avancementParSemaine,
  cleModule,
  dateDuJour,
  datesDeLaSemaine,
  detecterConflits,
  dureeSeance,
  enJour,
  fichesModules,
  filieresParGroupe,
  fusionnerVacances,
  groupesDuSoir,
  heuresPosees,
  modulesRegionaux,
  normaliserValeurSemaine,
  optionsDuFormateur,
  seancesDeLExamen,
  semaineAOuvrir,
  titulairesDuModule,
  typeDeSeance,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Repartition } from '../../models/Repartition.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { lister as listerContraintes } from '../base/contraintes.service.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/httpError.js';
import { logger } from '../../lib/logger.js';
import { joursFeries as joursFeriesEtablissement } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { detacherRattrapage, synchroniser } from '../absences/absences.service.js';

/**
 * Emploi du temps hebdomadaire (F5).
 * ← api/data/get_timetable.php + get_all_timetables.php + save_timetable.php
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 * `emplois_du_temps.donnees_json` portait TOUTE une semaine en un seul blob,
 * réécrit en entier à chaque enregistrement : deux personnes sur la même
 * semaine, et l'une perdait son travail sans le savoir. Les séances sont ici des
 * documents unitaires — deux séances différentes ne se marchent plus dessus, et
 * les conflits se cherchent par requête indexée au lieu d'un parcours en
 * JavaScript de toutes les grilles.
 *
 * ⚠️ CETTE PREMIÈRE LIVRAISON EST EN LECTURE SEULE. Rien n'écrit : la grille
 * affiche, la navigation change de semaine. C'est le découpage voulu — la page
 * la plus utilisée du SaaS ne se remplace pas d'un bloc sans point de contrôle.
 */

/**
 * La semaine publiée d'une année, prête à afficher.
 *
 * ⚠️ `null` QUAND RIEN N'EST PUBLIÉ, jamais un objet vide : « aucune
 * publication » et « publication sans semaine » ne veulent pas dire la même
 * chose, et l'écran doit pouvoir retomber sur la règle du week-end.
 */
function publicationDeLAnnee(etablissement, anneeScolaire) {
  const entree = (etablissement?.publications ?? []).find(
    (publication) => publication.anneeScolaire === anneeScolaire
  );
  if (!entree) return null;

  return {
    semaine: entree.semaine,
    publieeLe: entree.publieeLe,
  };
}

/**
 * Publie une semaine — elle devient celle qui FAIT FOI.
 * ← `publish_timetable.php` (POST)
 *
 * ═══ ⚠️ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 *  · **Une entrée par ANNÉE** : là-bas une seule colonne servait toutes les
 *    années, et publier dans l'une effaçait la publication de l'autre.
 *  · **Aucune ligne fantôme** : `publish_timetable.php` INSÉRAIT une semaine
 *    vide (`donnees_json = '{}'`) quand elle n'avait jamais été saisie — il
 *    publiait donc ce qui n'existait pas. Ici rien n'est créé : la publication
 *    ne décrit qu'un CHOIX, pas un contenu.
 *  · **Aucun drapeau à tenir en phase** : plus de `est_publie` par semaine.
 *
 * ⚠️ ON NE REFUSE PAS UNE SEMAINE SANS SÉANCE. Le directeur peut publier
 * d'avance ; et refuser l'obligerait à saisir avant d'annoncer, ce que
 * l'existant ne demandait pas non plus.
 */
export async function publier(etablissementId, anneeScolaire, valeur, parUtilisateurId) {
  const semaine = normaliserValeurSemaine(valeur);
  if (!semaine) {
    throw badRequest(`Semaine invalide : « ${valeur} »`, { code: 'SEMAINE_INVALIDE' });
  }

  /*
   * ⚠️ UN SEUL ALLER-RETOUR, ET PAS DE LECTURE-PUIS-ÉCRITURE. On retire
   * l'entrée de l'année puis on la repose : deux publications simultanées ne
   * peuvent pas en laisser deux pour la même année.
   */
  await Etablissement.updateOne(
    { _id: etablissementId },
    { $pull: { publications: { anneeScolaire } } }
  );
  await Etablissement.updateOne(
    { _id: etablissementId },
    {
      $push: {
        publications: {
          anneeScolaire,
          semaine,
          publieeLe: new Date(),
          publieePar: parUtilisateurId ?? null,
        },
      },
    }
  );

  return { semaine, publieeLe: new Date() };
}

/**
 * Retire la publication de l'année — on retombe sur la règle du week-end.
 * ← `publish_timetable.php` (DELETE)
 *
 * ⚠️ SEULE L'ANNÉE COURANTE EST TOUCHÉE. L'existant remettait à zéro TOUT
 * l'établissement (`UPDATE … WHERE etablissement_id = ?`) : dépublier une
 * semaine effaçait aussi la publication des autres années.
 */
export async function depublier(etablissementId, anneeScolaire) {
  await Etablissement.updateOne(
    { _id: etablissementId },
    { $pull: { publications: { anneeScolaire } } }
  );

  return { semaine: null };
}

/**
 * Ce dont la grille a besoin pour se dessiner, et qui ne change pas d'une
 * semaine à l'autre : les formateurs, les groupes, les salles.
 *
 * Une seule requête pour toute la page : les demander semaine par semaine
 * relancerait le même travail à chaque flèche de navigation.
 */
export async function contexte(etablissementId, anneeScolaire) {
  const [base, etablissement] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select(
      'formateurs groupes affectations groupeFilieres'
    ),
    Etablissement.findById(etablissementId).select('espaces groupesFq publications'),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  /*
   * ⚠️ LE MATRICULE EST L'IDENTIFIANT, LE NOM N'EST QU'UN AFFICHAGE. Les séances
   * portent `formateurMatricule` : rendre la liste indexée par nom obligerait
   * l'écran à retraduire, et c'est exactement l'endroit où les « formateurs qui
   * disparaissent » se fabriquent.
   */
  const formateurs = (base.formateurs ?? [])
    .filter((formateur) => String(formateur.matricule ?? '').trim() !== '')
    .map((formateur) => ({
      matricule: String(formateur.matricule).trim(),
      nom: formateur.nomComplet,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const groupes = [...(base.groupes ?? [])].sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  );

  return {
    anneeScolaire,
    formateurs,
    groupes,
    /*
     * ═══ ⚠️ L'IDENTITÉ DE CHAQUE GROUPE — filière, niveau, année ═══
     * (2026-08-26, demande du porteur : filtrer la vue globale par filière,
     * niveau et année.)
     *
     * ⚠️ CALCULÉE ICI, PAS DANS LE NAVIGATEUR. Le niveau ne se lit ni dans le
     * nom du groupe ni dans la base : il vit dans la répartition DRIF, 13 359
     * lignes. L'envoyer au client pour qu'il en extraie sept valeurs, c'est
     * exactement ce que faisait `get_repartitions.php` — 3 Mo à chaque
     * ouverture.
     */
    groupesIdentites: await identitesDesGroupes(base, groupes),
    // Les groupes du SOIR se reconnaissent à leur nom : c'est la seule marque
    // que la base garde du renommage e-note.
    groupesSoir: groupesDuSoir(groupes),
    /*
     * ⚠️ LA SEMAINE PUBLIÉE VOYAGE AVEC LE CONTEXTE, sans route à part.
     * L'existant avait `get_published_week.php`, un aller-retour de plus à
     * chaque ouverture d'écran — pour deux champs que le contexte charge déjà.
     * Et il faut la RENDRE, pas seulement la sélectionner : c'est l'oubli de
     * présentateur qui s'est présenté sept fois dans ce projet.
     */
    publication: publicationDeLAnnee(etablissement, anneeScolaire),
    salles: [...(etablissement?.espaces ?? [])].sort((a, b) =>
      String(a).localeCompare(String(b), 'fr', { numeric: true })
    ),
    /*
     * ⚠️ LES AFFECTATIONS DOIVENT ÊTRE RENDUES, pas seulement lues. Sans elles,
     * l'écran n'a rien pour bâtir ses listes de groupes et de modules : le
     * panneau de saisie s'ouvrait avec des listes VIDES, et rien ne disait
     * pourquoi. C'est le même oubli de présentateur que pour `espaces` et pour
     * `modulesInactifs` — sélectionner un champ ne suffit pas, il faut le
     * renvoyer.
     *
     * Seules les trois colonnes utiles partent : la liste compte quelques
     * centaines de lignes, et le reste ne sert à rien ici.
     */
    affectations: (base.affectations ?? []).map((affectation) => ({
      formateur: affectation.formateur,
      groupe: affectation.groupe,
      module: affectation.module,
      /*
       * ⚠️ LE TYPE AUSSI — c'est lui qui décide de ce qu'est un « groupe ». Un
       * cours en salle réunit UNE classe ; une séance à distance est mutualisée
       * et se pose sur le libellé FUSIONNÉ. Sans ce champ, l'écran ne peut pas
       * séparer les deux listes — et le filtre les vidait toutes les deux. C'est
       * la QUATRIÈME fois qu'un champ sélectionné mais non RENDU passe
       * inaperçu, après `espaces`, `modulesInactifs` et `affectations`.
       */
      type: affectation.type,
      /*
       * ⚠️ LES TROIS COLONNES DES INDICATEURS. Le semestre et l'EFM régional se
       * lisent ici, et la masse prévue nourrit le taux d'avancement de la case.
       * Les omettre laisserait la grille sans repère : on poserait des séances
       * sans savoir si le module est déjà couvert.
       */
      s1Heures: affectation.s1Heures ?? 0,
      s2Heures: affectation.s2Heures ?? 0,
      estRegional: Boolean(affectation.estRegional),
    })),

    /*
     * ⚠️ LA COMPOSITION DES GROUPES FQ. Elle sert à l'écran EXACTEMENT comme au
     * serveur : c'est elle qui fait dire « PRIS » à un groupe constituant
     * pendant que son FQ siège. Sans elle, l'écran proposerait un groupe que le
     * serveur refuserait ensuite — deux règles pour une même question, ce que le
     * §4.2 du plan nomme la cause n°1 d'instabilité.
     */
    groupesFq: (etablissement?.groupesFq ?? []).map((lien) => ({
      groupeFq: lien.groupeFq,
      groupeConstituant: lien.groupeConstituant,
    })),

    /*
     * ═══ HEURES DÉJÀ POSÉES SUR TOUTE L'ANNÉE ═══
     * Le taux d'avancement d'un module se lit sur l'ANNÉE, jamais sur la semaine
     * affichée : rapporté à la seule semaine, il tomberait à 2 % partout et ne
     * dirait plus rien. L'existant chargeait ce décompte à part
     * (`moduleCompletion`) ; ici il vient avec le contexte, en une requête.
     */
    posees: await heuresAnnee(etablissementId, anneeScolaire),

    /*
     * ═══ DISPONIBILITÉ ET SALLES ATTRIBUÉES (2026-09-17) ═══
     * La grille signale un créneau déclaré à éviter — sans le fermer, décision
     * du porteur — et pré-remplit la salle d'une séance. Rendues ICI et pas
     * seulement lues : l'oubli de présentateur, déjà payé sept fois.
     */
    contraintesFormateurs: await listerContraintes(etablissementId, anneeScolaire),
  };
}

/**
 * Heures posées par groupe et par module, sur toute l'année.
 *
 * ⚠️ LE CALCUL PASSE PAR LE DOMAINE — `heuresPosees` — et non par un pipeline
 * Mongo : la règle du soir à 2 h, l'exclusion des séances absentes et
 * l'éclatement des libellés fusionnés y sont déjà écrites et testées. Les
 * réécrire en agrégation ferait deux définitions de la même chose.
 */
async function heuresAnnee(etablissementId, anneeScolaire) {
  /*
   * ⚠️ LA SALLE FAIT PARTIE DU DÉCOMPTE. C'est elle qui dit si la séance est à
   * distance, donc quel quota elle consomme : sans ce champ, `typeDeSeance` les
   * rangeait TOUTES en présentiel et la masse synchrone restait à zéro.
   */
  const seances = await Seance.find({ etablissementId, anneeScolaire })
    .select('groupe module seance statut salle estEfm')
    .lean();

  return Object.fromEntries(heuresPosees(seances));
}

/**
 * Écarte d'un lot les séances qui feraient dépasser une masse prévue.
 *
 * ⚠️ LE DÉCOMPTE SE FAIT AU FUR ET À MESURE, pas une fois pour toutes : dix
 * séances du même module, chacune sous le quota prise isolément, le dépassent
 * ensemble. On accepte donc dans l'ordre, en retranchant à chaque fois.
 *
 * ⚠️ LA SEMAINE VISÉE EST EXCLUE de l'état de départ : elle va être effacée par
 * l'import, ses heures ne comptent plus.
 */
async function filtrerSurQuota(etablissementId, anneeScolaire, lot, semaineEffacee) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('affectations').lean();
  const fiches = fichesModules(base?.affectations ?? []);

  const existantes = await Seance.find({
    etablissementId,
    anneeScolaire,
    semaine: { $ne: semaineEffacee },
  })
    .select('groupe module seance statut salle estEfm')
    .lean();

  const deja = heuresPosees(existantes);
  const lu = (cle, type) => deja.get(cle)?.[type] ?? 0;

  const retenues = [];
  const refusees = [];

  for (const seance of lot) {
    const type = typeDeSeance(seance);
    const cle = cleModule(seance.groupe, seance.module);
    const prevu = fiches.get(cle)?.[type] ?? 0;

    // Masse non déclarée : rien à comparer, on laisse passer.
    if (prevu <= 0) {
      retenues.push(seance);
      continue;
    }

    const apres = Math.round((lu(cle, type) + dureeSeance(seance.seance)) * 100) / 100;

    if (apres > prevu) {
      refusees.push({
        jour: seance.jour,
        seance: seance.seance,
        groupe: seance.groupe,
        module: seance.module,
        motif:
          `${seance.module} — ${seance.groupe} : ${prevu} h ${LIBELLE_TYPE[type]} prévues, ` +
          `déjà atteintes`,
      });
      continue;
    }

    const compte = deja.get(cle) ?? { [TYPES_COURS.PRESENTIEL]: 0, [TYPES_COURS.SYNCHRONE]: 0 };
    compte[type] = apres;
    deja.set(cle, compte);
    retenues.push(seance);
  }

  return { retenues, refusees };
}

/**
 * Refuse une séance qui ferait dépasser la masse horaire prévue du module.
 *
 * ⚠️ CHAQUE TYPE A SON QUOTA. Une séance en TEAMS consomme la masse SYNCHRONE,
 * une séance en salle la masse présentielle : les comparer au total permettrait
 * de doubler le présentiel tant que le synchrone reste intact.
 *
 * ⚠️ UNE MASSE À ZÉRO N'EST PAS UN QUOTA DE ZÉRO, c'est une masse NON DÉCLARÉE.
 * Bloquer dans ce cas rendrait insaisissable tout module dont la carte n'a pas
 * chiffré les heures — c'est déjà la règle d'`avancementModule`, qui rend `null`
 * plutôt que 0 %.
 *
 * ⚠️ LA SÉANCE REMPLACÉE EST EXCLUE du décompte : corriger la salle d'une séance
 * déjà posée ne consomme pas d'heures supplémentaires, et la compter deux fois
 * ferait refuser sa propre modification.
 */
async function verifierQuota(etablissementId, anneeScolaire, donnees, affectations, session = null) {
  const type = typeDeSeance(donnees);
  const fiche = fichesModules(affectations).get(cleModule(donnees.groupe, donnees.module));
  const prevu = fiche?.[type] ?? 0;
  if (prevu <= 0) return;

  const criteres = { etablissementId, anneeScolaire, module: donnees.module };
  if (donnees.id) criteres._id = { $ne: donnees.id };

  // ⚠️ DANS LA TRANSACTION de l'appelant : un rattrapage déplacé vient d'y
  // retirer l'ancienne séance, qui ne doit plus compter.
  const seances = await Seance.find(criteres)
    .select('groupe module seance statut salle estEfm')
    .session(session)
    .lean();

  const deja = heuresPosees(seances).get(cleModule(donnees.groupe, donnees.module))?.[type] ?? 0;
  const apres = Math.round((deja + dureeSeance(donnees.seance)) * 100) / 100;

  if (apres <= prevu) return;

  throw conflict('Masse horaire dépassée', {
    code: 'QUOTA_DEPASSE',
    details: [
      {
        type: 'quota',
        message:
          `${donnees.module} — ${donnees.groupe} : ${deja} h ${LIBELLE_TYPE[type]} déjà ` +
          `posées sur ${prevu} h prévues. Cette séance porterait le total à ${apres} h.`,
      },
    ],
  });
}

/*
 * ⚠️ « EN PRÉSENTIEL », pas « en salle » : c'est le mot de la carte
 * d'affectations, où les deux masses se déclarent. Le message de refus doit
 * nommer la ligne qu'on ira corriger.
 */
const LIBELLE_TYPE = {
  [TYPES_COURS.PRESENTIEL]: 'en présentiel',
  [TYPES_COURS.SYNCHRONE]: 'à distance',
};

/**
 * La fiche complète d'un module pour un groupe : son intitulé, et son
 * avancement semaine par semaine.
 * ← `updateModuleDisplay()` + le catalogue DRIF de `get_repartitions.php`
 *
 * ⚠️ CETTE ROUTE EXISTE PLUTÔT QU'UN AJOUT AU CONTEXTE. Le détail par semaine
 * pèse, pour une année pleine, quelques dizaines de milliers d'entrées —
 * 39 groupes × 20 modules × les semaines où chacun tourne — alors qu'on n'en
 * regarde qu'UNE à la fois, au survol. Le contexte est chargé à l'ouverture de
 * la page : l'y verser ferait payer à chaque visite ce qu'on consulte rarement.
 */
export async function ficheModule(etablissementId, anneeScolaire, { groupe, module }) {
  const [seances, base] = await Promise.all([
    /*
     * ⚠️ TOUTE L'ANNÉE, pas la semaine affichée. C'est le principe déjà posé
     * pour le badge de la case : un avancement rapporté à une seule semaine
     * tomberait à quelques pour cent partout et ne dirait plus rien.
     */
    Seance.find({ etablissementId, anneeScolaire, module })
      .select('groupe module seance statut semaine salle estEfm')
      .lean(),
    Base.findOne({ etablissementId, anneeScolaire })
      .select('affectations groupes groupeFilieres')
      .lean(),
  ]);

  const fiche = fichesModules(base?.affectations ?? []).get(cleModule(groupe, module));

  /*
   * ⚠️ DEUX BLOCS, PAS UN TOTAL. La carte déclare un présentiel et un synchrone
   * séparément, et chacun se mesure à SA masse : additionnés, un présentiel qui
   * déborde se cachait derrière une masse à distance encore intacte.
   */
  const parType = (type) =>
    avancementParSemaine(seances, groupe, module, fiche?.[type] ?? 0, type);

  return {
    groupe,
    module,
    intitule: await intituleModule(base, groupe, module),
    semestre: fiche?.semestre ?? null,
    estRegional: Boolean(fiche?.estRegional),
    [TYPES_COURS.PRESENTIEL]: parType(TYPES_COURS.PRESENTIEL),
    [TYPES_COURS.SYNCHRONE]: parType(TYPES_COURS.SYNCHRONE),
  };
}

/**
 * L'intitulé complet d'un module, lu dans la répartition DRIF.
 *
 * ⚠️ LA BASE NE LE PORTE PAS. `Base.affectations` ne garde que le CODE du
 * module — c'est déjà ce qui obligeait la reconstruction de la carte à croiser
 * la base avec le référentiel national. Le nom lisible ne peut donc venir que de
 * là.
 *
 * ⚠️ UN MÊME CODE VIT DANS PLUSIEURS FILIÈRES, avec des intitulés parfois
 * différents. On interroge donc d'abord la filière ET l'année du groupe, puis on
 * élargit — plutôt que de prendre la première ligne venue, qui décrirait le
 * module d'une autre formation.
 */
async function intituleModule(base, groupe, module) {
  const code = String(module ?? '').trim();
  if (code === '') return null;

  const filiere = filieresParGroupe(base).get(groupe);
  const annee = anneeDuNomGroupe(groupe);

  const criteres = [
    filiere && { codeFiliereDrif: filiere, anneeFormation: annee, codeModule: code },
    filiere && { codeFiliereDrif: filiere, codeModule: code },
    { codeModule: code },
  ].filter(Boolean);

  for (const critere of criteres) {
    const ligne = await Repartition.findOne(critere).select('module').lean();
    const intitule = String(ligne?.module ?? '').trim();
    if (intitule !== '') return intitule;
  }

  // Un module hors référentiel n'est pas une erreur : la carte permet d'en
  // saisir. On rend `null`, et l'écran affiche alors le seul code.
  return null;
}

/**
 * Les modules RÉGIONAUX d'un groupe, avec leur intitulé complet.
 * ← `get_chronogramme_data.php?groupe=`, dont l'écran EFM ne retenait que les
 *   lignes `est_regional` et leur `full_name`.
 *
 * ⚠️ L'INTITULÉ NE VIENT PAS DE LA BASE. `Base.affectations` ne garde que le
 * CODE : le nom lisible se lit dans la répartition DRIF, comme pour la carte au
 * survol d'un module. C'est pour cela qu'il ne peut pas partir avec le contexte
 * de la grille — il demande une requête par module.
 *
 * ⚠️ POURQUOI PAS DANS LE CONTEXTE : les intitulés de TOUS les modules de
 * l'établissement pèseraient à chaque ouverture de l'emploi du temps, pour une
 * information qu'on ne lit que sur cet écran-ci, un groupe à la fois.
 */
export async function modulesRegionauxDuGroupe(etablissementId, anneeScolaire, groupe) {
  const base = await Base.findOne({ etablissementId, anneeScolaire })
    .select('affectations groupes groupeFilieres')
    .lean();

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  const regionaux = modulesRegionaux(base.affectations, groupe);

  return {
    groupe,
    modules: await Promise.all(
      regionaux.map(async (fiche) => ({
        ...fiche,
        // `null` quand le module est hors référentiel — l'écran affiche alors
        // le seul code, plutôt qu'un intitulé vide qu'on prendrait pour un bug.
        intitule: await intituleModule(base, groupe, fiche.module),
      }))
    ),
  };
}

/**
 * Les semaines de l'année, avec ce qu'elles portent.
 * ← get_all_timetables.php, qui rendait la liste des valeurs de semaine.
 *
 * Sert la navigation : on voit d'un coup lesquelles sont déjà remplies, sans
 * avoir à les ouvrir une par une.
 */
export async function semaines(etablissementId, anneeScolaire) {
  const comptes = await Seance.aggregate([
    /*
     * ⚠️ `aggregate` NE CONVERTIT PAS LES TYPES, contrairement à `find`. Un
     * identifiant passé en chaîne ne correspond alors à aucun document, et le
     * pipeline rend un tableau vide — sans erreur, donc sans rien qui signale
     * que la navigation n'a plus aucune semaine à proposer.
     */
    { $match: { etablissementId: new mongoose.Types.ObjectId(etablissementId), anneeScolaire } },
    { $group: { _id: '$semaine', seances: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return comptes.map(({ _id, seances }) => ({ semaine: _id, seances }));
}

/**
 * Toutes les séances d'une semaine — jour ET soir.
 *
 * ⚠️ LES DEUX PÉRIODES DANS LA MÊME RÉPONSE. Le S5 du soir et celui du jour
 * sont deux séances distinctes que l'index unique sépare ; les demander en deux
 * requêtes ferait lire la même semaine deux fois, et laisserait les deux
 * grilles se désynchroniser le jour où l'une seule est rafraîchie.
 */

/**
 * Filière, niveau et année de chaque groupe.
 *
 * ⚠️ TROIS SOURCES, ET AUCUNE N'EST INTERCHANGEABLE :
 *   - la FILIÈRE vient de la carte (`filieresParGroupe` : la table persistée,
 *     puis les affectations, puis le rattrapage par préfixe) ;
 *   - le NIVEAU (T, TS, Q…) et le LIBELLÉ lisible viennent de la répartition
 *     DRIF, seule à les connaître ;
 *   - l'ANNÉE se lit dans le numéro du groupe — « GMOEMCM201 » → 2.
 *
 * ⚠️ UNE SEULE REQUÊTE, sur les codes DISTINCTS. Un établissement en compte huit
 * pour vingt groupes : interroger par groupe ferait vingt allers-retours pour
 * huit réponses.
 *
 * ⚠️ CE QUI RESTE INCONNU RESTE ABSENT. Un groupe dont la filière n'est pas
 * résolue ne reçoit pas de niveau inventé : il sortira des listes dès qu'une
 * facette sera cochée, ce qui se voit — au lieu d'apparaître sous un niveau
 * qui n'est pas le sien.
 */
async function identitesDesGroupes(base, groupes) {
  const filieres = filieresParGroupe(base);
  const codes = [...new Set([...filieres.values()])].filter(Boolean);

  const lignes = codes.length
    ? await Repartition.find({ codeFiliereDrif: { $in: codes } })
        .select('codeFiliereDrif niveauFormation filiere')
        .lean()
    : [];

  const parCode = new Map(
    lignes.map((ligne) => [
      ligne.codeFiliereDrif,
      { niveau: ligne.niveauFormation ?? '', libelle: ligne.filiere ?? '' },
    ])
  );

  const identites = {};
  for (const groupe of groupes) {
    const code = filieres.get(groupe) ?? '';
    const referentiel = parCode.get(code) ?? {};
    identites[groupe] = {
      filiere: code,
      filiereLibelle: referentiel.libelle ?? '',
      niveau: referentiel.niveau ?? '',
      annee: anneeDuNomGroupe(groupe),
    };
  }
  return identites;
}

export async function semaine(etablissementId, anneeScolaire, valeur) {
  const normalisee = normaliserValeurSemaine(valeur);

  if (!normalisee) {
    throw notFound(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  const [seances, etablissement, feries, national] = await Promise.all([
    Seance.find({ etablissementId, anneeScolaire, semaine: normalisee }).lean(),
    /*
     * ⚠️ `formations` AUSSI — c'est la QUATRIÈME cause d'indisponibilité, et la
     * seule que la grille ignorait encore. Le chronogramme la lit depuis le
     * 2026-08-20 ; ne pas la charger ici laissait poser des séances à un
     * formateur qui n'est pas dans l'établissement ce jour-là.
     */
    Etablissement.findById(etablissementId).select('calendrier stages formations'),
    joursFeriesEtablissement(etablissementId, anneeScolaire),
    /*
     * ⚠️ LE CALENDRIER NATIONAL : ses vacances s'appliquent par DÉFAUT, et ses
     * dates de rentrée gèlent ce qui les précède (2026-09-02). Sans cette
     * lecture, un établissement poserait des séances pendant les vacances du
     * réseau — ou avant que ses stagiaires ne soient rentrés.
     */
    calendrierNational(anneeScolaire),
  ]);

  /*
   * ⚠️ `datesDeLaSemaine` rend des objets `Date` ; le calendrier, lui, stocke des
   * chaînes « AAAA-MM-JJ ». Comparer les deux formes directement ne trouverait
   * jamais un férié — et une `Date` à minuit UTC relue au Maroc rend la veille.
   * On reste donc en chaînes, comme partout ailleurs dans le domaine.
   */
  const dates = datesDeLaSemaine(normalisee).map(enTexte);

  /*
   * L'état de chaque JOUR, pas de la semaine entière : un férié isolé ferme le
   * mardi sans rien changer au reste. La grille grise la colonne concernée —
   * sans cela on saisit un cours le jour de l'Aïd et personne ne le voit.
   */
  /*
   * ═══ ⚠️ « PAR DÉFAUT » NE VEUT PAS DIRE « IMPOSÉ » ═══
   * Les vacances nationales s'ajoutent à celles de l'établissement, qui peut en
   * ÉCARTER une par son nom — le mécanisme des jours fériés, repris tel quel.
   */
  const vacances = fusionnerVacances(
    national.vacances,
    etablissement?.calendrier?.vacances ?? [],
    etablissement?.calendrier?.vacancesEcartees ?? []
  );
  const joursFeries = feries.joursFeries ?? [];
  const absences = {
    stages: etablissement?.stages ?? [],
    formations: etablissement?.formations ?? [],
  };

  return {
    semaine: normalisee,
    anneeScolaire,
    jours: JOURS.map((jour, index) => {
      const date = dates[index];
      /*
       * ⚠️ QUI MANQUE, ET SUR QUELLE PORTÉE. Un stage ferme UN groupe, une
       * formation UNE personne : la grille verrouille la ligne concernée, jamais
       * la colonne entière — celle-ci n'appartient qu'aux vacances.
       */
      const { stages, formations } = absencesDuJour(date, absences);

      /*
       * ═══ ⚠️ LE GEL DE RENTRÉE PORTE SUR UNE ANNÉE DE FORMATION ═══
       * Ni la colonne (comme les vacances), ni une ligne de formateur : le même
       * enseignant a ses 2ᵉ années le 8 septembre et rien avec ses 1ʳᵉ. Le jour
       * rend donc les ANNÉES gelées, et l'écran ferme les seules cases dont le
       * groupe en relève.
       */
      const rentreesGelees = national.rentrees
        .filter((rentree) => avantRentree(date, rentree.anneeFormation, national.rentrees))
        .map((rentree) => ({ anneeFormation: rentree.anneeFormation, date: rentree.date }));

      return {
        jour,
        date,
        ferie: joursFeries.find((ferie) => ferie.date === date) ?? null,
        vacances: vacances.some((periode) => date >= periode.debut && date <= periode.fin),
        rentreesGelees,
        stages,
        formations,
      };
    }),
    seances: seances.map(presenter),
  };
}

/**
 * Pose ou remplace UNE séance.
 *
 * ═══ ⚠️ UNE SÉANCE, PAS LA SEMAINE ═══
 * `save_timetable.php` réécrivait le blob entier à chaque enregistrement : deux
 * personnes sur la même semaine, et l'une perdait son travail sans le savoir.
 * Ici on écrit UN document, identifié par son créneau. Deux séances différentes
 * ne se marchent plus dessus — c'est ce qui rend le verrou inutile dans le cas
 * courant (décision du porteur).
 *
 * ═══ LES CONFLITS SONT CHERCHÉS PAR REQUÊTE INDEXÉE ═══
 * L'existant parcourait le modèle CHARGÉ DANS LA PAGE : il ne voyait donc que ce
 * qui était affiché, et deux onglets ouverts sur la même semaine pouvaient poser
 * deux séances dans la même salle sans que ni l'un ni l'autre ne le sache. Le
 * serveur, lui, voit tout.
 */
/**
 * Refuse une séance posée avant la rentrée de son année de formation.
 *
 * ⚠️ SANS RÉGLAGE, RIEN N'EST REFUSÉ : `avantRentree` rend `null` quand l'année
 * n'a pas de date. Tant que l'administrateur n'a pas paramétré la rentrée,
 * l'application se comporte comme avant.
 *
 * ⚠️ UNE FUSION EST REFUSÉE DÈS QU'UN SEUL DE SES GROUPES N'EST PAS RENTRÉ : la
 * séance couvre tout le monde à la fois, et la poser priverait ceux qui sont
 * rentrés OU promettrait un cours à ceux qui ne le sont pas.
 */
async function refuserAvantRentree(anneeScolaire, semaine, donnees, precharge = null) {
  const rentrees = precharge ?? (await calendrierNational(anneeScolaire)).rentrees;
  if (rentrees.length === 0) return;

  const date = enJour(dateDuJour(semaine, donnees.jour));
  if (!date) return;

  for (const membre of separerFusion(donnees.groupe)) {
    const gel = avantRentree(date, anneeDuNomGroupe(membre), rentrees);
    if (!gel) continue;

    /*
     * ⚠️⚠️ `details` EST UNE LISTE, JAMAIS UN OBJET — signalé par le porteur le
     * 2026-09-03, capture à l'appui. L'écran de l'emploi du temps fait
     * `erreur.details?.map(...)` pour énumérer les causes d'un refus : un objet
     * y lève « details?.map is not a function » et fait TOMBER TOUTE LA PAGE,
     * là où le message aurait suffi à expliquer le refus.
     *
     * La forme est celle des conflits — un motif par entrée — parce que c'est le
     * contrat que cet écran attend depuis le début.
     */
    throw badRequest(
      `${membre} ne fait sa rentrée que le ${gel.date} : aucune séance ne peut être posée avant.`,
      {
        code: 'AVANT_RENTREE',
        details: [
          {
            message: `${membre} ne fait sa rentrée que le ${gel.date}`,
            groupe: membre,
            rentree: gel.date,
          },
        ],
      }
    );
  }
}

/**
 * Les groupes d'une date qui n'ont pas encore fait leur rentrée.
 *
 * ⚠️ SERT AUX ÉCRITURES EN LOT — import d'une semaine, planification d'un EFM —
 * là où `refuserAvantRentree` ne juge qu'une case. Vingt séances copiées d'un
 * coup ne passent par aucune saisie : sans ce contrôle, elles atterriraient
 * toutes avant la rentrée sans qu'un seul écran ne le dise.
 */
async function gelDeLaDate(rentrees, date, groupe) {
  if (rentrees.length === 0) return null;
  const jour = enJour(date);
  if (!jour) return null;

  for (const membre of separerFusion(groupe)) {
    const gel = avantRentree(jour, anneeDuNomGroupe(membre), rentrees);
    if (gel) return { groupe: membre, rentree: gel.date };
  }
  return null;
}

/**
 * @param {object} [reglages]
 * @param {import('mongoose').ClientSession} [reglages.session] la transaction de
 *   l'appelant — le placement d'un rattrapage écrit la séance, l'absence et le
 *   chronogramme d'un seul tenant.
 * @param {string|null} [reglages.rattrapageDe] l'absence que la séance rattrape.
 *   SEUL `rattrapage.service.js` le fournit : la saisie ordinaire ne peut pas
 *   fabriquer un rattrapage.
 *
 * ⚠️ `reglages`, PAS `options` : ce nom désigne déjà, plus bas, les affectations
 * du formateur (`optionsDuFormateur`).
 */
export async function poser(etablissementId, anneeScolaire, valeur, donnees, reglages = {}) {
  const { session = null, rattrapageDe = null, precharge = null } = reglages;
  const normalisee = normaliserValeurSemaine(valeur);
  if (!normalisee) {
    throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  /*
   * ⚠️ LA COMPOSITION DES GROUPES FQ EST CHARGÉE ICI, avec la base. Sans elle,
   * un cours posé sur un groupe FQ et un cours posé sur l'un de ses constituants
   * ne se voient pas — ce sont pourtant les mêmes stagiaires.
   */
  const [base, etablissement, existante] = await Promise.all([
    precharge?.base ?? Base.findOne({ etablissementId, anneeScolaire }).select('affectations').session(session),
    precharge?.etablissement ??
      Etablissement.findById(etablissementId).select('groupesFq').session(session).lean(),
    donnees.id
      ? Seance.findOne({ _id: donnees.id, etablissementId, anneeScolaire }).session(session).lean()
      : null,
  ]);

  /*
   * ═══ ⚠️ UN RATTRAPAGE NE SE FABRIQUE PAS PAR LA SAISIE ORDINAIRE ═══
   * (2026-09-14.) Le statut `rattrape` n'a de sens qu'avec son absence : c'est
   * elle qui dit quelles heures il compense, et qui porte la date inscrite au
   * chronogramme. La grille renvoie le statut qu'elle a lu — un collage, une
   * copie par glissement ou un appel direct pourraient donc en créer un sans
   * lien. On le refuse, avec un message qui dit où passer.
   *
   * ⚠️ ET UNE SÉANCE DE RATTRAPAGE NE CHANGE QUE DE SALLE ICI. La déplacer ou
   * changer son groupe la détacherait de l'absence sans reprendre les heures du
   * chronogramme ; la marquer absente ferait d'un rattrapage une nouvelle
   * absence à rattraper.
   */
  if (!rattrapageDe) {
    if (existante?.rattrapageDe) {
      const bouge =
        existante.semaine !== normalisee ||
        ['formateurMatricule', 'groupe', 'module', 'jour', 'seance', 'periode'].some(
          (champ) => String(existante[champ] ?? '') !== String(donnees[champ] ?? '')
        );
      if (bouge || donnees.statut === 'absent') {
        throw badRequest('Ce rattrapage se modifie depuis la page Absences', {
          code: 'RATTRAPAGE_VERROUILLE',
          details: [
            {
              message:
                'Seule sa salle se change ici. Pour le déplacer ou l’annuler, ouvrez le ' +
                'rattrapage depuis la page Absences.',
            },
          ],
        });
      }
    } else if (donnees.statut === 'rattrape') {
      throw badRequest('Un rattrapage se place depuis la page Absences', {
        code: 'RATTRAPAGE_HORS_ABSENCE',
        details: [
          { message: 'Un rattrapage se place depuis la page Absences, pour rester lié à son absence.' },
        ],
      });
    }
  }
  const lienRattrapage = rattrapageDe ?? existante?.rattrapageDe ?? null;

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  /*
   * ⚠️ LE FORMATEUR DOIT ÊTRE AFFECTÉ À CE GROUPE POUR CE MODULE. Sans ce
   * contrôle, une saisie pourrait poser un cours que personne n'a été affecté à
   * donner — et l'avancement compterait alors des heures que le chronogramme n'a
   * jamais prévues. L'écran ne propose que ces options ; le serveur ne s'y fie
   * pas pour autant.
   */
  const options = optionsDuFormateur(base.affectations, donnees.formateurMatricule);
  const modules = options.modulesParGroupe.get(donnees.groupe);

  if (!modules) {
    throw badRequest(
      `Ce formateur n’est pas affecté au groupe « ${donnees.groupe} » cette année`,
      { code: 'AFFECTATION_ABSENTE' }
    );
  }
  if (!modules.includes(donnees.module)) {
    throw badRequest(
      `« ${donnees.module} » n’est pas un module de ${donnees.groupe} pour ce formateur`,
      { code: 'MODULE_NON_AFFECTE' }
    );
  }

  /*
   * ═══ ⚠️ LE GEL DE RENTRÉE EST CONTRÔLÉ ICI, PAS SEULEMENT À L'ÉCRAN ═══
   * (2026-09-02.) La grille ferme les cases concernées, mais l'écran guide — il
   * ne garantit rien : un collage, un import de semaine ou un appel direct
   * passeraient outre. Une séance posée avant la rentrée d'un groupe promet un
   * cours à des stagiaires qui ne sont pas encore inscrits.
   *
   * ⚠️ L'ANNÉE DE FORMATION SE LIT DANS LE NOM DU GROUPE (`anneeDuNomGroupe`),
   * comme partout ailleurs : « DEVOWFS201 » → 2. Le domaine du calendrier ne
   * connaît pas ces règles de nommage, c'est à l'appelant de les appliquer.
   */
  await refuserAvantRentree(anneeScolaire, normalisee, donnees, precharge?.rentrees ?? null);

  /*
   * Les séances DU MÊME CRÉNEAU, et d'elles seules. Passer la semaine entière
   * ferait refuser tout ce qui se répète d'un jour à l'autre.
   */
  const surLeCreneau = await Seance.find({
    etablissementId,
    anneeScolaire,
    semaine: normalisee,
    jour: donnees.jour,
    seance: donnees.seance,
    periode: donnees.periode,
  })
    .session(session)
    .lean();

  /*
   * ═══ ⚠️ C'EST L'IDENTIFIANT QUI DIT « JE REMPLACE CELLE-CI » ═══
   *
   * Sans lui, j'avais écarté des conflits toute séance du même formateur sur le
   * créneau. C'était juste en vue par FORMATEUR — corriger une salle est un
   * remplacement — mais FAUX en vue par GROUPE : y choisir quelqu'un déjà occupé
   * ailleurs au même moment DÉPLAÇAIT sa séance en silence, et le groupe qu'il
   * quittait se retrouvait sans cours sans que rien ne le dise.
   *
   * L'écran connaît la séance affichée dans la case : il envoie son `id` quand
   * il en modifie une, et rien quand il en crée une. Un formateur déjà pris
   * redevient donc un conflit dans le second cas, qui est le bon.
   */
  const conflits = detecterConflits(
    { ...donnees, id: donnees.id },
    surLeCreneau.map(presenter),
    { groupesFq: etablissement?.groupesFq ?? [] }
  );

  if (conflits.length > 0) {
    throw conflict('Ce créneau est déjà occupé', {
      code: 'CRENEAU_OCCUPE',
      // TOUS les conflits, pas seulement le premier : un seul message enverrait
      // corriger la salle, puis découvrir le groupe — deux allers-retours.
      details: conflits.map(({ type, message }) => ({ type, message })),
    });
  }

  /*
   * ═══ ⚠️ LE QUOTA DU MODULE ═══
   * On ne pose pas plus d'heures que la carte n'en a prévu. C'est le contrôle
   * qui manquait : rien n'empêchait d'atteindre 170 % d'un module en présentiel
   * — ni à la main, ni au collage, ni à l'import — et l'écart ne se découvrait
   * qu'en fin d'année, quand il n'y a plus de semaine pour le corriger.
   */
  await verifierQuota(etablissementId, anneeScolaire, donnees, base.affectations, session);

  /*
   * On modifie la séance DÉSIGNÉE quand il y en a une — son formateur peut
   * changer, c'est le cas normal en vue par groupe. Sinon on crée.
   */
  const cible = donnees.id
    ? { _id: donnees.id, etablissementId, anneeScolaire }
    : {
        etablissementId,
        anneeScolaire,
        semaine: normalisee,
        jour: donnees.jour,
        seance: donnees.seance,
        periode: donnees.periode,
        formateurMatricule: donnees.formateurMatricule,
      };

  const seance = await Seance.findOneAndUpdate(
    cible,
    {
      $set: {
        semaine: normalisee,
        jour: donnees.jour,
        seance: donnees.seance,
        periode: donnees.periode,
        formateurMatricule: donnees.formateurMatricule,
        groupe: donnees.groupe,
        module: donnees.module,
        salle: donnees.salle ?? '',
        // Un rattrapage le reste, quel que soit le statut que l'écran renvoie.
        statut: lienRattrapage ? 'rattrape' : donnees.statut ?? 'planifie',
        rattrapageDe: lienRattrapage,
        // La date réelle du créneau, calculée à l'écriture : la recalculer à
        // chaque lecture ferait dépendre l'affichage du fuseau du navigateur.
        date: dateDuJour(normalisee, donnees.jour),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );

  /*
   * ⚠️ LE REGISTRE DES ABSENCES SUIT LA SÉANCE, à chaque écriture. C'est ce qui
   * remplace la synchro PAR DIFFÉRENCE de `save_timetable.php` : là-bas, deux
   * représentations du même fait — `salle = 'ABSENT'` dans le blob et une ligne
   * dans `absences` — devaient être tenues cohérentes à la main.
   */
  await synchroniser(seance.toObject(), { session });

  return presenter(seance.toObject());
}

/**
 * Vide une case.
 *
 * ⚠️ SUPPRESSION, pas mise à blanc. Une séance sans groupe ni module n'aurait
 * plus de sens et resterait pourtant à occuper son créneau dans l'index unique,
 * empêchant d'en poser une autre — le trou serait invisible et indéblocable.
 */
export async function vider(etablissementId, anneeScolaire, valeur, creneau) {
  const normalisee = normaliserValeurSemaine(valeur);
  if (!normalisee) {
    throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  const cible = {
    etablissementId,
    anneeScolaire,
    semaine: normalisee,
    jour: creneau.jour,
    seance: creneau.seance,
    periode: creneau.periode,
    formateurMatricule: creneau.formateurMatricule,
  };

  /*
   * ⚠️ L'ABSENCE PART AVANT LA SÉANCE. Supprimée après, elle serait orpheline —
   * et son rattrapage resterait inscrit au chronogramme pour un cours qui
   * n'existe plus. `synchroniser` reprend ces heures au passage.
   */
  await synchroniser({ ...cible, statut: 'planifie' });

  /*
   * ⚠️ UN RATTRAPAGE QU'ON VIDE REND SON ABSENCE « À RATTRAPER » (2026-09-14) :
   * sa date et ses heures au chronogramme sont reprises. Sans cela l'absence
   * paraîtrait rattrapée par un cours qui n'existe plus.
   */
  const occupante = await Seance.findOne(cible).select('rattrapageDe').lean();
  await detacherRattrapage(occupante);

  const { deletedCount } = await Seance.deleteOne(cible);

  // Vider une case déjà vide n'est pas une erreur : c'est l'état voulu.
  return { supprimee: deletedCount > 0 };
}

/**
 * Un geste entier en une requête — voir la route `POST /:semaine/lot`.
 *
 * Chaque opération passe par `poser` / `vider`, donc par TOUS leurs contrôles ;
 * ce qui change ici, c'est seulement qu'un refus ne coupe pas le lot et que le
 * client n'attend plus la latence du réseau entre deux cases.
 *
 * ⚠️ UN DÉPLACEMENT POSE D'ABORD, VIDE ENSUITE — et ne vide que si la pose a
 * réussi. L'ordre inverse perdrait la séance dès qu'un conflit refuse l'arrivée.
 *
 * ⚠️ SEULE LA SALLE CÈDE, JAMAIS LES PERSONNES (2026-09-19, demande du porteur).
 * Si le formateur ou le groupe sont pris, la séance ne peut pas atterrir ici. Si
 * TOUS les conflits rendus ne portent que sur la salle, la séance a bien sa
 * place : on la pose SANS salle plutôt que de perdre le déplacement pour un
 * détail qui se rechoisit d'un clic dans la case.
 *
 * @returns {{resultats: Array<{cle, ok, seance?, salleRetiree?, inchangee?, erreur?}>, dureeMs: number}}
 *   un résultat par opération, dans l'ordre
 */
export async function ecrireLot(etablissementId, anneeScolaire, valeur, operations) {
  const debut = Date.now();
  const resultats = [];

  /*
   * ⚠️ CE QUI NE CHANGE PAS PENDANT UN LOT SE LIT UNE FOIS. `poser` relisait, pour
   * CHAQUE case, la base entière avec ses affectations, l'établissement et le
   * calendrier national : trois allers-retours vers MongoDB par case, qui
   * n'apprenaient rien de neuf — aucune de ces trois données n'est écrite par un
   * lot. Hébergé, où chaque accès base coûte 20 à 100 ms, c'est ce qui rendait un
   * collage de trente cases si lent. Les séances, elles, se relisent à chaque
   * opération : c'est leur état qui change d'une case à l'autre.
   */
  const normalisee = normaliserValeurSemaine(valeur);
  const [base, etablissement, calendrier] = normalisee
    ? await Promise.all([
        Base.findOne({ etablissementId, anneeScolaire }).select('affectations'),
        Etablissement.findById(etablissementId).select('groupesFq').lean(),
        calendrierNational(anneeScolaire),
      ])
    : [null, null, { rentrees: [] }];
  const precharge = base ? { base, etablissement, rentrees: calendrier.rentrees } : null;

  for (const operation of operations) {
    const { cle, type } = operation;

    try {
      if (type === 'vider') {
        const { supprimee } = await vider(etablissementId, anneeScolaire, valeur, operation.creneau);
        resultats.push({ cle, ok: true, inchangee: !supprimee });
        continue;
      }

      let salleRetiree = false;
      let posee;
      try {
        posee = await poser(etablissementId, anneeScolaire, valeur, operation.seance, { precharge });
      } catch (erreur) {
        const seulementLaSalle =
          type === 'deplacer' &&
          erreur instanceof HttpError &&
          erreur.code === 'CRENEAU_OCCUPE' &&
          Array.isArray(erreur.details) &&
          erreur.details.length > 0 &&
          erreur.details.every((detail) => detail.type === 'salle');
        if (!seulementLaSalle) throw erreur;

        posee = await poser(
          etablissementId,
          anneeScolaire,
          valeur,
          { ...operation.seance, salle: '' },
          { precharge }
        );
        salleRetiree = true;
      }

      if (type === 'deplacer') {
        await vider(etablissementId, anneeScolaire, valeur, operation.source);
      }

      // La séance TELLE QUE LE SERVEUR L'A ÉCRITE : le client s'en sert pour
      // confirmer son affichage instantané (vrai identifiant, date, statut) au
      // lieu de relire toute la semaine.
      resultats.push({ cle, ok: true, seance: posee, ...(salleRetiree && { salleRetiree }) });
    } catch (erreur) {
      if (erreur instanceof HttpError) {
        resultats.push({
          cle,
          ok: false,
          erreur: {
            message: erreur.message,
            code: erreur.code,
            details: erreur.details,
            status: erreur.status,
          },
        });
        continue;
      }

      // Une erreur imprévue ne sort jamais vers le client — comme errorHandler.
      logger.error({ err: erreur, cle }, 'Erreur non gérée dans un lot de séances');
      resultats.push({
        cle,
        ok: false,
        erreur: { message: 'Une erreur interne est survenue.', status: 500 },
      });
    }
  }

  const duree = Date.now() - debut;
  if (duree > 1500) {
    logger.warn({ operations: operations.length, dureeMs: duree }, 'Lot de séances lent');
  }

  return { resultats, dureeMs: duree };
}

/**
 * La semaine à ouvrir par défaut.
 *
 * ⚠️ PAS « celle d'aujourd'hui » : la date du jour n'appartient pas forcément à
 * l'année active. Un directeur qui prépare 2026-2027 au mois d'août est encore,
 * au calendrier, dans 2025-2026 — la grille se serait ouverte sur une semaine
 * incapable de porter la moindre de ses séances, et reviendrait vide sans que
 * rien ne l'explique. La règle vit dans le domaine, portée de
 * `getInitialDateForSelectedYear()`.
 */
export const semaineCourante = (anneeScolaire, maintenant = new Date(), options = {}) =>
  semaineAOuvrir(anneeScolaire, maintenant, options);

/**
 * La semaine publiée d'une année — lue à part, pour les appelants qui n'ont pas
 * besoin de tout le contexte.
 */
export async function publicationCourante(etablissementId, anneeScolaire) {
  const etablissement = await Etablissement.findById(etablissementId)
    .select('publications')
    .lean();
  return publicationDeLAnnee(etablissement, anneeScolaire);
}

/**
 * ⚠️ `_id` DEVIENT `id`, et la période est TOUJOURS rendue. L'écran indexe ses
 * cases sur `(sujet, jour, séance, période)` : une période absente ferait
 * retomber toutes les séances du soir dans la grille de jour.
 */
function presenter(seance) {
  return {
    id: String(seance._id),
    jour: seance.jour,
    seance: seance.seance,
    periode: seance.periode ?? PERIODES.JOUR,
    date: seance.date,
    formateurMatricule: seance.formateurMatricule,
    groupe: seance.groupe,
    module: seance.module,
    salle: seance.salle ?? '',
    type: seance.type,
    statut: seance.statut,
    /*
     * ⚠️ RENDU, pas seulement stocké. C'est le champ qui dit à la grille qu'une
     * case est une SURVEILLANCE et non un cours. Le taire, c'est le piège de
     * présentateur déjà payé cinq fois — `espaces`, `modulesInactifs`,
     * `affectations`, `type`, `groupesFq`.
     */
    estEfm: Boolean(seance.estEfm),
    // L'absence rattrapée : c'est ce qui permet à la modale de reconnaître SON
    // rattrapage dans la grille, et à la saisie de ne pas le traiter en cours.
    rattrapageDe: seance.rattrapageDe ? String(seance.rattrapageDe) : null,
    observation: seance.observation ?? '',
  };
}

/** `Date` → « AAAA-MM-JJ », dans le fuseau LOCAL. */
/**
 * ⚠️ C'EST `enJour` DU DOMAINE, pas une seconde écriture. Les deux exemplaires
 * ont divergé une fois — celui des absences lisait en UTC et décalait toutes
 * les dates d'un jour. Une règle, une définition.
 */
const enTexte = (date) => enJour(date);

/**
 * Copie une AUTRE semaine dans celle-ci.
 * ← `importWeekBtn` / `showWeekDropdown()` de emploi.html
 *
 * ⚠️ ON RECALCULE LES DATES. Une séance porte la date réelle de son créneau
 * (`dateDuJour`) : la recopier telle quelle daterait toute la semaine importée
 * de la semaine d'origine, et l'avancement compterait ces heures au mauvais
 * moment.
 *
 * ⚠️ TRANSACTIONNEL. Vider la cible puis réécrire en deux temps laisserait, sur
 * un échec au milieu, une semaine à moitié effacée — pire que ce qu'on voulait
 * remplacer.
 */
export async function importerSemaine(etablissementId, anneeScolaire, valeur, { depuis }) {
  const cible = normaliserValeurSemaine(valeur);
  const source = normaliserValeurSemaine(depuis);

  if (!cible || !source) {
    throw badRequest('Semaine illisible', { code: 'SEMAINE_INVALIDE' });
  }
  if (cible === source) {
    throw badRequest('La semaine source et la semaine visée sont la même', {
      code: 'SEMAINE_IDENTIQUE',
    });
  }

  const aCopier = await Seance.find({ etablissementId, anneeScolaire, semaine: source }).lean();
  if (aCopier.length === 0) {
    throw badRequest(`La semaine ${source} ne contient aucune séance`, { code: 'SOURCE_VIDE' });
  }

  /*
   * ═══ ⚠️ LE QUOTA S'APPLIQUE AUSSI À L'IMPORT ═══
   * Copier une semaine bien remplie sur une autre est le moyen le plus rapide de
   * doubler la masse d'un module sans s'en apercevoir : ce sont vingt séances
   * d'un coup, et aucune ne passe par la saisie.
   *
   * ⚠️ ON REFUSE LES SÉANCES EN TROP, PAS L'IMPORT ENTIER. Tout rejeter pour un
   * module à saturation obligerait à recopier les dix-neuf autres à la main ;
   * les accepter en silence laisserait croire l'import complet. Ce qui n'entre
   * pas est NOMMÉ dans le bilan.
   */
  const { retenues: passeesLeQuota, refusees } = await filtrerSurQuota(
    etablissementId,
    anneeScolaire,
    aCopier,
    cible
  );

  /*
   * ═══ ⚠️ ET LE GEL DE RENTRÉE AUSSI ═══ (2026-09-03.)
   * C'est le chemin le plus dangereux : vingt séances d'un coup, dont aucune ne
   * passe par la saisie. Copier une semaine de novembre sur la S1 poserait des
   * cours à des groupes qui n'existent pas encore, et l'écran ne l'aurait dit
   * nulle part.
   *
   * ⚠️ MÊME RÈGLE QUE LE QUOTA : on ÉCARTE les séances concernées, on ne rejette
   * pas l'import entier. Une semaine mêle souvent des 1ʳᵉ et des 2ᵉ années — tout
   * refuser parce qu'une année n'est pas rentrée obligerait à recopier les
   * autres à la main.
   */
  const { rentrees } = await calendrierNational(anneeScolaire);
  const retenues = [];

  for (const seance of passeesLeQuota) {
    const gel = await gelDeLaDate(rentrees, dateDuJour(cible, seance.jour), seance.groupe);
    if (gel) {
      refusees.push({
        seance,
        motif: `${gel.groupe} ne fait sa rentrée que le ${gel.rentree}`,
      });
      continue;
    }
    retenues.push(seance);
  }

  if (retenues.length === 0) {
    throw conflict('Aucune séance de cette semaine ne peut être copiée', {
      code: 'QUOTA_DEPASSE',
      details: refusees.slice(0, 6).map((refus) => ({ type: 'quota', message: refus.motif })),
    });
  }

  const session = await mongoose.startSession();

  try {
    let remplacees = 0;

    await session.withTransaction(async () => {
      remplacees = await effacer({ etablissementId, anneeScolaire, semaine: cible }, session);

      await Seance.insertMany(
        retenues.map((seance) => ({
          etablissementId,
          anneeScolaire,
          semaine: cible,
          jour: seance.jour,
          seance: seance.seance,
          periode: seance.periode,
          date: dateDuJour(cible, seance.jour),
          formateurMatricule: seance.formateurMatricule,
          groupe: seance.groupe,
          module: seance.module,
          salle: seance.salle ?? '',
          /*
           * ⚠️ LE STATUT NE SE COPIE PAS. Une absence appartient au jour où elle
           * a eu lieu : la recopier inventerait une absence dans une semaine qui
           * n'est pas encore arrivée, avec un rattrapage à prévoir pour un cours
           * qui n'a pas manqué.
           */
          statut: 'planifie',
        })),
        { session, ordered: true }
      );
    });

    return { importees: retenues.length, remplacees, refusees, depuis: source };
  } finally {
    await session.endSession();
  }
}

/**
 * Efface une semaine, ou l'année entière.
 * ← `effacerEmploiDuTemps('semaine' | 'annee')` de emploi.html
 *
 * ⚠️ LA PORTÉE « ANNÉE » EST SANS COMMUNE MESURE avec celle d'une semaine —
 * l'existant exigeait d'ailleurs une seconde confirmation. Elle est ici bornée
 * au couple `(établissement, année)` : une bascule d'année ne doit jamais
 * emporter le travail de l'autre.
 */
export async function reinitialiser(etablissementId, anneeScolaire, { portee, semaine }) {
  const filtre = { etablissementId, anneeScolaire };

  if (portee === 'semaine') {
    const normalisee = normaliserValeurSemaine(semaine);
    if (!normalisee) throw badRequest('Semaine illisible', { code: 'SEMAINE_INVALIDE' });
    filtre.semaine = normalisee;
  }

  const session = await mongoose.startSession();

  try {
    let effacees = 0;
    await session.withTransaction(async () => {
      effacees = await effacer(filtre, session);
    });
    return { effacees, portee };
  } finally {
    await session.endSession();
  }
}

/**
 * Supprime des séances ET le registre d'absences qui les accompagne.
 *
 * ⚠️ LES ABSENCES PARTENT AVEC LEURS SÉANCES, et leurs heures de rattrapage sont
 * REPRISES au chronogramme au passage. Sans cela, effacer une semaine laisserait
 * des rattrapages inscrits pour des cours qui n'existent plus — des heures que
 * personne ne viendrait donner ni chercher.
 */
async function effacer(filtre, session) {
  const absentes = await Seance.find({ ...filtre, statut: 'absent' })
    .select('semaine jour seance formateurMatricule etablissementId')
    .session(session)
    .lean();

  for (const seance of absentes) {
    await synchroniser({ ...seance, statut: 'planifie' }, { session });
  }

  /*
   * ⚠️ ET LES RATTRAPAGES EFFACÉS RENDENT LEUR ABSENCE « À RATTRAPER »
   * (2026-09-14) — l'absence peut vivre dans une AUTRE semaine, que l'effacement
   * ne touche pas. Sans cela elle garderait une date et des heures au
   * chronogramme pour un cours qui n'existe plus.
   */
  const rattrapages = await Seance.find({ ...filtre, rattrapageDe: { $ne: null } })
    .select('rattrapageDe')
    .session(session)
    .lean();

  for (const seance of rattrapages) {
    await detacherRattrapage(seance, { session });
  }

  const { deletedCount } = await Seance.deleteMany(filtre, { session });
  return deletedCount;
}

/**
 * Planifie un EFM régional : une séance de surveillance par surveillant et par
 * créneau.
 * ← `api/profile/save_efm_regional.php`
 *
 * ═══ ⚠️ TROIS DÉFAUTS DE L'EXISTANT NE SONT PAS REPRODUITS ═══
 *   1. Il recalculait la clé de semaine avec `$mois < 9` — la variante PHP, qui
 *      diverge de la vraie règle sur les neuf derniers jours d'août (§2 du
 *      plan). Ici la semaine vient de `normaliserValeurSemaine`, comme partout.
 *   2. Il indexait le blob par NOM COURT (`getShortName`) : c'est le mécanisme
 *      même qui fabrique les « formateurs qui disparaissent » (§4.2). On écrit
 *      par MATRICULE.
 *   3. Il ÉCRASAIT ce qui occupait les créneaux, sans un mot — l'écran affichait
 *      « Occupé » et enregistrait quand même. Ici chaque séance passe par
 *      `detecterConflits`, et le refus nomme ce qui bloque.
 *
 * ⚠️ LE CONTRÔLE D'AFFECTATION NE S'APPLIQUE PAS. `poser` exige que le
 * formateur soit affecté au module ; un SURVEILLANT ne l'est justement pas —
 * c'est même la règle : le titulaire ne surveille pas son propre examen.
 */
export async function planifierEfm(etablissementId, anneeScolaire, valeur, examen) {
  const normalisee = normaliserValeurSemaine(valeur);
  if (!normalisee) {
    throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  const [base, etablissement] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('affectations'),
    Etablissement.findById(etablissementId).select('groupesFq').lean(),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  /*
   * ⚠️ LE MODULE DOIT ÊTRE RÉGIONAL POUR CE GROUPE. L'écran ne propose que
   * ceux-là ; le serveur ne s'y fie pas — un EFM régional sur un module qui ne
   * l'est pas n'existe pas, et rien ne viendrait le corriger ensuite.
   */
  const titulaires = titulairesDuModule(base.affectations, examen.groupe, examen.module);
  if (titulaires.length === 0) {
    throw badRequest(
      `« ${examen.module} » n’est pas un module régional de ${examen.groupe} cette année`,
      { code: 'MODULE_NON_REGIONAL' }
    );
  }

  /*
   * ⚠️ LE TITULAIRE NE SURVEILLE PAS SON PROPRE EXAMEN. L'écran désactive sa
   * case ; le serveur le refuse, sinon un appel direct passerait outre.
   */
  const intrus = examen.surveillants.filter((matricule) => titulaires.includes(matricule));
  if (intrus.length > 0) {
    throw badRequest('Le titulaire du module ne peut pas en surveiller l’examen', {
      code: 'TITULAIRE_SURVEILLANT',
      details: intrus.map((matricule) => ({ type: 'titulaire', message: matricule })),
    });
  }

  /*
   * ═══ ⚠️ UN EXAMEN NE SE PLANIFIE PAS AVANT LA RENTRÉE DU GROUPE ═══
   * (2026-09-03.) Cette route est un SECOND chemin d'écriture : elle ne passe
   * pas par `poser`, donc pas par son garde. Sans ce contrôle, l'écran EFM
   * restait le seul endroit d'où l'on pouvait poser des séances à un groupe qui
   * n'existe pas encore.
   *
   * ⚠️ ICI ON REFUSE TOUT L'EXAMEN, sans écarter au cas par cas : un examen est
   * un ACTE UNIQUE — une date, une salle, des surveillants. En placer la moitié
   * n'aurait aucun sens, contrairement à l'import d'une semaine.
   */
  const { rentrees } = await calendrierNational(anneeScolaire);
  const gel = await gelDeLaDate(rentrees, dateDuJour(normalisee, examen.jour), examen.groupe);
  if (gel) {
    throw badRequest(
      `${gel.groupe} ne fait sa rentrée que le ${gel.rentree} : aucun examen ne peut être placé avant.`,
      {
        code: 'AVANT_RENTREE',
        details: [
          {
            message: `${gel.groupe} ne fait sa rentrée que le ${gel.rentree}`,
            groupe: gel.groupe,
            rentree: gel.rentree,
          },
        ],
      }
    );
  }

  const aPoser = seancesDeLExamen({ ...examen, jour: examen.jour });

  /*
   * Les séances DÉJÀ posées sur les créneaux visés, en UNE requête indexée.
   * L'existant chargeait la semaine entière dans le navigateur pour la même
   * question.
   */
  const surLesCreneaux = await Seance.find({
    etablissementId,
    anneeScolaire,
    semaine: normalisee,
    jour: examen.jour,
    seance: { $in: examen.creneaux },
    periode: PERIODES.JOUR,
  }).lean();

  /*
   * ⚠️ LES SÉANCES DE L'EXAMEN SE VOIENT ENTRE ELLES. Elles partagent le groupe
   * et la salle : comparées les unes aux autres, elles se refuseraient
   * mutuellement. On ne confronte donc chaque candidate qu'à ce qui EXISTE
   * DÉJÀ — c'est bien ce qu'on veut vérifier.
   */
  const conflits = [];
  for (const candidate of aPoser) {
    const surLeCreneau = surLesCreneaux.filter((autre) => autre.seance === candidate.seance);

    for (const trouve of detecterConflits(candidate, surLeCreneau.map(presenter), {
      groupesFq: etablissement?.groupesFq ?? [],
    })) {
      conflits.push({ type: trouve.type, message: `${candidate.seance} — ${trouve.message}` });
    }
  }

  if (conflits.length > 0) {
    throw conflict('Ce créneau est déjà occupé', {
      code: 'CRENEAU_OCCUPE',
      // Tous les conflits : un seul message enverrait corriger le premier, puis
      // découvrir le second — autant d'allers-retours que de surveillants.
      details: conflits.slice(0, 8),
    });
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Seance.insertMany(
        aPoser.map((seance) => ({
          etablissementId,
          anneeScolaire,
          semaine: normalisee,
          jour: seance.jour,
          seance: seance.seance,
          periode: PERIODES.JOUR,
          date: dateDuJour(normalisee, seance.jour),
          formateurMatricule: seance.formateurMatricule,
          groupe: seance.groupe,
          module: seance.module,
          salle: seance.salle ?? '',
          estEfm: true,
        })),
        { session, ordered: true }
      );
    });

    return { posees: aPoser.length, semaine: normalisee };
  } finally {
    await session.endSession();
  }
}
