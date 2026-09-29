import mongoose from 'mongoose';
import {
  espacesEmpruntes,
  estEspacePropre,
  estPartage,
  estSalleReelle,
  mesPieces,
  occupantsDeLaPiece,
  piecesPartagees,
  libelleEspaceEmprunte,
  SALLE_DISTANCIEL,
} from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { User } from '../../models/User.js';
import { STATUTS_COMPTE } from 'shared/constants';
import { badRequest, conflict } from '../../lib/httpError.js';

/**
 * Espaces MUTUALISÉS — une salle partagée entre établissements.
 * (demande du porteur, 2026-09-21.) Le modèle est décrit dans
 * `shared/domain/emploi/espacesMutualises.js` : une pièce, plusieurs noms.
 *
 * ═══ ⚠️ LE PARTAGE SE DÉCIDE CHEZ LE PROPRIÉTAIRE, ET PREND EFFET TOUT DE SUITE ═══
 * L'autre établissement n'a pas à accepter : il voit l'espace dans sa liste, et rien ne
 * l'oblige à s'en servir. Ce qui compte, c'est que DEUX établissements ne posent jamais deux
 * cours dans la pièce au même créneau — voir `conflitsDeSalleMutualisee`.
 */

const cle = (valeur) => String(valeur ?? '').trim().toUpperCase();
const enChaine = (id) => String(id);

/**
 * ═══ ⚠️ LE LIBELLÉ D'UN ESPACE EMPRUNTÉ PORTE LE NOM ABRÉGÉ (2026-09-21) ═══
 * (demande du porteur : « le nom d'établissement entre parenthèses doit être abrégé, pour gagner de
 * la place ».) Le nom officiel — « INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE INDUSTRIEL BEN
 * M'SIK CASABLANCA » — remplissait toute la case de la grille. Le nom abrégé, saisi dans la
 * configuration (« ISTA NTIC »), existe pour cela ; sans lui, on retombe sur le nom complet.
 *
 * ⚠️ MAIS IL SE MODIFIE : les séances gardent le libellé tel qu'il était à la pose. Quand le nom
 * abrégé change, `renommerLibelles` réécrit les libellés des séances des emprunteurs — sans quoi
 * elles se détacheraient de la pièce, et le chevauchement ne serait plus vu.
 */
export const nomCourt = (etablissement) => etablissement?.nomAbrege || etablissement?.nom;

/**
 * Les pièces partagées qui concernent cet établissement — mes prêts et mes emprunts.
 *
 * ⚠️ UNE SEULE REQUÊTE : moi, plus chaque établissement qui me cite dans ses partages.
 */
export async function chargerPieces(etablissementId) {
  const moi = enChaine(etablissementId);
  const documents = await Etablissement.find({
    $or: [{ _id: etablissementId }, { 'espacesMutualises.etablissementId': etablissementId }],
  })
    .select('nom nomAbrege espacesMutualises')
    .lean();

  return piecesPartagees(
    documents.map((document) => ({
      id: enChaine(document._id),
      nom: nomCourt(document),
      espacesMutualises: (document.espacesMutualises ?? []).map((partage) => ({
        espace: partage.espace,
        etablissementId: enChaine(partage.etablissementId),
      })),
    })),
    moi
  );
}

/**
 * Faut-il aller chercher les autres établissements pour juger cette salle ?
 *
 * ⚠️ POUR ÉVITER UNE REQUÊTE DE PLUS À CHAQUE POSE : l'énorme majorité des séances sont
 * dans un espace propre, jamais partagé — rien à vérifier au-delà de l'établissement. On ne
 * charge les pièces que si la salle est partagée par moi, ou si elle n'est pas de chez moi
 * (une salle empruntée).
 */
export function salleAVerifier(etablissement, salle) {
  if (!estSalleReelle(salle)) return false;
  if (!estEspacePropre(etablissement?.espaces, salle)) return true;
  return estPartage(etablissement?.espacesMutualises, salle);
}

/**
 * Les conflits de SALLE avec les autres établissements qui utilisent la même pièce.
 *
 * @param {object} creneau  { anneeScolaire, semaine, jour, seance, periode }
 * @param {Array} pieces    `chargerPieces`
 * @returns {Promise<Array<{type: 'salle', message: string}>>}
 */
