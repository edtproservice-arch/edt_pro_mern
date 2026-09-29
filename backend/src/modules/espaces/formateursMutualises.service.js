import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { avecCompteActif, grouperParIdentite, identite, nomCourt } from './espaces.service.js';

/**
 * Formateurs MUTUALISÉS — affectés dans plusieurs établissements.
 * (demande du porteur, 2026-09-21 : « la mutualisation du formateur doit se détecter
 * automatiquement : on cherche le formateur affecté dans deux ou trois établissements, il est
 * alors mutualisé ».)
 *
 * ═══ ⚠️ RIEN À DÉCLARER : LA MUTUALISATION SE LIT DANS LES BASES ═══
 * Un formateur est mutualisé dès que SON MATRICULE figure dans la base de plus d'un établissement,
 * la même année scolaire. Contrairement à un espace, personne ne « prête » un formateur : c'est un
 * fait, et il change tout seul quand la liste d'un établissement change.
 *
 * ═══ ⚠️ « AFFECTÉ » VEUT DIRE « DANS SA LISTE DE FORMATEURS », PAS « A DES MODULES » ═══
 * (2026-09-21, signalé par le porteur : un formateur présent dans deux établissements n'apparaissait
 * pas.) La première version exigeait des affectations de modules dans les DEUX cartes — or un
 * formateur est rattaché à un établissement dès qu'il figure dans sa liste (import e-note, ajout),
 * bien avant qu'un module lui soit confié. C'est cette présence qui le rend indisponible ailleurs :
 * on compte donc la liste des formateurs ET les affectations.
 *
 * ═══ ⚠️ LE CONTRÔLE : UN FORMATEUR N'EST PAS À DEUX ENDROITS ═══
 * Poser une séance pour un formateur mutualisé est refusé si un AUTRE établissement lui a déjà
 * posé un cours sur le même créneau — dans les deux sens, sans que rien ne soit configuré.
 *
 * ⚠️ LE MATRICULE EST LA CLÉ (comme partout : c'est ce que portent les séances). Une affectation
 * qui désigne le formateur par son nom seulement ne le rattache à aucun autre établissement.
 * ⚠️ SEULS LES ÉTABLISSEMENTS AVEC UN COMPTE ACTIF COMPTENT, et jamais un autre compte du MÊME
 * établissement (même nom officiel et complexe) — voir `espaces.service.js`.
 */

const enChaine = (id) => String(id);

/** Les matricules d'une base : sa liste de formateurs, plus ceux que nomment ses affectations. */
function matriculesDeLaBase(base) {
  const matricules = new Set();
  for (const formateur of base.formateurs ?? []) {
    const matricule = String(formateur.matricule ?? '').trim();
    if (matricule) matricules.add(matricule);
  }
  for (const affectation of base.affectations ?? []) {
    const matricule = String(affectation.formateur ?? '').trim();
    if (matricule) matricules.add(matricule);
  }
  return matricules;
}

/**
 * Les autres établissements où ce matricule est affecté cette année.
 *
 * ⚠️ UNE REQUÊTE PEU COÛTEUSE (index `anneeScolaire + affectations.formateur`) : elle part à chaque
 * pose d'une séance, et rend presque toujours une liste vide.
 *
 * @param {{ nom: string, complexe: string }} [moi]  l'établissement appelant, pour écarter ses
 *   propres doublons de compte
 * @returns {Promise<Array<{ etablissementId: string, nom: string }>>}
 */
export async function autresEtablissementsDuFormateur(etablissementId, anneeScolaire, matricule, moi) {
  const cle = String(matricule ?? '').trim();
  if (!cle) return [];

  const bases = await Base.find({
    anneeScolaire,
    etablissementId: { $ne: etablissementId },
    // Présent dans la liste des formateurs OU nommé par une affectation.
    $or: [{ 'formateurs.matricule': cle }, { 'affectations.formateur': cle }],
  })
    .select('etablissementId')
    .lean();
  if (bases.length === 0) return [];

  const documents = await Etablissement.find({ _id: { $in: bases.map((b) => b.etablissementId) } })
    .select('nom nomAbrege complexe proprietaireId')
    .lean();

  const retenus = (await avecCompteActif(documents)).filter(
    (document) => !moi || identite(document) !== identite(moi)
  );
  return retenus.map((document) => ({ etablissementId: enChaine(document._id), nom: nomCourt(document) }));
}

/**
 * Les conflits de FORMATEUR avec les autres établissements sur ce créneau.
 *
 * @param {object} creneau  { anneeScolaire, semaine, jour, seance, periode }
 * @param {Array<{ etablissementId: string, nom: string }>} autres  `autresEtablissementsDuFormateur`
 * @returns {Promise<Array<{type: 'formateur', message: string}>>}
 */
export async function conflitsDeFormateurMutualise({ creneau, matricule, autres }) {
  if (autres.length === 0) return [];

  const prises = await Seance.find({
    ...creneau,
    formateurMatricule: matricule,
    etablissementId: { $in: autres.map((a) => a.etablissementId) },
  })
    .select('etablissementId groupe')
    .lean();

  const noms = new Map(autres.map((a) => [a.etablissementId, a.nom]));
  return prises.map((seance) => ({
    type: 'formateur',
    message: `Ce formateur a déjà cours à ${noms.get(enChaine(seance.etablissementId))} (${seance.groupe}) sur ce créneau`,
  }));
}

