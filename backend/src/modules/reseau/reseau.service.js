import { EtablissementOfppt } from '../../models/EtablissementOfppt.js';
import { badRequest, notFound } from '../../lib/httpError.js';

/**
 * Le réseau OFPPT — région → complexe → établissement.
 * ← public/data/etablissements.json
 *
 * ═══ ⚠️ LA LECTURE EST PUBLIQUE, L'ÉCRITURE EST À L'ADMIN ═══
 * L'inscription d'un directeur se fait SANS être connecté : la cascade doit
 * donc être servie à un visiteur. C'était déjà le cas du fichier JSON, servi en
 * clair par le serveur web ; ce qui change, c'est que l'écriture cesse de
 * supposer un accès au disque.
 */

/**
 * Tout le réseau, dans la forme que l'écran d'inscription attend déjà :
 * `{ région: { complexe: [noms] } }`.
 *
 * ⚠️ UN SEUL APPEL, PAS UNE CASCADE DE TROIS : l'écran d'inscription charge le
 * référentiel une fois et navigue dedans sans réseau — c'est ce que faisait le
 * fichier. À 170 entrées aujourd'hui, quelques milliers demain, la charge reste
 * de l'ordre de la centaine de kilooctets ; trois allers-retours par formulaire
 * coûteraient plus cher que ce gain.
 */
export async function arborescence() {
  const lignes = await EtablissementOfppt.find()
    .select('region complexe nom')
    .sort({ region: 1, complexe: 1, nom: 1 })
    .lean();

  const arbre = {};
  for (const { region, complexe, nom } of lignes) {
    arbre[region] ??= {};
    arbre[region][complexe] ??= [];
    arbre[region][complexe].push(nom);
  }

  return arbre;
}

/** Les complexes d'une région — pour la saisie, où l'on descend un cran à la fois. */
export async function complexes(region) {
  const liste = await EtablissementOfppt.distinct('complexe', region ? { region } : {});
  return liste.sort((a, b) => a.localeCompare(b, 'fr'));
}

