import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { construireDocxPeriodes } from './exportPeriodesDocx.js';
import { construireXlsxPeriodes } from './exportPeriodesXlsx.js';
import { grilleGantt } from './exportPeriodesGantt.js';
import { joursFeries, obtenir as obtenirCalendrier } from '../calendrier/calendrier.service.js';
import { TYPES_PERIODES, nombreJours, nomFichierPeriodes } from './exportPeriodesTexte.js';

/**
 * Les périodes de stage (par groupe) ou de formation (par formateur), en Word,
 * PDF ou Excel (2026-10-10, demande du porteur).
 *
 * ═══ ⚠️ LA LISTE DE L'ÉCRAN, PAS CELLE DE LA BASE ═══ Comme l'affectation d'un
 * formateur, l'écran envoie ce qu'il affiche — ajouts pas encore enregistrés
 * compris, et le MODE de chaque groupe déjà résolu (un groupe sans mode est
 * résidentiel, règle que seul l'écran applique ici). Le document dit donc
 * exactement ce que la liste montre.
 *
 * Une ligne par période ; le sujet n'est écrit qu'une fois, en tête de ses
 * périodes (cellule fusionnée verticalement dans le Word) — la présentation de
 * la liste à l'écran, un sujet par ligne.
 */
export async function construireExportPeriodes({ etablissementId, anneeScolaire, type, format, periodes, affichage = 'liste' }) {
  if (periodes.length === 0) {
    throw badRequest('Aucune période à exporter', { code: 'PERIODES_VIDES' });
  }

  const etablissement = await Etablissement.findById(etablissementId).select('nom').lean();

  const parSujet = new Map();
  for (const periode of periodes) {
    if (!parSujet.has(periode.sujet)) parSujet.set(periode.sujet, { sujet: periode.sujet, detail: '', periodes: [] });
    const entree = parSujet.get(periode.sujet);
    entree.detail ||= periode.detail ?? '';
    entree.periodes.push({ debut: periode.debut, fin: periode.fin, jours: nombreJours(periode) });
  }

  const sujets = [...parSujet.values()]
    .map((entree) => ({
      ...entree,
      periodes: entree.periodes.sort((a, b) => a.debut.localeCompare(b.debut)),
      jours: entree.periodes.reduce((total, p) => total + p.jours, 0),
    }))
    .sort((a, b) => a.sujet.localeCompare(b.sujet, 'fr', { numeric: true }));

  const donnees = {
    type,
    libelles: TYPES_PERIODES[type],
    etablissement: etablissement ?? {},
    anneeScolaire,
    sujets,
    totalPeriodes: periodes.length,
    totalJours: sujets.reduce((total, s) => total + s.jours, 0),
  };

  /*
   * ═══ EN MODE CALENDRIER, LE GANTT EN PLUS (2026-10-10) ═══ L'écran affichait
   * la frise : le document la reprend SEULE (par semaine, sous les mois).
   */
  if (affichage === 'calendrier' && Number.isInteger(anneeScolaire)) {
    const [calendrier, feries] = await Promise.all([
      obtenirCalendrier(etablissementId, anneeScolaire).catch(() => null),
      joursFeries(etablissementId, anneeScolaire).catch(() => null),
    ]);
    donnees.gantt = grilleGantt(donnees, { ...calendrier, joursFeries: feries?.joursFeries ?? [] });
  }

  if (format === 'xlsx') return construireXlsxPeriodes(donnees);

  const docx = await construireDocxPeriodes(donnees);
  if (format === 'docx') return docx;

  // Le PDF : le Word, converti par LibreOffice — un seul rendu à tenir, comme les autres exports.
  return {
    tampon: await convertirDocxEnPdf(docx.tampon),
    nomFichier: nomFichierPeriodes(type, anneeScolaire, 'pdf'),
    contentType: 'application/pdf',
  };
}
