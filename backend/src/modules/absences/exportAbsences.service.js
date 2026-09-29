import { dureeSeance } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import * as absencesService from './absences.service.js';
import { construireDocxAbsences } from './exportAbsencesDocx.js';
import { construireXlsxAbsences } from './exportAbsencesXlsx.js';
import { construirePdfAbsences } from './exportAbsencesPdf.js';
import { libelleSemaineAnnee } from './exportAbsencesTexte.js';

/**
 * Export Word / PDF / Excel du registre des absences — ← demande du porteur
 * (2026-09-29) : « en absence je veux ajouter qu'il être exporté en Word et
 * PDF et Excel à l'aide de LibreOffice », canevas Word « Rapport_Absences »
 * transmis.
 *
 * ═══ ⚠️ MÊME FILTRE QUE L'ÉCRAN, RIEN N'EST RECALCULÉ ═══ `absences.service.js#lister`
 * est la MÊME fonction qui alimente le registre de la page Absences ; le
 * fichier téléchargé montre donc exactement ce que l'écran montrait au moment
 * du clic — « Toutes », « Sans rattrapage » ou « Rattrapées ».
 */
export async function construireExportAbsences(etablissementId, anneeScolaire, options) {
  const { format, rattrapees } = options;

  const [lignes, etablissement] = await Promise.all([
    absencesService.lister(etablissementId, anneeScolaire, rattrapees === undefined ? {} : { rattrapees }),
    Etablissement.findById(etablissementId).select('nom').lean(),
  ]);

  if (lignes.length === 0) {
    throw badRequest('Aucune absence à exporter pour ce filtre', { code: 'EXPORT_VIDE' });
  }

  // ⚠️ LA MÊME DURÉE QUE PARTOUT AILLEURS (`dureeSeance`, shared/domain) : 2,5 h
  // le jour, jamais recalculée ici.
  const heures = lignes.reduce((total, ligne) => total + dureeSeance(ligne.seance), 0);

  const donnees = {
    etablissement: etablissement ?? {},
    genereLe: new Date(),
    nombreSeances: lignes.length,
    heures,
    // ⚠️ « 2026-S4 », PAS L'IDENTIFIANT INTERNE « 2026-W4 » (2026-09-29,
    // demande du porteur) — voir `libelleSemaineAnnee`.
    lignes: lignes.map((ligne) => ({ ...ligne, semaine: libelleSemaineAnnee(ligne.semaine) })),
  };

  if (format === 'docx') return construireDocxAbsences(donnees);
  if (format === 'xlsx') return construireXlsxAbsences(donnees);
  return construirePdfAbsences(donnees);
}