export async function lister({ region, complexe, recherche, page, parPage }) {
  const filtre = {};
  if (region) filtre.region = region;
  if (complexe) filtre.complexe = complexe;

  if (recherche) {
    /*
     * ⚠️ LA RECHERCHE EST ÉCHAPPÉE : un nom d'établissement contient des
     * parenthèses et des apostrophes — « ISTA (NTIC) BEN M'SIK » — et une
     * expression régulière construite telle quelle serait invalide, ou
     * filtrerait autre chose que ce qui a été tapé.
     */
    const motif = new RegExp(recherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtre.$or = [{ nom: motif }, { complexe: motif }];
  }

  const [total, etablissements] = await Promise.all([
    EtablissementOfppt.countDocuments(filtre),
    EtablissementOfppt.find(filtre)
      .sort({ region: 1, complexe: 1, nom: 1 })
      .skip((page - 1) * parPage)
      .limit(parPage)
      .lean(),
  ]);

  return {
    total,
    page,
    parPage,
    pages: Math.ceil(total / parPage) || 1,
    etablissements: etablissements.map(presenter),
  };
}

/** Le compte par région et par complexe — ce que la page affiche en tête. */
export async function resume() {
  const [parRegion, total, nombreComplexes] = await Promise.all([
    EtablissementOfppt.aggregate([
      { $group: { _id: '$region', etablissements: { $sum: 1 }, complexes: { $addToSet: '$complexe' } } },
      { $project: { region: '$_id', etablissements: 1, complexes: { $size: '$complexes' }, _id: 0 } },
      { $sort: { region: 1 } },
    ]),
    EtablissementOfppt.estimatedDocumentCount(),
    EtablissementOfppt.distinct('complexe'),
  ]);

  return { parRegion, total, complexes: nombreComplexes.length };
}

export async function creer(donnees) {
  await refuserDoublon(donnees);
  const etablissement = await EtablissementOfppt.create(donnees);
  return presenter(etablissement);
}

export async function modifier(id, donnees) {
  const etablissement = await EtablissementOfppt.findById(id);
  if (!etablissement) throw notFound('Établissement introuvable');

  await refuserDoublon({ ...etablissement.toObject(), ...donnees }, etablissement.id);

  Object.assign(etablissement, donnees);
  await etablissement.save();
  return presenter(etablissement);
}

async function refuserDoublon({ region, complexe, nom }, sauf = null) {
  const existant = await EtablissementOfppt.findOne({
    region,
    complexe,
    nom,
    ...(sauf ? { _id: { $ne: sauf } } : {}),
  });

  if (existant) {
    throw badRequest(`« ${nom} » existe déjà dans le complexe ${complexe}.`, {
      code: 'ETABLISSEMENT_EN_DOUBLE',
    });
  }
}

export async function supprimer(id) {
  const etablissement = await EtablissementOfppt.findByIdAndDelete(id);
  if (!etablissement) throw notFound('Établissement introuvable');
  return { supprimes: 1, etablissement: presenter(etablissement) };
}

/**
 * Renomme un complexe — donc TOUS ses établissements d'un coup.
 *
 * ═══ ⚠️ LE COMPLEXE N'EST PAS UNE ENTITÉ, C'EST UN CHAMP ═══ (décision du
 * porteur, 2026-09-02.) Il naît avec son premier établissement et disparaît avec
 * le dernier — exactement le flux décrit. Le renommer est donc une écriture
 * GROUPÉE, pas la modification d'un document : sans elle, il faudrait rouvrir
 * chaque établissement, et un oubli laisserait deux complexes presque
 * homonymes dans la cascade d'inscription.
 */
export async function renommerComplexe(region, ancien, nouveau) {
  if (ancien === nouveau) {
    throw badRequest('Le nouveau nom est identique à l’ancien.', { code: 'AUCUN_CHANGEMENT' });
  }

  const concernes = await EtablissementOfppt.countDocuments({ region, complexe: ancien });
  if (concernes === 0) throw notFound('Complexe introuvable dans cette région');

  /*
   * ⚠️ ON REFUSE LA FUSION SILENCIEUSE : renommer « CF Bâtiment » en un nom déjà
   * pris réunirait deux complexes distincts, et l'index unique ferait échouer
   * l'écriture sur les seuls homonymes — la moitié du renommage passerait, et
   * personne ne saurait laquelle.
   */
  const collision = await EtablissementOfppt.countDocuments({ region, complexe: nouveau });
  if (collision > 0) {
    throw badRequest(
      `Le complexe « ${nouveau} » existe déjà dans cette région (${collision} établissement(s)). Renommer fusionnerait les deux.`,
      { code: 'COMPLEXE_EN_DOUBLE' }
    );
  }

  const { modifiedCount } = await EtablissementOfppt.updateMany(
    { region, complexe: ancien },
    { $set: { complexe: nouveau } }
  );

  return { modifies: modifiedCount };
}

/**
 * Supprime un complexe entier.
 *
 * ⚠️ ELLE EST DISTINCTE DE LA SUPPRESSION D'UN ÉTABLISSEMENT : retirer un
 * complexe de vingt établissements demanderait vingt gestes, et l'on s'arrêterait
 * en chemin.
 */
export async function supprimerComplexe(region, complexe) {
  const concernes = await EtablissementOfppt.countDocuments({ region, complexe });
  if (concernes === 0) throw notFound('Complexe introuvable dans cette région');

  const { deletedCount } = await EtablissementOfppt.deleteMany({ region, complexe });
  return { supprimes: deletedCount };
}

function presenter(etablissement) {
  return {
    id: String(etablissement._id ?? etablissement.id),
    region: etablissement.region,
    complexe: etablissement.complexe,
    nom: etablissement.nom,
  };
}
