import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { TYPES_COURS } from 'shared/constants';
import { anneeDuNomGroupe, filieresParGroupe, separerFusion } from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Repartition } from '../../models/Repartition.js';
import { Seance } from '../../models/Seance.js';
import { notFound } from '../../lib/httpError.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';

/**
 * Le « Calendrier EFM DR » — le classeur que l'établissement transmet à la
 * Direction Régionale (2026-10-11, demande du porteur, canevas « EFM LOCAUX S1
 * S2.xlsx »).
 *
 * ═══ LE CANEVAS EST LE GABARIT ═══ On ouvre le fichier transmis : la ligne
 * d'en-tête, ses couleurs et ses largeurs restent les siennes ; les lignes
 * d'exemple sont retirées, et la première sert de modèle de style pour chaque
 * ligne écrite. Les valeurs suivent sa forme : masses et matricules en TEXTE
 * (« 15.00 »), dates en vraies dates au format court du canevas.
 *
 * ═══ LES LIGNES DE LA FENÊTRE, ENRICHIES ICI ═══ L'écran envoie les couples
 * (groupe, module) qu'il affiche — filtre compris — avec la date d'achèvement
 * qu'il a déjà calculée (achevé : dernière séance posée ; en cours : fin prévue
 * au chronogramme ou estimée ; non commencé : fin prévue). Le serveur ajoute
 * ce que seul lui connaît : l'établissement, la filière et les masses DRIF, le
 * formateur présentiel, les séances d'EFM posées.
 *
 * Colonnes X / Y — dates d'EFM :
 *   - « Date prévisionnelle EFM » : laissée vide, la DR la fixe ;
 *   - « Date Réalisation EFM » : la dernière séance d'EFM déjà passée.
 *
 * ⚠️ TOUT EST CENTRÉ (2026-10-11, demande du porteur).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'calendrierEfmDr.xlsx');

/** Les 25 colonnes du canevas, A → Y. */
const NB_COLONNES = 25;

const texteHeures = (valeur) => Number(valeur ?? 0).toFixed(2);

