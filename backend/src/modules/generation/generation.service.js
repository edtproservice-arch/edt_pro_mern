/**
 * Génération automatique — orchestration.
 *
 * ← `runAutoGeneration` / `processSingleWeekGeneration` de emploi.html.
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'ANCIEN, ET POURQUOI C'EST L'ESSENTIEL ═══
 *
 * L'ancien générait DANS LE NAVIGATEUR : pour chaque semaine, un `fetch` pour
 * lire le chronogramme, un autre pour enregistrer, et `await sleep(100)` entre
 * deux tours. Sur 45 semaines : 90 allers-retours et 4,5 secondes de pause pure.
 * C'était ça, la lenteur — mesuré, le placement lui-même ne pèse qu'une seconde
 * pour l'année entière.
 *
 * Ici tout est lu UNE fois, résolu côté serveur, écrit en transaction.
 *
 * ⚠️ ET CHAQUE PLACEMENT REPASSE PAR `poser()`. Le solveur propose ; c'est le
 *    serveur qui décide. Conflits, quota de module, gel de rentrée,
 *    verrouillage des rattrapages : une séance générée franchit exactement les
 *    mêmes contrôles qu'une séance saisie à la main. Écrire en `insertMany`
 *    serait plus rapide — et rouvrirait, pour le seul chemin automatique, tous
 *    les trous que ces contrôles ferment.
 */

import mongoose from 'mongoose';

import { MOTEURS, PERIODES } from 'shared/constants';
import { analyserSemaine, normaliserValeurSemaine } from 'shared/domain';

import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { Seance } from '../../models/Seance.js';
import { badRequest, conflict } from '../../lib/httpError.js';
import { AutoGenConfig as ConfigLiaison } from '../../models/AutoGenConfig.js';
import { poser, semaine as lireSemaine } from '../seances/seances.service.js';
import { aPreserver, chargerCommun, estDuJour, previsualiser, tachesPour } from './donnees.js';
import { memoPose } from './memoPose.js';
import { occupationAilleurs } from './occupationAilleurs.js';
import { construireProbleme, joursFermes, joursOuverts } from './probleme.js';
import { optionsSolveur, resoudre } from './solveur.client.js';
import { balayer, enregistrer, sansFaireEchouer } from './traces.service.js';

function numeroDe(valeur) {
  const analyse = analyserSemaine(normaliserValeurSemaine(valeur));
  if (!analyse) throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });
  return analyse.numero;
}

/**
 * Génère UNE semaine : construit, résout, revalide, écrit.
 *
 * ⚠️ TOUT OU RIEN. Les séances anciennes sont effacées et les nouvelles posées
 *    dans la MÊME transaction : un échec au milieu laisserait sinon la semaine à
 *    moitié vide — un état bien pire que celui qu'on voulait remplacer, et que
 *    personne n'aurait demandé.
 */