export async function conflitsDeSalleMutualisee({ etablissementId, creneau, salle, pieces }) {
  const trouve = occupantsDeLaPiece(pieces, etablissementId, salle);
  if (!trouve) return [];

  const autres = trouve.autres;
  const occupees = await Seance.find({
    ...creneau,
    etablissementId: { $in: autres.map((o) => o.etablissementId) },
  })
    .select('etablissementId groupe salle')
    .lean();

  const noms = await nomsDesEtablissements(autres.map((o) => o.etablissementId));

  return occupees
    .filter((seance) =>
      autres.some(
        (o) => o.etablissementId === enChaine(seance.etablissementId) && cle(o.salle) === cle(seance.salle)
      )
    )
    .map((seance) => ({
      type: 'salle',
      message: `L’espace ${trouve.piece.espace} est déjà utilisé par ${seance.groupe} (${
        noms.get(enChaine(seance.etablissementId)) ?? 'un autre établissement'
      }) sur ce créneau`,
    }));
}

/**
 * Les créneaux d'UNE semaine où une pièce mutualisée est déjà occupée par un
 * AUTRE établissement — pour fermer l'option AVANT le clic dans la liste
 * déroulante des espaces, comme `formateursAilleurs` le fait déjà pour un
 * formateur mutualisé.
 *
 * (2026-09-25, demande du porteur : « en select espace il faut figé ».) Le
 * serveur refuse de toute façon la pose (`conflitsDeSalleMutualisee`, appelé
 * par `poser()`) — mais laisser choisir ce qu'il refusera de toute façon fait
 * découvrir le conflit après coup, au clic sur « Enregistrer », plutôt
 * qu'avant.
 *
 * ⚠️ TOUTE LA SEMAINE EN UNE FOIS, PAS UN CRÉNEAU : c'est elle qui alimente la
 * grille entière, quand `conflitsDeSalleMutualisee` ne juge qu'UNE case à la
 * pose. Reprendre celle-ci créneau par créneau y ferait 24 requêtes au lieu
 * d'une.
 *
 * @returns {Promise<Array<{salle, jour, seance, periode, par, groupe}>>} `salle` est
 *   TOUJOURS le libellé tel que MOI je le vois — le mien pour ma propre pièce,
 *   le libellé emprunté pour une pièce qu'on me prête — pour se comparer
 *   directement à la valeur d'une option de la liste déroulante.
 */
export async function occupationsEspacesAilleursDeLaSemaine(etablissementId, anneeScolaire, semaine) {
  const pieces = await chargerPieces(etablissementId);
  const miennes = mesPieces(pieces, etablissementId);
  if (miennes.length === 0) return [];

  const idsAutres = [...new Set(miennes.flatMap((piece) => piece.autres.map((o) => o.etablissementId)))];
  if (idsAutres.length === 0) return [];

  const occupees = await Seance.find({
    etablissementId: { $in: idsAutres },
    anneeScolaire,
    semaine,
  })
    .select('etablissementId jour seance periode groupe salle')
    .lean();

  const noms = await nomsDesEtablissements(idsAutres);
  const resultat = [];

  for (const { maSalle, autres } of miennes) {
    for (const occupee of occupees) {
      const correspond = autres.some(
        (o) => o.etablissementId === enChaine(occupee.etablissementId) && cle(o.salle) === cle(occupee.salle)
      );
      if (!correspond) continue;

      resultat.push({
        salle: maSalle,
        jour: occupee.jour,
        seance: occupee.seance,
        periode: occupee.periode,
        par: noms.get(enChaine(occupee.etablissementId)) ?? 'un autre établissement',
        groupe: occupee.groupe,
      });
    }
  }

  return resultat;
}

async function nomsDesEtablissements(ids) {
  const documents = await Etablissement.find({ _id: { $in: ids } }).select('nom nomAbrege').lean();
  return new Map(documents.map((document) => [enChaine(document._id), nomCourt(document)]));
}

