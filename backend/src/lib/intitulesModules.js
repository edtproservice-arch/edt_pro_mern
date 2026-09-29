import { anneeDuNomGroupe, filieresParGroupe, separerFusion } from 'shared/domain';
import { Repartition } from '../models/Repartition.js';

/**
 * Code de module → intitulé complet, lu dans la répartition DRIF.
 * ← demande du porteur (2026-09-04) : la vue Agenda n'avait que le CODE
 * (« M205 »), et c'est le nom complet qu'on vient lire.
 *
 * ⚠️ SORTI DE `consultation.service` (2026-09-17) pour servir aussi les absences
 * de formateurs : l'importer depuis là créait un cycle (consultation → séances →
 * absences → consultation).
 *
 * ⚠️ LE CHAMP LISIBLE S'APPELLE `module`, PAS `intitule` — `codeModule` porte le code.
 *
 * ⚠️⚠️ PAR CODE SEUL, CETTE FONCTION SE TROMPE DÈS QUE LA FILIÈRE COMPTE
 * (2026-09-28, signalé par le porteur : en Génie mécanique, « M105 » s'affichait
 * « Matériel et mobilier », intitulé de la Restauration). Un même code vit dans
 * des dizaines de filières. Dès qu'on connaît le GROUPE, passer par
 * `intitulesParGroupe` ci-dessous.
 */
export async function intitulesModules(codes, champ = 'module') {
  if (codes.length === 0) return {};
  const references = await Repartition.find({ codeModule: { $in: codes } })
    .select(`codeModule codeFiliereDrif ${champ}`)
    .sort({ codeModule: 1, codeFiliereDrif: 1 })
    .lean();
  const intitules = {};
  for (const r of references) {
    const nom = String(r[champ] ?? '').trim();
    if (nom !== '' && !intitules[r.codeModule]) intitules[r.codeModule] = nom;
  }
  return intitules;
}

/** Clé d'un couple (groupe, module) dans la table rendue par `intitulesParGroupe`. */
export const cleGroupeModule = (groupe, code) => `${String(groupe ?? '').trim()}||${String(code ?? '').trim()}`;

/**
 * L'intitulé de chaque couple (groupe, module), DANS LA FILIÈRE DU GROUPE.
 *
 * Même règle que la carte d'affectation et que `intituleModule` des séances :
 *   1. filière du groupe + année de formation + code ;
 *   2. filière du groupe + code (le module a changé d'année) ;
 *   3. le code seul, en dernier recours (groupe sans filière connue).
 *
 * ⚠️ `codeFiliereCarte`, PAS `codeFiliereDrif` : `filieresParGroupe` lit la
 * carte, qui stocke le code de la base e-note — voir `seances.service.js`.
 *
 * ⚠️ DEUX REQUÊTES AU PLUS, quel que soit le nombre de couples : une par
 * filières concernées, une pour le repli par code.
 *
 * @param {object} base      document `Base` avec `affectations groupes groupeFilieres`
 * @param {Array<{groupe, module}>} couples  un `groupe` fusionné (« GM101 GM102 »)
 *   est accepté : c'est son premier groupe qui donne la filière.
 * @param {string} [champ]  le champ de la répartition à lire — `module` (l'intitulé)
 *   par défaut, `metier` pour le métier du module (même résolution par filière).
 * @returns {Promise<Map<string, string>>} clé `cleGroupeModule` → intitulé
 */
export async function intitulesParGroupe(base, couples, champ = 'module') {
  const filieres = filieresParGroupe(base);
  const demandes = [];

  for (const { groupe, module } of couples) {
    const code = String(module ?? '').trim();
    if (code === '') continue;
    const premier = separerFusion(groupe)[0] ?? String(groupe ?? '').trim();
    demandes.push({
      cle: cleGroupeModule(groupe, code),
      code,
      filiere: filieres.get(premier) ?? '',
      annee: anneeDuNomGroupe(premier),
    });
  }
  if (demandes.length === 0) return new Map();

  const codes = [...new Set(demandes.map((d) => d.code))];
  const codesFiliere = [...new Set(demandes.map((d) => d.filiere).filter(Boolean))];

  const [precises, generiques] = await Promise.all([
    codesFiliere.length
      ? Repartition.find({ codeFiliereCarte: { $in: codesFiliere }, codeModule: { $in: codes } })
          .select(`codeFiliereCarte anneeFormation codeModule ${champ}`)
          .lean()
      : [],
    intitulesModules(codes, champ),
  ]);

  const parFiliereAnnee = new Map();
  const parFiliere = new Map();
  for (const ligne of precises) {
    const nom = String(ligne[champ] ?? '').trim();
    if (nom === '') continue;
    const cleAnnee = `${ligne.codeFiliereCarte}||${ligne.anneeFormation}||${ligne.codeModule}`;
    const cleFiliere = `${ligne.codeFiliereCarte}||${ligne.codeModule}`;
    if (!parFiliereAnnee.has(cleAnnee)) parFiliereAnnee.set(cleAnnee, nom);
    if (!parFiliere.has(cleFiliere)) parFiliere.set(cleFiliere, nom);
  }

  const resultat = new Map();
  for (const { cle, code, filiere, annee } of demandes) {
    const nom =
      (filiere &&
        (parFiliereAnnee.get(`${filiere}||${annee}||${code}`) ?? parFiliere.get(`${filiere}||${code}`))) ||
      generiques[code] ||
      '';
    if (nom) resultat.set(cle, nom);
  }
  return resultat;
}

/**
 * Variante « code → intitulé » pour les écrans qui n'indexent que par code
 * (agenda, cartes) : chaque code prend l'intitulé de la filière du PREMIER
 * groupe qui le porte parmi `couples`. Juste pour un stagiaire (une filière) ;
 * pour un formateur à plusieurs filières, lire aussi `parGroupe`.
 *
 * @returns {Promise<{parCode: object, parGroupe: object}>}
 */
export async function intitulesPourEcran(base, couples) {
  const table = await intitulesParGroupe(base, couples);
  const parCode = {};
  for (const { groupe, module } of couples) {
    const code = String(module ?? '').trim();
    const nom = table.get(cleGroupeModule(groupe, code));
    if (code && nom && !parCode[code]) parCode[code] = nom;
  }
  return { parCode, parGroupe: Object.fromEntries(table) };
}