async function genererSemaine(etablissementId, anneeScolaire, valeur, commun, options) {
  const normalisee = normaliserValeurSemaine(valeur);
  const numero = numeroDe(valeur);

  const etatSemaine = await lireSemaine(etablissementId, anneeScolaire, normalisee);

  const { taches, ignorees } = tachesPour(commun, numero);

  if (taches.length === 0) {
    /*
     * ⚠️ UNE SEMAINE VIDE N'EST PAS UNE ERREUR. Le chronogramme ne prévoit rien
     *    — vacances, fin d'année, semaine d'examens. L'ancien levait une
     *    exception (« Semaine vide (ignorée) ») que l'appelant devait attraper
     *    par son MESSAGE. On la rapporte comme un état.
     */
    return {
      semaine: normalisee,
      vide: true,
      placees: 0,
      remplacees: 0,
      preservees: 0,
      nonPlacees: [],
      ignorees,
      joursFermes: joursFermes(etatSemaine),
    };
  }

  if (joursOuverts(etatSemaine).length === 0) {
    /*
     * ═══ ⚠️ LA SEMAINE EST FERMÉE, ET ÇA SE DIT EN FRANÇAIS ═══ (2026-09-22)
     * Ce garde manquait : seul `taches.length === 0` était testé. Une semaine
     * entièrement fériée ou en vacances dont le chronogramme réclame quand
     * même des cours arrivait donc au solveur SANS AUCUN CRÉNEAU, et le
     * directeur lisait « creneaux : au moins un créneau est attendu » — un
     * message de Python, sur un écran de gestion.
     *
     * ⚠️ MESURÉ SUR L'ANNÉE RÉELLE : la **S21 réclame 154 séances pour 0
     *    créneau**. Ce n'est pas un cas d'école, c'est la plus grosse perte de
     *    l'année — et elle se corrige dans le calendrier ou le chronogramme,
     *    pas dans le générateur.
     *
     * ⚠️ CE N'EST PAS UNE ERREUR, C'EST UN ÉTAT, comme `vide`. Lever une
     *    exception ferait compter la semaine dans les `echecs` et, sur une
     *    génération d'année, noierait le vrai message parmi des pannes.
     */
    return {
      semaine: normalisee,
      fermee: true,
      placees: 0,
      remplacees: 0,
      preservees: 0,
      nonPlacees: [],
      ignorees,
      /** Ce que le chronogramme réclamait malgré tout — c'est le chiffre qui alerte. */
      demandees: taches.reduce((total, tache) => total + tache.seancesRequises, 0),
      joursFermes: joursFermes(etatSemaine),
    };
  }

  const existantes = (etatSemaine.seances ?? []).filter(estDuJour);
  const preservees = existantes.filter(aPreserver);

  const { probleme, index, creneauVersCase } = construireProbleme({
    semaine: etatSemaine,
    taches,
    salles: commun.etablissement?.espaces ?? [],
    groupesFq: commun.etablissement?.groupesFq ?? [],
    contraintes: commun.contraintes,
    formateurs: commun.formateurs,
    graine: options.graine,
    assouplissement: options.assouplissement ?? {},
    aPreserver: preservees,
  });

  /*
   * ═══ ⚠️ LES COURS DES FORMATEURS DANS LEURS AUTRES ÉTABLISSEMENTS ═══
   * (2026-09-27, constaté sur données réelles) Le problème ne portait que les
   * séances de CET établissement : un formateur mutualisé paraissait libre là
   * où il a cours ailleurs, le solveur y posait sa séance, et `poser()` la
   * refusait — perdue dans `refusees` alors que d'autres créneaux étaient
   * libres. Le solveur les reçoit désormais comme occupées (formateur seul :
   * ni groupe ni salle de CET établissement).
   */
  probleme.occupation.push(
    ...(await occupationAilleurs(commun, anneeScolaire, normalisee, taches, creneauVersCase))
  );

  const solution = await resoudre(probleme, optionsSolveur(options.moteur));

  // --- Écriture ----------------------------------------------------------
  const session = await mongoose.startSession();
  const refusees = [];
  let placees = 0;
  let remplacees = 0;
  /*
   * ═══ ⚠️ CE QUE LA SOUPLESSE A COÛTÉ, SÉANCE PAR SÉANCE ═══ (2026-09-22)
   * Depuis que les créneaux « à éviter » sont des consignes et non des
   * interdictions, le solveur s'y résout plutôt que de laisser une séance non
   * placée. Mesuré sur l'année réelle : **164 séances** dans ce cas, pour en
   * récupérer 143.
   *
   * ⚠️ **ON COMPTE CE QUI EST ÉCRIT, PAS CE QUI EST PROPOSÉ** : l'incrément
   *    est APRÈS `poser()`. Une séance refusée à l'écriture n'a coûté son
   *    créneau à personne, et la compter ferait annoncer au formateur une
   *    gêne qu'il ne subira jamais.
   */
  let deconseillees = 0;

  /**
   * Séances posées AILLEURS que dans la salle déclarée pour leur module.
   *
   * ═══ ⚠️ NODE LE CALCULE, PAS PYTHON ═══ (2026-09-23)
   * C'est la frontière du 2026-09-20 : Python résout, Node décide. Python
   * évite ces salles — il a `sallesPreferees` pour cela — mais c'est ici qu'on
   * sait ce qu'est « la salle d'un module », parce que c'est ici qu'on a lu la
   * carte. Faire remonter le compte par le solveur ajouterait une deuxième
   * définition de la même règle, exactement le défaut que la migration corrige.
   *
   * ⚠️ **ON COMPTE CE QUI EST ÉCRIT, PAS CE QUI EST PROPOSÉ** : l'incrément est
   *    APRÈS `poser()`, comme `deconseillees` juste au-dessus.
   */
  let horsSalle = 0;

  try {
    await session.withTransaction(async () => {
      refusees.length = 0;
      placees = 0;
      // ⚠️ REMIS À ZÉRO COMME `placees` : une transaction rejouée doublerait
      //    sinon le compte, et le rapport annoncerait deux fois la gêne.
      deconseillees = 0;
      // ⚠️ REMIS À ZÉRO POUR LA MÊME RAISON : une transaction rejouée
      //    doublerait le compte.
      horsSalle = 0;

      /*
       * ⚠️ ON N'EFFACE QUE CE QU'ON REMPLACE. Les EFM et les rattrapages
       *    restent ; ils occupent d'ailleurs déjà des créneaux dans le problème,
       *    le solveur a construit sa grille autour d'eux.
       */
      const suppression = await Seance.deleteMany(
        {
          etablissementId,
          anneeScolaire,
          semaine: normalisee,
          periode: PERIODES.JOUR,
          estEfm: { $ne: true },
          rattrapageDe: null,
        },
        { session }
      );
      remplacees = suppression.deletedCount ?? 0;

      /*
       * La précharge évite de relire base, établissement et rentrées pour
       * CHACUN des ~157 placements — trois allers-retours par séance qui
       * n'apprendraient rien de neuf : aucune de ces données n'est écrite ici.
       *
       * ⚠️ ELLE PORTE AUSSI, DEPUIS LE 2026-09-22, LES SALLES PARTAGÉES ET LES
       *    FORMATEURS MUTUALISÉS. `poser()` offrait ces deux crochets depuis
       *    toujours ; personne ne les remplissait, et chaque séance relançait
       *    jusqu'à quatre requêtes de plus. Mesuré : **331 ms par séance, 59,9 s
       *    pour une semaine de 181 placements** — contre 460 ms pour toute la
       *    résolution Python.
       *
       * ⚠️ VENUE DE `chargerCommun`, donc partagée par les 45 semaines d'une
       *    génération d'année : une seule lecture des pièces pour toute l'année.
       */
      /*
       * ═══ ⚠️ LE MÉMO EST CONSTRUIT ICI, ET C'EST DÉLIBÉRÉ ═══ (2026-09-22)
       * APRÈS le `deleteMany` et DANS la transaction. Deux conséquences, toutes
       * deux voulues :
       *  · il voit la semaine déjà vidée, **EFM et rattrapages préservés
       *    compris** — et ceux-là consomment du quota. C'est le piège de
       *    `filtrerSurQuota`, qui écarte la semaine visée EN ENTIER et
       *    sous-compterait les heures conservées ;
       *  · si cette transaction échoue, le mémo meurt avec elle. Partagé entre
       *    semaines, il garderait des séances annulées et ferait refuser, la
       *    semaine suivante, des poses parfaitement valides.
       *
       * ⚠️ UNE lecture remplace 362 requêtes (181 quotas + 181 créneaux).
       */
      const precharge = {
        ...commun.prechargePoser,
        ...(await memoPose(Seance, etablissementId, anneeScolaire, session, AbsenceFormateur)),
      };

      for (const placement of solution.placements) {
        const tache = index.get(placement.tacheId);
        const creneau = creneauVersCase.get(placement.creneauId);
        if (!tache || !creneau) continue;

        try {
          await poser(
            etablissementId,
            anneeScolaire,
            normalisee,
            {
              jour: creneau.jour,
              seance: creneau.seance,
              periode: creneau.periode,
              formateurMatricule: tache.formateurMatricule,
              groupe: tache.groupeLibelle,
              module: tache.module,
              salle: placement.salle,
              statut: 'planifie',
            },
            /*
             * ⚠️ `verrou: false` — LA GÉNÉRATION EST LE PRODUCTEUR LÉGITIME.
             *    C'est elle qui traduit le chronogramme en grille : la lui
             *    interdire au nom du chronogramme serait exactement l'inverse
             *    de ce que le verrou protège. Tout autre appelant de `poser()`
             *    le subit, par défaut.
             */
            { session, precharge, verrou: false }
          );
          placees += 1;
          if (placement.deconseille) deconseillees += 1;
          /*
           * ⚠️ `sallesModule` VIDE VEUT DIRE « AUCUNE CONSIGNE », pas « aucune
           *    salle » : sans déclaration dans la carte — le cas de toutes les
           *    cartes existantes — rien n'est jamais compté hors salle.
           */
          if (tache.sallesModule?.length && !tache.sallesModule.includes(placement.salle)) {
            horsSalle += 1;
          }
        } catch (erreur) {
          /*
           * ═══ ⚠️ UN REFUS N'ANNULE PAS LA GÉNÉRATION, IL EST RAPPORTÉ ═══
           * Le solveur ignore le quota de module : il place ce que le
           * chronogramme demande. Si la carte a été réduite depuis, `poser()`
           * refuse à juste titre — et refuser la semaine ENTIÈRE pour une
           * séance en trop ferait perdre les 156 autres.
           *
           * ⚠️ Ces refus sont aussi le signal le plus utile du pont : ils
           *    disent exactement où le problème construit ici diverge de ce que
           *    le serveur accepte.
           */
          refusees.push({
            tacheId: placement.tacheId,
            groupe: tache.groupeLibelle,
            module: tache.module,
            jour: creneau.jour,
            seance: creneau.seance,
            code: erreur.code ?? 'REFUS',
            message: erreur.message,
          });
        }
      }
    });
  } finally {
    await session.endSession();
  }

  /*
   * ═══ LA TRACE, HORS TRANSACTION ET SANS POUVOIR LA FAIRE ÉCHOUER (F6 · d) ═══
   * Dans la transaction, elle l'alourdirait et ferait annuler une génération
   * parfaitement valide le jour où son écriture échoue. Une trace perdue coûte
   * une ligne de corpus ; une semaine annulée coûte une semaine de travail.
   */
  await sansFaireEchouer(
    enregistrer({
      etablissementId,
      anneeScolaire,
      semaine: normalisee,
      lanceePar: options.lanceePar ?? null,
      graine: options.graine ?? null,
      assouplissement: options.assouplissement ?? {},
      /*
       * ⚠️ COMBIEN DE COMPOSITIONS FQ ÉTAIENT DÉCLARÉES (constat du
       *    2026-09-21 : les seuls groupes FQ que la génération rencontrait
       *    n'en avaient aucune). Sans ce compte, on entraînerait un modèle sur
       *    des grilles qui ignorent une contrainte réelle, sans jamais pouvoir
       *    les écarter du corpus.
       */
      compositionsFq: (commun.etablissement?.groupesFq ?? []).length,
      probleme,
      taches,
      solution,
      resultat: {
        placees,
        deconseillees,
        horsSalle,
        remplacees,
        preservees: preservees.length,
        refusees,
        ignorees: ignorees.length,
        nonPlacees: solution.nonPlacees?.length ?? 0,
      },
    }),
    { semaine: normalisee, etablissementId }
  );

  return {
    semaine: normalisee,
    vide: false,
    placees,
    deconseillees,
    horsSalle,
    remplacees,
    preservees: preservees.length,
    demandees: taches.reduce((total, tache) => total + tache.seancesRequises, 0),
    nonPlacees: solution.nonPlacees.map((non) => ({
      ...non,
      groupe: index.get(non.tacheId)?.groupeLibelle ?? '',
      module: index.get(non.tacheId)?.module ?? '',
      formateur: index.get(non.tacheId)?.formateurMatricule ?? '',
    })),
    refusees,
    ignorees,
    joursFermes: joursFermes(etatSemaine),
    rapport: solution.rapport,
  };
}