/**
 * Le nom abrégé d'un établissement change : les libellés de ses espaces prêtés changent avec lui.
 * Les séances des emprunteurs qui portaient l'ancien libellé prennent le nouveau — dans la même
 * requête que le changement de nom, pour qu'aucune ne reste détachée de sa pièce.
 *
 * @param {object} etablissement  l'établissement PRÊTEUR, avec son `espacesMutualises`
 * @param {string} ancienNom      son nom affiché avant (`nomCourt` avant le changement)
 * @param {string} nouveauNom     son nom affiché après
 * @returns {Promise<number>} le nombre de séances réécrites
 */
export async function renommerLibelles(etablissement, ancienNom, nouveauNom) {
  if (!ancienNom || !nouveauNom || cle(ancienNom) === cle(nouveauNom)) return 0;

  const paires = new Set();
  let reecrites = 0;
  for (const partage of etablissement.espacesMutualises ?? []) {
    const emprunteur = enChaine(partage.etablissementId);
    const clePaire = `${emprunteur}|${cle(partage.espace)}`;
    if (paires.has(clePaire)) continue;
    paires.add(clePaire);

    const ancien = libelleEspaceEmprunte(partage.espace, ancienNom);
    const resultat = await Seance.updateMany(
      { etablissementId: emprunteur, salle: new RegExp(`^${echapper(ancien)}$`, 'i') },
      { $set: { salle: libelleEspaceEmprunte(partage.espace, nouveauNom) } }
    );
    reecrites += resultat.modifiedCount ?? 0;
  }
  return reecrites;
}

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Les espaces que d'autres établissements ME prêtent, sous le libellé qu'ils portent chez moi
 * — pour la liste déroulante de l'emploi du temps.
 */
export async function libellesEmpruntes(etablissementId) {
  const pieces = await chargerPieces(etablissementId);
  return espacesEmpruntes(pieces, enChaine(etablissementId)).map((e) => e.salle);
}

/**
 * L'état des partages, pour la page « Espaces » : ce que je prête, ce qu'on me prête.
 */
export async function etat(etablissement) {
  const moi = enChaine(etablissement._id ?? etablissement.id);

  const emprunteurs = [
    ...new Set((etablissement.espacesMutualises ?? []).map((p) => enChaine(p.etablissementId))),
  ];
  const [preteurs, autres] = await Promise.all([
    Etablissement.find({ 'espacesMutualises.etablissementId': moi })
      .select('nom nomAbrege complexe region espacesMutualises')
      .lean(),
    Etablissement.find({ _id: { $in: emprunteurs } }).select('nom complexe region').lean(),
  ]);
  const annuaire = new Map(autres.map((e) => [enChaine(e._id), e]));

  const miens = (etablissement.espaces ?? [])
    .filter((espace) => estSalleReelle(espace))
    .map((espace) => ({
      espace,
      avec: (etablissement.espacesMutualises ?? [])
        .filter((p) => cle(p.espace) === cle(espace))
        .map((p) => annuaire.get(enChaine(p.etablissementId)))
        .filter(Boolean),
    }))
    .map(({ espace, avec }) => ({ espace, avec: grouperParIdentite(avec) }));

  const empruntes = preteurs.flatMap((proprietaire) =>
    (proprietaire.espacesMutualises ?? [])
      .filter((p) => enChaine(p.etablissementId) === moi)
      .map((p) => ({
        espace: p.espace,
        libelle: libelleEspaceEmprunte(p.espace, nomCourt(proprietaire)),
        proprietaire: presenterEtablissement(proprietaire),
      }))
  );

  return { miens, empruntes };
}

/**
 * ═══ ⚠️ UN ÉTABLISSEMENT, C'EST LE NOM OFFICIEL ET SON COMPLEXE — PAS UN COMPTE (2026-09-21) ═══
 * (signalé par le porteur : « il affiche trois fois le même établissement, et le mien ».) Un
 * établissement peut exister PLUSIEURS FOIS en base — un compte par directeur, des comptes d'essai
 * — avec le même nom officiel. Les lister tels quels montrait trois lignes identiques, sans rien
 * pour les distinguer.
 *
 * On regroupe donc par identité (nom + complexe, sans tenir compte de la casse) : UNE ligne, qui
 * porte tous les identifiants qu'elle recouvre. Choisir la ligne partage l'espace avec chacun de
 * ces comptes — ils désignent le même lieu, et chacun contrôle son propre emploi du temps.
 */
