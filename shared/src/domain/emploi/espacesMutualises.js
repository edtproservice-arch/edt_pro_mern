import { estSalleReelle } from './conflits.js';

/**
 * Espaces MUTUALISÉS — une salle partagée entre plusieurs établissements.
 * (demande du porteur, 2026-09-21 : « mutualiser un espace, c.-à-d. le partager avec un autre
 * établissement : celui-ci peut l'utiliser, à condition de vérifier le chevauchement ».)
 *
 * ═══ LE MODÈLE : UNE PIÈCE, PLUSIEURS NOMS ═══
 * Une salle physique appartient à UN établissement (son propriétaire), qui l'a saisie dans ses
 * espaces. Il peut la partager avec d'autres : chacun la voit alors dans SA liste, sous un nom
 * qui dit d'où elle vient — « Salle 4 (ISTA NTIC BEN M'SIK) » —, parce que « Salle 4 » existe
 * peut-être déjà chez lui. Les séances gardent ce nom dans leur champ `salle`, comme n'importe
 * quel espace : aucune structure de plus dans la séance.
 *
 * ⚠️ LE NOM DE L'ÉTABLISSEMENT EST LE NOM OFFICIEL (`nom`), PAS LE NOM ABRÉGÉ : il ne change
 * pas. Le nom abrégé se modifie dans la configuration ; un libellé qui le suivrait détacherait
 * en silence les séances déjà posées de leur pièce, et le chevauchement ne serait plus vu.
 *
 * ⚠️ SEULS LES ESPACES PROPRES SE PARTAGENT : un espace emprunté ne se repartage pas — la pièce
 * n'a qu'un propriétaire, c'est lui qui décide qui l'utilise.
 *
 * Ce module est PUR : il décrit qui appelle quelle pièce comment. Les lectures en base et le
 * refus d'une pose restent au serveur.
 */

const cle = (valeur) => String(valeur ?? '').trim().toUpperCase();

/** « Salle 4 » vue par un AUTRE établissement : « Salle 4 (ISTA NTIC BEN M'SIK) ». */
export const libelleEspaceEmprunte = (espace, nomProprietaire) =>
  `${String(espace).trim()} (${String(nomProprietaire).trim()})`;

/**
 * Les pièces partagées qui concernent `moiId`, qu'il les prête ou les emprunte.
 *
 * @param {Array<{id: string, nom: string, espacesMutualises?: Array<{espace: string, etablissementId: string}>}>} etablissements
 *   moi, et chaque établissement qui partage un espace avec moi
 * @param {string} moiId
 * @returns {Array<{
 *   proprietaireId: string,
 *   espace: string,
 *   occupations: Array<{ etablissementId: string, nom: string|null, salle: string }>
 * }>} `occupations` : sous quel nom chaque établissement désigne la pièce — le propriétaire
 *   sous son nom d'origine, chaque emprunteur sous le libellé emprunté
 */
export function piecesPartagees(etablissements = [], moiId) {
  const moi = String(moiId);
  const pieces = [];

  for (const proprietaire of etablissements) {
    const partages = proprietaire.espacesMutualises ?? [];
    const parEspace = new Map();

    for (const { espace, etablissementId } of partages) {
      if (!parEspace.has(cle(espace))) parEspace.set(cle(espace), { espace, emprunteurs: [] });
      parEspace.get(cle(espace)).emprunteurs.push(String(etablissementId));
    }

    for (const { espace, emprunteurs } of parEspace.values()) {
      const proprietaireId = String(proprietaire.id);
      // Je ne vois que ce qui me concerne : mes prêts, et ce qu'on m'a prêté.
      if (proprietaireId !== moi && !emprunteurs.includes(moi)) continue;

      pieces.push({
        proprietaireId,
        espace,
        occupations: [
          { etablissementId: proprietaireId, nom: proprietaire.nom, salle: espace },
          ...emprunteurs.map((etablissementId) => ({
            etablissementId,
            nom: null,
            salle: libelleEspaceEmprunte(espace, proprietaire.nom),
          })),
        ],
      });
    }
  }

  return pieces;
}

/**
 * Les AUTRES occupants de la pièce que désigne `salle` chez `etablissementId`.
 *
 * @returns {{ piece: object, autres: Array<{etablissementId: string, nom: string|null, salle: string}> } | null}
 *   `null` : cet espace n'est pas mutualisé, rien à vérifier au-delà de l'établissement
 */
export function occupantsDeLaPiece(pieces = [], etablissementId, salle) {
  if (!estSalleReelle(salle)) return null;
  const moi = String(etablissementId);

  for (const piece of pieces) {
    const eux = piece.occupations.find(
      (o) => String(o.etablissementId) === moi && cle(o.salle) === cle(salle)
    );
    if (!eux) continue;
    return {
      piece,
      autres: piece.occupations.filter((o) => o !== eux),
    };
  }
  return null;
}

/**
 * TOUTES les pièces où `moiId` a une place — propriétaire ou emprunteur —,
 * chacune avec le libellé SOUS LEQUEL IL LA VOIT et ses autres occupants.
 *
 * (2026-09-25, demande du porteur : « en select espace il faut figé » — fermer
 * l'option d'une salle mutualisée déjà occupée ailleurs, avant même le clic,
 * comme `formateursAilleurs` le fait pour un formateur mutualisé.) C'est le
 * pendant, POUR TOUTES MES PIÈCES à la fois, de ce qu'`occupantsDeLaPiece` rend
 * pour UNE seule, connue d'avance — utile ici puisqu'on balaie la semaine
 * entière, pas une case précise.
 *
 * @returns {Array<{ maSalle: string, autres: Array<{etablissementId, nom, salle}> }>}
 */
export function mesPieces(pieces = [], moiId) {
  const moi = String(moiId);
  return pieces
    .map((piece) => {
      const moiOcc = piece.occupations.find((o) => String(o.etablissementId) === moi);
      if (!moiOcc) return null;
      return { maSalle: moiOcc.salle, autres: piece.occupations.filter((o) => o !== moiOcc) };
    })
    .filter(Boolean);
}

/** Les libellés sous lesquels `moiId` voit les pièces qu'on lui prête — pour sa liste d'espaces. */
export function espacesEmpruntes(pieces = [], moiId) {
  const moi = String(moiId);
  return pieces
    .filter((piece) => piece.proprietaireId !== moi)
    .map((piece) => {
      const chezMoi = piece.occupations.find((o) => String(o.etablissementId) === moi);
      return { salle: chezMoi.salle, espace: piece.espace, proprietaireId: piece.proprietaireId };
    });
}

/**
 * Cet espace est-il partagé par l'établissement ?
 * Sert au serveur à ne charger les autres établissements que si la salle le justifie.
 */
export const estPartage = (espacesMutualises = [], salle) =>
  espacesMutualises.some((partage) => cle(partage.espace) === cle(salle));

/** Cette salle figure-t-elle dans les espaces PROPRES de l'établissement ? */
export const estEspacePropre = (espaces = [], salle) =>
  espaces.some((espace) => cle(espace) === cle(salle));