/**
 * Refuse d'écrire la grille depuis le chronogramme quand les deux sont dissociés.
 *
 * ⚠️ PARTAGÉ par la génération et par le placement des séances manquantes
 *    (`completer.service.js`) : tous deux traduisent le chronogramme en grille,
 *    et dissocié, le chronogramme ne fait plus foi — une seule définition, pour
 *    que l'un ne se remette pas à écrire quand l'autre s'y refuse.
 */
export async function exigerChronogrammeLie(etablissementId, anneeScolaire) {
  const liaison = await ConfigLiaison.findOne({ etablissementId, anneeScolaire })
    .select('chronogrammeLie')
    .lean();

  if ((liaison?.chronogrammeLie ?? true) === false) {
    throw conflict(
      'Emploi du temps dissocié du chronogramme : la génération automatique est coupée.',
      {
        code: 'CHRONOGRAMME_DISSOCIE',
        details: [
          {
            type: 'liaison',
            message:
              'Réassociez l’emploi du temps au chronogramme pour la relancer. ' +
              'La réassociation reporte d’abord les séances déjà posées.',
          },
        ],
      }
    );
  }
}

/**
 * Génère plusieurs semaines.
 *
 * @param {(etape: object) => void} [onProgres] — appelé après chaque semaine,
 *   pour que la route puisse diffuser l'avancement (SSE).
 */