export const identite = (e) => `${cle(e.nom)}|${cle(e.complexe)}`;

export function grouperParIdentite(documents) {
  const groupes = new Map();
  for (const e of documents) {
    const clef = identite(e);
    if (!groupes.has(clef)) {
      groupes.set(clef, {
        cle: clef,
        nom: e.nom,
        complexe: e.complexe,
        region: e.region,
        etablissementIds: [],
      });
    }
    groupes.get(clef).etablissementIds.push(enChaine(e._id));
  }
  return [...groupes.values()];
}

/**
 * ═══ ⚠️ SEULS LES ÉTABLISSEMENTS QUI ONT UN COMPTE ACTIF SE PARTAGENT (2026-09-21) ═══
 * (demande du porteur : « il faut afficher que les établissements ayant un compte ».) Un
 * établissement dont le directeur est en attente d'approbation, rejeté, bloqué, supprimé — ou
 * n'a pas confirmé son adresse — n'a personne pour poser des séances : lui prêter un espace
 * n'aurait aucun sens, et la liste se remplirait de fiches sans utilisateur.
 */
export async function avecCompteActif(documents) {
  const proprietaires = [...new Set(documents.map((e) => enChaine(e.proprietaireId)))];
  const actifs = await User.find({
    _id: { $in: proprietaires },
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  })
    .select('_id')
    .lean();
  const ids = new Set(actifs.map((u) => enChaine(u._id)));
  return documents.filter((e) => ids.has(enChaine(e.proprietaireId)));
}

const presenterEtablissement = (e) => ({
  etablissementId: enChaine(e._id),
  nom: e.nom,
  complexe: e.complexe,
  region: e.region,
});

/**
 * Les établissements avec lesquels on peut partager un espace.
 *
 * ⚠️ TOUS LES ÉTABLISSEMENTS AVEC UN COMPTE ACTIF, celui du même complexe en premier (2026-09-21,
 * signalé par le porteur : « il y a un autre établissement avec un compte, mais il n'apparaît
 * pas dans la fenêtre »). La liste se limitait d'abord au complexe de l'appelant — un
 * établissement d'un autre complexe n'y figurait qu'en le cherchant. Comme elle ne contient plus
 * que des établissements avec un compte (`avecCompteActif`), elle reste courte : on la montre
 * en entier, et la recherche ne fait plus que l'affiner.
 * ⚠️ Jamais les siens : on ne se prête pas un espace à soi-même.
 */