/**
 * Où chaque formateur de l'établissement est AUSSI présent : la base de tout le reste.
 *
 * ⚠️ DEUX REQUÊTES SEULEMENT quand rien n'est partagé (la base de l'établissement, puis celles des
 * autres) : c'est le cas de presque tous — le reste ne se lit que s'il y a des formateurs communs.
 *
 * @returns {Promise<{ base: object|null, parMatricule: Map<string, Set<string>>, retenus: Map<string, object> }>}
 *   `parMatricule` : matricule → identifiants des AUTRES établissements (comptes actifs, hors doublons
 *   du mien) ; `retenus` : ces établissements, par identifiant
 */
async function formateursCommuns(etablissementId, anneeScolaire) {
  const vide = { base: null, parMatricule: new Map(), retenus: new Map() };
  const moi = enChaine(etablissementId);

  const base = await Base.findOne({ etablissementId: moi, anneeScolaire })
    .select('formateurs.matricule formateurs.nomComplet affectations.formateur')
    .lean();
  if (!base) return vide;

  // Les matricules de CET établissement : sa liste de formateurs, et ceux que ses affectations nomment.
  const miens = matriculesDeLaBase(base);
  if (miens.size === 0) return { ...vide, base };

  const autresBases = await Base.find({
    anneeScolaire,
    etablissementId: { $ne: moi },
    $or: [
      { 'formateurs.matricule': { $in: [...miens] } },
      { 'affectations.formateur': { $in: [...miens] } },
    ],
  })
    .select('etablissementId formateurs.matricule affectations.formateur')
    .lean();
  if (autresBases.length === 0) return { ...vide, base };

  // matricule → les établissements (identifiants) où il figure aussi
  const parMatricule = new Map();
  for (const autre of autresBases) {
    for (const matricule of matriculesDeLaBase(autre)) {
      if (!miens.has(matricule)) continue;
      if (!parMatricule.has(matricule)) parMatricule.set(matricule, new Set());
      parMatricule.get(matricule).add(enChaine(autre.etablissementId));
    }
  }

  // MON établissement est lu dans la même requête : son nom sert à écarter mes propres doublons de
  // compte, sans une lecture de plus.
  const documents = await Etablissement.find({
    _id: { $in: [...autresBases.map((b) => b.etablissementId), moi] },
  })
    .select('nom nomAbrege complexe region proprietaireId')
    .lean();
  const monDocument = documents.find((document) => enChaine(document._id) === moi);
  const retenus = new Map(
    (await avecCompteActif(documents.filter((document) => enChaine(document._id) !== moi)))
      .filter((document) => !monDocument || identite(document) !== identite(monDocument))
      .map((document) => [enChaine(document._id), document])
  );

  return { base, parMatricule, retenus };
}

/**
 * Les formateurs mutualisés de l'établissement, pour l'écran : chacun avec les autres
 * établissements où il est affecté.
 *
 * @returns {Promise<Array<{ matricule: string, nom: string, avec: Array }>>}
 */
export async function formateursMutualises(etablissement, anneeScolaire) {
  const { base, parMatricule, retenus } = await formateursCommuns(
    enChaine(etablissement._id ?? etablissement.id),
    anneeScolaire
  );
  if (!base) return [];

  const noms = new Map(
    (base.formateurs ?? []).map((f) => [String(f.matricule ?? '').trim(), f.nomComplet])
  );

  return [...parMatricule]
    .map(([matricule, ids]) => ({
      matricule,
      nom: noms.get(matricule) ?? matricule,
      avec: grouperParIdentite([...ids].map((id) => retenus.get(id)).filter(Boolean)),
    }))
    .filter((formateur) => formateur.avec.length > 0)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * ═══ LES CRÉNEAUX OÙ UN FORMATEUR MUTUALISÉ ENSEIGNE AILLEURS, POUR LA GRILLE (2026-09-21) ═══
 * (demande du porteur : « il faut vérifier les chevauchements des formateurs mutualisés, et FIGER
 * ces séances ».) Le serveur refuse déjà la pose ; ceci sert à FERMER la case avant le clic, comme
 * la grille ferme déjà celle d'un formateur en formation : elle dit chez qui, et avec quel groupe.
 *
 * @param {string} semaine  forme canonique « 2026-W3 »
 * @returns {Promise<Array<{ matricule: string, jour: string, seance: string, periode: string, par: string, groupe: string }>>}
 */
export async function occupationsAilleurs(etablissementId, anneeScolaire, semaine) {
  const { parMatricule, retenus } = await formateursCommuns(enChaine(etablissementId), anneeScolaire);
  if (retenus.size === 0) return [];

  const matricules = [...parMatricule.keys()];
  const prises = await Seance.find({
    anneeScolaire,
    semaine,
    formateurMatricule: { $in: matricules },
    etablissementId: { $in: [...retenus.keys()] },
  })
    .select('etablissementId formateurMatricule jour seance periode groupe')
    .lean();

  return prises
    .filter((seance) => parMatricule.get(seance.formateurMatricule)?.has(enChaine(seance.etablissementId)))
    .map((seance) => ({
      matricule: seance.formateurMatricule,
      jour: seance.jour,
      seance: seance.seance,
      periode: seance.periode,
      par: nomCourt(retenus.get(enChaine(seance.etablissementId))),
      groupe: seance.groupe,
    }));
}
