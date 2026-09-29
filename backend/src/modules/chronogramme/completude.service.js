import mongoose from 'mongoose';
import {
  NOMBRE_SEMAINES,
  cleSemaineChronogramme,
  completudeSemaine,
  analyserSemaine,
  reporterVersChronogramme,
  fichesModules,
} from 'shared/domain';

import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Base } from '../../models/Base.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Seance } from '../../models/Seance.js';
import { notFound } from '../../lib/httpError.js';
import { nomsDeLaCarte } from '../base/cascadeGroupes.js';

/**
 * Complétude de l'emploi du temps face au chronogramme (F7).
 * ← `api/data/get_completude.php`
 *
 * ═══ ⚠️ CE SERVICE NE FAIT QUE LIRE ═══
 * Rien n'est écrit, et c'est délibéré : réaligner automatiquement le
 * chronogramme sur la grille annulerait l'écart, or c'est précisément cet écart
 * que toute la section Avancement mesure.
 *
 * ═══ ⚠️ UN SEUL CHEMIN DE CALCUL POUR LES DEUX MODES ═══
 * La semaine détaillée et le taux de chaque semaine de l'année passent par la
 * MÊME fonction de domaine. Écrire un calcul « résumé » à côté du calcul
 * détaillé produirait deux taux pour une même semaine — le calendrier et la
 * fenêtre se contrediraient, et personne ne saurait lequel croire.
 */

/**
 * Ce que les deux modes lisent en commun.
 *
 * ⚠️ LU UNE FOIS POUR TOUTES LES SEMAINES. En mode année, refaire ces lectures
 *    par semaine, c'est 45 fois la même requête — et la latence vers Atlas,
 *    mesurée à 47 ms, y pèse plus que le calcul lui-même.
 */
async function chargerCommun(etablissementId, anneeScolaire) {
  const [base, chronogrammes] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire })
      .select('groupes affectations formateurs')
      .lean(),
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  /*
   * ⚠️ LA MÊME DÉFINITION QUE LA CASCADE, pas une seconde. « Les groupes de la
   *    carte » se lisent sur `base.groupes` ET sur les affectations : un groupe
   *    déclaré sans module attribué n'apparaît dans aucune affectation, et le
   *    compter absent le ferait passer pour un chronogramme fantôme. C'est le
   *    défaut (k) du 2026-09-22, corrigé dans le générateur — il ne doit pas
   *    renaître ici.
   */
  const groupesConnus = nomsDeLaCarte(base);

  /* matricule → nom, pour nommer le porteur d'une séance en trop. */
  const nomsFormateurs = new Map(
    (base.formateurs ?? [])
      .filter((f) => String(f?.matricule ?? '').trim() !== '')
      .map((f) => [String(f.matricule).trim(), f.nomComplet])
  );

  /*
   * `GROUPE||MODULE||type` → nom du formateur affecté, pour nommer qui devra
   * donner une séance manquante.
   *
   * ⚠️ `affectation.formateur` N'EST PAS UN NOM : c'est l'identifiant stable
   *    produit par `identifiant()` — le matricule quand il existe. Le poser tel
   *    quel afficherait « 18448 » à l'écran.
   */
  const formateurParModule = new Map();
  for (const affectation of base.affectations ?? []) {
    const identifiant = String(affectation?.formateur ?? '').trim();
    if (identifiant === '') continue;
    const cle = `${String(affectation.groupe).trim().toUpperCase()}||${String(
      affectation.module
    )
      .trim()
      .toUpperCase()}||${affectation.type}`;
    formateurParModule.set(cle, nomsFormateurs.get(identifiant) ?? identifiant);
  }

  return { chronogrammes, groupesConnus, formateurParModule, nomsFormateurs };
}

/** Les séances d'une semaine, réduites à ce que le calcul consomme. */
const champsUtiles = 'groupe module jour seance salle statut formateurMatricule periode';

/**
 * Bilan détaillé d'UNE semaine : écarts module par module.
 *
 * @returns {{semaine: string, numero: number, anneeScolaire: number, total, groupes, ecarts, inconnus}}
 */