export async function generer(
  etablissementId,
  anneeScolaire,
  { semaines, graine = null, assouplissement = {}, moteur = MOTEURS.GLOUTON },
  { onProgres, lanceePar = null } = {}
) {
  const valeurs = [...new Set(semaines.map((valeur) => normaliserValeurSemaine(valeur)))].filter(
    Boolean
  );

  if (valeurs.length === 0) {
    throw badRequest('Aucune semaine valide à générer', { code: 'SEMAINES_ABSENTES' });
  }

  /*
   * ═══ ⚠️ DISSOCIÉ, LA GÉNÉRATION EST COUPÉE ═══ (2026-09-27, signalé par le
   * porteur — la règle existait dans l'ancien et manquait à mon portage)
   *
   * Dissocier, c'est déclarer que la grille est tenue à la main. La génération
   * n'a alors plus de source qui fasse foi : **elle écraserait la saisie
   * manuelle sans que rien ne le signale** — et c'est justement cette saisie
   * que la dissociation existait pour protéger.
   *
   * ⚠️ AU SERVEUR, PAS SEULEMENT SUR LE BOUTON. L'ancien grisait le bouton et
   *    s'arrêtait là ; un onglet ouvert avant la dissociation, ou une requête
   *    directe, régénérait quand même — en effaçant le travail.
   *
   * ⚠️ L'ABSENCE DE DOCUMENT VAUT « LIÉ » : un établissement qui n'a jamais
   *    ouvert la génération doit pouvoir la lancer.
   */
  await exigerChronogrammeLie(etablissementId, anneeScolaire);

  const commun = await chargerCommun(etablissementId, anneeScolaire);

  /*
   * ⚠️ LA GRAINE EST ENREGISTRÉE, PAS SEULEMENT UTILISÉE. C'est ce qui rend une
   *    génération rejouable : un directeur qui signale un placement étrange peut
   *    être reproduit à l'identique. L'ancien tirait `Math.random()` et ne
   *    gardait rien — deux exécutions donnaient deux grilles incomparables.
   */
  const graineRetenue =
    graine ?? commun.graineEnregistree ?? Math.floor(Math.random() * 2 ** 31);

  await AutoGenConfig.updateOne(
    { etablissementId, anneeScolaire },
    { $set: { graine: graineRetenue } },
    { upsert: true }
  );

  const resultats = [];

  for (const [rang, valeur] of valeurs.entries()) {
    /*
     * ⚠️ UNE SEMAINE QUI ÉCHOUE N'ARRÊTE PAS LES AUTRES — c'est déjà le choix
     *    de l'ancien. Générer 45 semaines et tout perdre parce que la S23 pose
     *    problème n'aurait aucun sens ; l'échec est rapporté à sa place.
     *
     * ⚠️ Chaque semaine a SA graine, dérivée de la graine retenue : avec une
     *    graine commune, les 45 semaines partageraient la même suite de tirages
     *    et se ressembleraient toutes — même jour, mêmes salles.
     */
    try {
      const resultat = await genererSemaine(etablissementId, anneeScolaire, valeur, commun, {
        graine: (graineRetenue + numeroDe(valeur)) % 2 ** 31,
        assouplissement,
        lanceePar,
        moteur,
      });
      resultats.push(resultat);
    } catch (erreur) {
      resultats.push({
        semaine: valeur,
        echec: true,
        code: erreur.code ?? 'ERREUR',
        message: erreur.message,
      });
    }

    onProgres?.({ rang: rang + 1, total: valeurs.length, semaine: valeur });
  }

  /*
   * ⚠️ LE BALAYAGE EST PARESSEUX, ET IL PASSE ICI PLUTÔT QUE DANS UNE TÂCHE
   *    PLANIFIÉE : ce projet n'a aucun exécuteur de tâches, et en introduire un
   *    pour une requête indexée serait une infrastructure à héberger. Placé
   *    APRÈS la boucle, il ne retarde jamais la génération elle-même.
   */
  await sansFaireEchouer(balayer(etablissementId, anneeScolaire), { etablissementId });

  return {
    graine: graineRetenue,
    moteur,
    semaines: resultats,
    total: {
      placees: resultats.reduce((somme, r) => somme + (r.placees ?? 0), 0),
      remplacees: resultats.reduce((somme, r) => somme + (r.remplacees ?? 0), 0),
      nonPlacees: resultats.reduce((somme, r) => somme + (r.nonPlacees?.length ?? 0), 0),
      /*
       * ⚠️ LE PRIX DE LA SOUPLESSE, AFFICHÉ À CÔTÉ DU GAIN. Les consignes des
       *    formateurs rapportent +143 séances par an ; elles en posent 164 sur
       *    des créneaux que quelqu'un avait demandé à garder libres. Annoncer le
       *    gain sans le coût ferait découvrir celui-ci par les réclamations.
       */
      deconseillees: resultats.reduce((somme, r) => somme + (r.deconseillees ?? 0), 0),
      horsSalle: resultats.reduce((somme, r) => somme + (r.horsSalle ?? 0), 0),
      echecs: resultats.filter((r) => r.echec).length,
      /*
       * ⚠️ COMBIEN DE SEMAINES CP-SAT A RÉELLEMENT AMÉLIORÉES — pas combien ont
       *    été DEMANDÉES en CP-SAT. Mesuré sur l'année réelle : lancé sur 20
       *    semaines, retenu sur 9 seulement. Annoncer « recherche complète » sur
       *    les 45 laisserait croire que les 45 sont optimales ; elles ne le sont
       *    pas, et c'est justement ce que le repli enregistre.
       */
      ameliorees: resultats.filter((r) => r.rapport?.moteur === MOTEURS.CPSAT).length,
    },
  };
}

