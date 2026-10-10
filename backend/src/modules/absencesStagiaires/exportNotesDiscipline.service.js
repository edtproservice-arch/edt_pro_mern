import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { notesDesGroupes } from './discipline.service.js';
import { construireDocxNotesDiscipline } from './exportNotesDisciplineDocx.js';
import { construireXlsxNotesDiscipline } from './exportNotesDisciplineXlsx.js';

/**
 * Les NOTES DE DISCIPLINE, groupe par groupe, en Word, PDF ou Excel
 * (2026-10-11, demande du porteur : « la liste des stagiaires par groupe avec
 * la note de discipline »). Une page — ou un onglet — par groupe, les mêmes
 * colonnes que le tableau de l'onglet « Notes de discipline ».
 *
 * ⚠️ LE CALCUL EST CELUI DE L'ÉCRAN (`notesDesGroupes` → `noteDiscipline`) :
 * le document ne refait aucune règle. La règle de calcul n'y est pas rappelée
 * (2026-10-11, demande du porteur : « supprime ce commentaire »).
 *
 * ⚠️ « /20 » SEULEMENT POUR LES GROUPES DE 1ʳᵉ ANNÉE (examen de passage) : en
 * fin de formation la note reste sur 15, comme à l'écran.
 */
export async function construireExportNotesDiscipline(etablissementId, anneeScolaire, { format, groupes }) {
  const [feuilles, etablissement] = await Promise.all([
    notesDesGroupes(etablissementId, anneeScolaire, groupes),
    Etablissement.findById(etablissementId).select('nom').lean(),
  ]);
  if (feuilles.length === 0) {
    throw badRequest('Aucun stagiaire dans les groupes demandés', { code: 'GROUPE_VIDE' });
  }

  const donnees = { etablissement: etablissement ?? {}, anneeScolaire, feuilles };
  const nom =
    feuilles.length === 1 ? `Notes_discipline_${feuilles[0].groupe}` : `Notes_discipline_${feuilles.length}_groupes`;

  if (format === 'xlsx') {
    return {
      tampon: await construireXlsxNotesDiscipline(donnees),
      nomFichier: `${nom}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const docx = await construireDocxNotesDiscipline(donnees);
  if (format === 'docx') {
    return {
      tampon: docx,
      nomFichier: `${nom}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return { tampon: await convertirDocxEnPdf(docx), nomFichier: `${nom}.pdf`, contentType: 'application/pdf' };
}