export async function completudeDUneSemaine(etablissementId, anneeScolaire, valeurSemaine) {
  const analyse = analyserSemaine(valeurSemaine);
  if (!analyse) {
    throw notFound('Semaine illisible', { code: 'SEMAINE_INVALIDE' });
  }

  const commun = await chargerCommun(etablissementId, anneeScolaire);

  /*
   * ⚠️ LA SEMAINE EST NORMALISÉE. La production contient « 2026-W039 » à côté
   *    de « 2026-W39 » : sans cela, la grille serait cherchée sous une clé que
   *    personne n'a écrite, et la semaine paraîtrait vide.
   */
  const normalisee = `${analyse.anneeScolaire}-W${analyse.numero}`;
  const seances = await Seance.find({ etablissementId, anneeScolaire, semaine: normalisee })
    .select(champsUtiles)
    .lean();

  const bilan = completudeSemaine({
    ...commun,
    seances,
    semaineChrono: cleSemaineChronogramme(analyse.numero),
  });

  /*
   * ⚠️ `planifie` VOYAGE AVEC LE BILAN. Sans chronogramme, il n'y a rien à quoi
   *    comparer et le taux ne veut rien dire : l'écran doit pouvoir CACHER son
   *    indicateur plutôt que d'afficher « 0 % » à un établissement qui n'a
   *    simplement rien planifié. Le demander à part serait un second appel, et
   *    l'écran afficherait un instant un taux qu'il devrait taire.
   */
  const planifie = commun.chronogrammes.some((chrono) => {
    const planning = chrono?.planning;
    const semaines = planning instanceof Map ? planning.values() : Object.values(planning ?? {});
    for (const cellules of semaines) {
      for (const cellule of cellules ?? []) {
        if ((Number(cellule?.heures) || 0) > 0) return true;
      }
    }
    return false;
  });

  return { semaine: normalisee, numero: analyse.numero, anneeScolaire, planifie, ...bilan };
}

/**
 * Un taux par semaine, pour le calendrier.
 *
 * ⚠️ TOUTES LES SÉANCES DE L'ANNÉE EN UNE REQUÊTE, puis un regroupement en
 *    mémoire : 45 requêtes indexées coûteraient 45 allers-retours là où le
 *    regroupement d'un millier de documents est immédiat.
 */
export async function completudeDeLAnnee(etablissementId, anneeScolaire) {
  const commun = await chargerCommun(etablissementId, anneeScolaire);

  const toutes = await Seance.find({ etablissementId, anneeScolaire })
    .select(`${champsUtiles} semaine`)
    .lean();

  const parSemaine = new Map();
  for (const seance of toutes) {
    const analyse = analyserSemaine(seance.semaine);
    if (!analyse) continue;
    if (!parSemaine.has(analyse.numero)) parSemaine.set(analyse.numero, []);
    parSemaine.get(analyse.numero).push(seance);
  }

  const semaines = [];
  for (let numero = 1; numero <= NOMBRE_SEMAINES; numero += 1) {
    const bilan = completudeSemaine({
      ...commun,
      seances: parSemaine.get(numero) ?? [],
      semaineChrono: cleSemaineChronogramme(numero),
    });

    /*
     * ⚠️ UNE SEMAINE SANS RIEN — ni prévu, ni posé — EST OMISE. La rendre avec
     *    `taux: null` ferait afficher 45 pastilles grises au calendrier, dont
     *    l'immense majorité pour des semaines que personne n'a planifiées : le
     *    signal utile se perdrait dans le bruit.
     */
    if (bilan.total.prevu === 0 && bilan.total.pose === 0) continue;

    semaines.push({
      semaine: `${anneeScolaire}-W${numero}`,
      numero,
      taux: bilan.total.taux,
      prevu: bilan.total.prevu,
      pose: bilan.total.pose,
      manquant: bilan.total.manquant,
      enTrop: bilan.total.enTrop,
      ecarts: bilan.ecarts.length,
      seancesGrille: bilan.total.seancesGrille,
    });
  }

  return { anneeScolaire, semaines };
}

/**
 * L'emploi du temps est-il lié au chronogramme, et celui-ci est-il planifié ?
 * ← `api/profile/get_chrono_status.php`
 *
 * ═══ ⚠️ LES DEUX DANS LA MÊME RÉPONSE ═══
 * `planifie` dit qu'un chronogramme existe, `liee` que l'établissement veut
 * bien en dépendre — deux choses distinctes, et le verrou ne s'applique que si
 * les deux sont vraies. Deux appels séparés laisseraient l'écran afficher un
 * instant un verrou déjà levé, ou l'inverse.
 *
 * ⚠️ « ENREGISTRÉ » N'EST PAS « PLANIFIÉ ». Une ligne de chronogramme peut
 *    exister avec un planning VIDE — c'est le cas après une réinitialisation.
 *    On compte donc les CELLULES, jamais les lignes.
 */