/**
 * Ce qu'un assouplissement RÉCUPÉRERAIT, sans rien écrire (F6 · h).
 *
 * ═══ ⚠️ POURQUOI CETTE FONCTION EXISTE ═══
 * Les boutons « relancer en ignorant… » étaient un **pari** : le directeur
 * cliquait, attendait, et découvrait après coup si ça avait servi. Depuis que
 * les consignes des formateurs sont souples (2026-09-22), la réponse est
 * d'ailleurs très souvent **zéro** — le solveur les emploie déjà en dernier
 * recours. Proposer une relance sans le dire ferait perdre du temps pour rien,
 * exactement ce que `assouplissementsUtiles` cherche à éviter depuis le début.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN, ET C'EST LA PROPRIÉTÉ À NE JAMAIS PERDRE : ni `poser`,
 *    ni `deleteMany`, ni trace, ni transaction. Elle construit le problème,
 *    interroge le solveur, compte, et jette. Une simulation qui laisserait une
 *    trace serait pire qu'inutile : elle polluerait le corpus d'entraînement
 *    avec des grilles qui n'ont jamais existé.
 *
 * ⚠️ LE CHIFFRE RENDU EST UN MAJORANT. Il compte ce que le SOLVEUR propose ;
 *    à l'écriture, `poser()` peut encore refuser une séance (quota de module
 *    épuisé, par exemple). Annoncer « jusqu'à N » plutôt que « N » est la seule
 *    formulation honnête — et l'écart, s'il apparaît, est précisément le
 *    signal que le problème construit diverge de ce que le serveur accepte.
 *
 * ⚠️ AU GLOUTON, TOUJOURS : une simulation en recherche approfondie coûterait
 *    vingt secondes par semaine et par hypothèse. On compare des hypothèses
 *    entre elles, pas des moteurs.
 */
