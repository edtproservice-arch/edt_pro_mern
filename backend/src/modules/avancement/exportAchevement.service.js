import { Etablissement } from '../../models/Etablissement.js';
import { construireDocxAchevement } from './exportAchevementDocx.js';
import { construirePdfAchevement } from './exportAchevementPdf.js';
import { construireXlsxAchevement } from './exportAchevementXlsx.js';

/**
 * Le détail « Achèvement des modules » en Word, PDF ou Excel (2026-10-07,
 * demande du porteur).
 *
 * ⚠️ L'ÉCRAN ENVOIE SES LIGNES DÉJÀ MISES EN TEXTE — filtre de la fenêtre,
 * dates, « En cours (83 %) » et source compris. Le serveur ne fait que la mise
 * en page : recalculer ici aurait été une seconde lecture des mêmes règles,
 * libre de diverger de ce que la fenêtre montre.
 */
export async function construireExportAchevement({ etablissementId, anneeScolaire, format, ...contenu }) {
  const etablissement = await Etablissement.findById(etablissementId).select('nom').lean();
  const donnees = { etablissement: etablissement ?? {}, anneeScolaire, ...contenu };

  if (format === 'docx') return construireDocxAchevement(donnees);
  if (format === 'xlsx') return construireXlsxAchevement(donnees);
  return construirePdfAchevement(donnees);
}