export async function etatLiaison(etablissementId, anneeScolaire) {
  const [config, chronogrammes] = await Promise.all([
    AutoGenConfig.findOne({ etablissementId, anneeScolaire }).select('chronogrammeLie').lean(),
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
  ]);

  let groupes = 0;
  let cellules = 0;

  for (const chrono of chronogrammes) {
    const planning = chrono?.planning;
    const entrees = planning instanceof Map ? planning.values() : Object.values(planning ?? {});

    let duGroupe = 0;
    for (const semaines of entrees) {
      for (const cellule of semaines ?? []) {
        if ((Number(cellule?.heures) || 0) > 0) duGroupe += 1;
      }
    }

    if (duGroupe > 0) {
      groupes += 1;
      cellules += duGroupe;
    }
  }

  return {
    /*
     * ⚠️ `?? true` : un `AutoGenConfig` absent — le cas de tout établissement
     *    qui n'a jamais ouvert la génération — vaut LIÉ. Mongoose n'applique
     *    pas un défaut de schéma à un document qui n'existe pas.
     */
    liee: config?.chronogrammeLie ?? true,
    planifie: groupes > 0,
    groupes,
    cellules,
    /* Le verrou ne mord que si les deux sont vraies. Calculé ICI, pour que
       l'écran et le serveur n'en donnent jamais deux lectures. */
    verrouActif: (config?.chronogrammeLie ?? true) && groupes > 0,
  };
}

/**
 * Associe ou dissocie l'emploi du temps et le chronogramme.
 * ← `api/profile/set_liaison_chronogramme.php`
 *
 * ⚠️ `liee` DOIT ARRIVER EXPLICITEMENT — la route le garantit, sans valeur par
 *    défaut. Un défaut ferait basculer l'établissement dans un état qu'il n'a
 *    pas demandé sur une requête malformée, et dissocier lève le verrou pour
 *    tout le monde, directeur comme gestionnaire.
 *
 * ⚠️ IDEMPOTENT : `upsert` sur la clé unique (établissement, année). Renvoyer
 *    le même état ne crée pas un second document.
 */
export async function definirLiaison(etablissementId, anneeScolaire, liee) {
  await AutoGenConfig.updateOne(
    { etablissementId, anneeScolaire },
    { $set: { chronogrammeLie: Boolean(liee) } },
    { upsert: true }
  );

  return etatLiaison(etablissementId, anneeScolaire);
}

/**
 * Reporte dans le chronogramme les séances déjà posées.
 * ← `api/profile/reporter_emploi_vers_chronogramme.php`
 *
 * ⚠️ `simulation` PARCOURT LE MÊME CODE. Deux chemins — un pour compter, un
 *    pour écrire — auraient fini par annoncer autre chose que ce qu'ils font,
 *    et la confirmation aurait porté sur un chiffre faux.
 *
 * ⚠️ DANS UNE TRANSACTION : le report touche plusieurs groupes, et un échec au
 *    milieu laisserait un chronogramme à moitié aligné — pire que pas aligné
 *    du tout, parce qu'invisible.
 */
export async function reporter(etablissementId, anneeScolaire, { simulation = true } = {}) {
  const [seances, chronogrammes, base] = await Promise.all([
    Seance.find({ etablissementId, anneeScolaire })
      .select('semaine groupe module seance salle statut')
      .lean(),
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
    Base.findOne({ etablissementId, anneeScolaire }).select('affectations').lean(),
  ]);

  /*
   * ⚠️ LA MASSE DE LA CARTE, par `fichesModules` — la même définition que le
   *    quota de `poser()` : le report ne peut pas inscrire au chronogramme plus
   *    que la carte n'accorde (2026-09-27, demande du porteur).
   */
  const { aEcrire, bilan } = reporterVersChronogramme({
    seances,
    chronogrammes,
    masses: fichesModules(base?.affectations ?? []),
  });

  if (simulation || aEcrire.length === 0) {
    return { simulation: true, ...bilan };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const { groupe, planning } of aEcrire) {
        await Chronogramme.updateOne(
          { etablissementId, anneeScolaire, groupe },
          {
            $set: { planning: Object.fromEntries(planning) },
            /*
             * ⚠️ LA VERSION S'AVANCE, comme pour tout écrivain du planning
             *    (import de classeur, report de rattrapage). Sans cela, l'écran
             *    d'un collègue croirait tenir la dernière version et écraserait
             *    ce report sans le savoir.
             */
            $inc: { version: 1 },
          },
          { upsert: true, session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return { simulation: false, ...bilan };
}