/** « 2026-09-14 » → Date à midi (heure locale) : pas de décalage d'un jour à l'écriture. */
const enDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`) : null);

export async function construireCalendrierEfm({ etablissementId, anneeScolaire, lignes }) {
  const [base, etablissement, seancesEfm] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs affectations groupeFilieres').lean(),
    Etablissement.findById(etablissementId).select('region complexe nom nomAbrege').lean(),
    Seance.find({ etablissementId, anneeScolaire, estEfm: true }).select('groupe module date statut').lean(),
  ]);
  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });

  /* ── La filière de chaque groupe, puis sa ligne DRIF par module ───────── */
  const filieres = filieresParGroupe(base);
  const codes = [...new Set(lignes.map((ligne) => ligne.module))];
  const codesFiliere = [...new Set(lignes.map((ligne) => filieres.get(ligne.groupe)).filter(Boolean))];
  const references = await Repartition.find({
    codeModule: { $in: codes },
    ...(codesFiliere.length > 0 ? { codeFiliereCarte: { $in: codesFiliere } } : {}),
  }).lean();

  /** La ligne DRIF du couple : filière + année, sinon filière seule. */
  const referenceDe = (groupe, module) => {
    const filiere = filieres.get(groupe);
    if (!filiere) return null;
    const annee = anneeDuNomGroupe(groupe);
    const candidates = references.filter((r) => r.codeFiliereCarte === filiere && r.codeModule === module);
    return candidates.find((r) => r.anneeFormation === annee) ?? candidates[0] ?? null;
  };

  /* ── Le formateur PRÉSENTIEL de chaque couple ────────────────────────── */
  const noms = new Map();
  for (const formateur of base.formateurs ?? []) {
    for (const cle of [formateur.matricule, formateur.nomUnique, formateur.nomComplet]) {
      if (String(cle ?? '').trim()) noms.set(String(cle).trim(), formateur);
    }
  }
  const presentiel = new Map();
  for (const affectation of base.affectations ?? []) {
    if (affectation.type === TYPES_COURS.SYNCHRONE) continue;
    for (const groupe of separerFusion(affectation.groupe)) {
      const cle = `${groupe}||${affectation.module}`;
      if (!presentiel.has(cle)) presentiel.set(cle, String(affectation.formateur ?? '').trim());
    }
  }

  /* ── Les séances d'EFM posées, par couple ────────────────────────────── */
  const efm = new Map();
  for (const seance of seancesEfm) {
    if (!seance.date || seance.statut === 'absent') continue;
    for (const groupe of separerFusion(seance.groupe)) {
      const cle = `${groupe}||${String(seance.module ?? '').trim()}`;
      if (!efm.has(cle)) efm.set(cle, []);
      efm.get(cle).push(new Date(seance.date));
    }
  }
  const maintenant = new Date();

  /* ── Le classeur ─────────────────────────────────────────────────────── */
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(await chargerCanevasTampon(CHEMIN_CANEVAS));
  const feuille = classeur.worksheets[0];

  // Le style de la première ligne d'exemple, cellule par cellule, AVANT de la retirer.
  const styles = Array.from({ length: NB_COLONNES }, (_, index) =>
    structuredClone(feuille.getRow(2).getCell(index + 1).style ?? {})
  );
  if (feuille.rowCount > 1) feuille.spliceRows(2, feuille.rowCount - 1);

  // L'en-tête aussi : certaines cases du canevas (« DR », « filière »…) ne l'étaient pas.
  for (let colonne = 1; colonne <= NB_COLONNES; colonne += 1) {
    const cellule = feuille.getRow(1).getCell(colonne);
    cellule.alignment = { ...(cellule.alignment ?? {}), horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  const anneeTexte = `${anneeScolaire}-${anneeScolaire + 1}`;

  lignes.forEach((ligne, index) => {
    const cle = `${ligne.groupe}||${ligne.module}`;
    const reference = referenceDe(ligne.groupe, ligne.module);
    // L'affectation porte le matricule quand il existe, sinon le nom : la table
    // des formateurs remet chacun dans sa colonne.
    const brut = presentiel.get(cle) ?? '';
    const formateur = noms.get(brut);
    const estMatricule = /^\d+$/.test(brut);

    const datesEfm = (efm.get(cle) ?? []).sort((a, b) => a - b);
    const realisee = datesEfm.filter((date) => date <= maintenant).at(-1) ?? null;
    const achevement = enDate(ligne.dateAchevement);

    const s1 = [reference?.mhpS1, reference?.mhsynS1, reference?.mhasynS1].map((v) => Number(v ?? 0));
    const s2 = [reference?.mhpS2, reference?.mhsynS2, reference?.mhasynS2].map((v) => Number(v ?? 0));

    const valeurs = [
      etablissement?.region ?? '',
      etablissement?.complexe ?? '',
      '', // Code EFP : l'application ne le connaît pas.
      etablissement?.nomAbrege || etablissement?.nom || '',
      anneeTexte,
      reference?.niveauFormation ?? '',
      reference?.secteur ?? '',
      filieres.get(ligne.groupe) ?? reference?.codeFiliereDrif ?? '',
      reference?.intituleFiliere || reference?.filiere || '',
      reference?.creneau ?? '',
      ligne.groupe,
      ligne.module,
      ligne.intitule || reference?.module || '',
      texteHeures(s1[0]),
      texteHeures(s1[1]),
      texteHeures(s1[0] + s1[1] + s1[2]),
      texteHeures(s2[0]),
      texteHeures(s2[1]),
      texteHeures(s2[0] + s2[1] + s2[2]),
      ligne.estRegional ? 'O' : 'N',
      formateur?.matricule || (estMatricule ? brut : ''),
      formateur?.nomComplet || (estMatricule ? '' : brut),
      achevement,
      // Laissée VIDE (2026-10-11, demande du porteur) : c'est la DR qui la fixe.
      null,
      realisee,
    ];

    const rangee = feuille.getRow(2 + index);
    valeurs.forEach((valeur, colonne) => {
      const cellule = rangee.getCell(colonne + 1);
      cellule.style = structuredClone(styles[colonne]);
      // Tout CENTRÉ (2026-10-11, demande du porteur), horizontalement et verticalement.
      cellule.alignment = { ...(cellule.style.alignment ?? {}), horizontal: 'center', vertical: 'middle' };
      cellule.value = valeur ?? null;
    });
    rangee.commit();
  });

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: `Calendrier_EFM_DR_${anneeTexte}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