export async function annuaire(etablissement, utilisateur, recherche) {
  // ⚠️ ON N'EXCLUT PAS SEULEMENT SON PROPRE IDENTIFIANT : un second compte du même établissement
  // (même nom officiel, même complexe) est le même lieu — on ne se propose pas de se prêter un
  // espace à soi-même. Les AUTRES établissements du compte, eux, restent proposés.
  const filtre = {
    _id: { $ne: etablissement._id ?? etablissement.id },
    $nor: [{ nom: etablissement.nom, complexe: etablissement.complexe }],
  };

  const terme = String(recherche ?? '').trim();
  if (terme.length >= 2) {
    const motif = new RegExp(terme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtre.$or = [{ nom: motif }, { complexe: motif }];
  }

  const trouves = await Etablissement.find(filtre)
    .select('nom complexe region proprietaireId')
    .sort({ nom: 1 })
    .limit(300)
    .lean();
  const groupes = grouperParIdentite(await avecCompteActif(trouves));
  // Le même complexe d'abord : ce sont des locaux qui se partagent le plus naturellement.
  const memeComplexe = (g) => (cle(g.complexe) === cle(etablissement.complexe) ? 0 : 1);
  return groupes
    .sort((a, b) => memeComplexe(a) - memeComplexe(b) || a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, 50);
}

/**
 * Remplace la liste des établissements avec lesquels UN espace est partagé.
 *
 * ⚠️ ON NE RETIRE PAS UN PARTAGE QUE L'AUTRE ÉTABLISSEMENT UTILISE : ses séances porteraient
 * le nom d'un espace qui ne lui est plus prêté, et plus rien ne contrôlerait le chevauchement.
 * Le refus nomme l'établissement et le nombre de séances.
 */
export async function partager(etablissement, { espace, etablissementIds }) {
  const propre = (etablissement.espaces ?? []).find((e) => cle(e) === cle(espace));
  if (!propre) {
    throw badRequest('Cet espace ne figure pas dans la liste des espaces enregistrés', { code: 'ESPACE_INCONNU' });
  }
  if (cle(propre) === SALLE_DISTANCIEL) {
    throw badRequest('TEAMS est une salle à distance : elle n’a rien à partager', { code: 'ESPACE_NON_PARTAGEABLE' });
  }

  const moi = enChaine(etablissement._id ?? etablissement.id);
  const demandes = [...new Set(etablissementIds.map(enChaine))];
  if (demandes.includes(moi)) {
    throw badRequest('Un établissement ne partage pas un espace avec lui-même', { code: 'PARTAGE_SOI' });
  }

  // ⚠️ MÊME RÈGLE QUE L'ANNUAIRE : le serveur ne se fie pas à la liste que l'écran a montrée.
  const existants = await avecCompteActif(
    await Etablissement.find({ _id: { $in: demandes } }).select('nom proprietaireId').lean()
  );
  if (existants.length !== demandes.length) {
    throw badRequest(
      'Un des établissements choisis est introuvable, ou n’a pas de compte actif',
      { code: 'ETABLISSEMENT_INCONNU' }
    );
  }

  const actuels = (etablissement.espacesMutualises ?? [])
    .filter((p) => cle(p.espace) === cle(propre))
    .map((p) => enChaine(p.etablissementId));
  const retires = actuels.filter((id) => !demandes.includes(id));

  for (const id of retires) {
    const libelle = libelleEspaceEmprunte(propre, nomCourt(etablissement));
    const utilisees = await Seance.countDocuments({
      etablissementId: id,
      salle: new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
    if (utilisees > 0) {
      const autre = (await nomsDesEtablissements([id])).get(id);
      throw conflict(
        `${autre ?? 'Cet établissement'} utilise déjà cet espace dans ${utilisees} séance(s) : elles doivent être déplacées avant d’arrêter le partage.`,
        { code: 'ESPACE_UTILISE' }
      );
    }
  }

  // Remplacement de CET espace seulement : les autres partages ne bougent pas.
  await Etablissement.updateOne({ _id: moi }, { $pull: { espacesMutualises: { espace: propre } } });
  if (demandes.length > 0) {
    await Etablissement.updateOne(
      { _id: moi },
      {
        $push: {
          espacesMutualises: {
            $each: demandes.map((id) => ({ espace: propre, etablissementId: new mongoose.Types.ObjectId(id) })),
          },
        },
      }
    );
  }

  return etat(await Etablissement.findById(moi).lean());
}

/**
 * ⚠️ RETIRER OU RENOMMER UN ESPACE PARTAGÉ EST REFUSÉ : la liste des espaces se remplace en
 * bloc, et un espace qui disparaîtrait laisserait un partage sans pièce. Le refus dit quoi
 * faire — arrêter d'abord le partage.
 */
export function refuserRetraitDEspacePartage(etablissement, nouvelleListe) {
  const restants = new Set(nouvelleListe.map(cle));
  const retires = [
    ...new Set(
      (etablissement.espacesMutualises ?? [])
        .map((p) => p.espace)
        .filter((espace) => !restants.has(cle(espace)))
    ),
  ];
  if (retires.length === 0) return;

  throw conflict(
    `${retires.map((e) => `« ${e} »`).join(', ')} ${
      retires.length > 1 ? 'sont mutualisés' : 'est mutualisé'
    } avec d’autres établissements : arrêtez d’abord le partage avant de le retirer ou de le renommer.`,
    { code: 'ESPACE_MUTUALISE' }
  );
}
