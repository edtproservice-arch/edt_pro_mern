import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireDocxFeuilleAbsence } from './exportFeuilleAbsenceDocx.js';
import { nomFichierFeuilleAbsence } from './exportFeuilleAbsenceTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';

export async function construirePdfFeuilleAbsence(donnees) {
  const { tampon: docx } = await construireDocxFeuilleAbsence(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierFeuilleAbsence(donnees.feuilles.map((f) => f.groupe), donnees.semaine, 'pdf'),
    contentType: 'application/pdf',
  };
}

const CHEMIN_CANEVAS_PRECHAUFFAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'canevas', 'feuilleAbsenceHebdomadaire.docx');
prechaufferLibreOffice(CHEMIN_CANEVAS_PRECHAUFFAGE);