const HYPOTHESES = [
  { cle: 'ignorerIndisponibilites', assouplissement: { ignorerIndisponibilites: true } },
  { cle: 'toutesLesSalles', assouplissement: { toutesLesSalles: true } },
  {
    cle: 'lesDeux',
    assouplissement: { ignorerIndisponibilites: true, toutesLesSalles: true },
  },
];

async function compter(etablissementId, anneeScolaire, valeurs, commun, graine, assouplissement) {
  let placees = 0;

  for (const valeur of valeurs) {
    const etat = await lireSemaine(etablissementId, anneeScolaire, valeur);
    if (joursOuverts(etat).length === 0) continue;

    const numero = numeroDe(valeur);
    const { taches } = tachesPour(commun, numero);
    if (taches.length === 0) continue;

    const { probleme, creneauVersCase } = construireProbleme({
      semaine: etat,
      taches,
      salles: commun.etablissement?.espaces ?? [],
      groupesFq: commun.etablissement?.groupesFq ?? [],
      contraintes: commun.contraintes,
      formateurs: commun.formateurs,
      /*
       * ⚠️ LA MÊME GRAINE QUE LA GÉNÉRATION RÉELLE, dérivée de la même façon.
       *    Avec une graine différente, l'écart mesuré mélangerait l'effet de
       *    l'assouplissement et celui du hasard — et une hypothèse pourrait
       *    sembler gagner alors qu'elle n'a fait que tirer mieux.
       */
      graine: (graine + numero) % 2 ** 31,
      assouplissement,
      aPreserver: (etat.seances ?? []).filter(estDuJour).filter(aPreserver),
    });

    /*
     * ⚠️ LA MÊME OCCUPATION QUE LA GÉNÉRATION RÉELLE : sans elle, le compte
     *    promettrait des séances que `poser()` refuserait ensuite.
     */
    probleme.occupation.push(
      ...(await occupationAilleurs(commun, anneeScolaire, valeur, taches, creneauVersCase))
    );

    const solution = await resoudre(probleme);
    placees += solution.placements.length;
  }

  return placees;
}

export async function simuler(etablissementId, anneeScolaire, { semaines }) {
  const valeurs = [...new Set(semaines.map((v) => normaliserValeurSemaine(v)))].filter(Boolean);
  if (valeurs.length === 0) {
    throw badRequest('Aucune semaine valide à simuler', { code: 'SEMAINES_ABSENTES' });
  }

  const commun = await chargerCommun(etablissementId, anneeScolaire);
  const graine = commun.graineEnregistree ?? 0;

  const base = await compter(etablissementId, anneeScolaire, valeurs, commun, graine, {});

  const propositions = [];
  for (const { cle, assouplissement } of HYPOTHESES) {
    const placees = await compter(
      etablissementId,
      anneeScolaire,
      valeurs,
      commun,
      graine,
      assouplissement
    );
    propositions.push({ cle, gain: Math.max(0, placees - base) });
  }

  return { semaines: valeurs.length, base, propositions };
}

/** Réexportée : la route n'a qu'un service à connaître. */
export { previsualiser };
