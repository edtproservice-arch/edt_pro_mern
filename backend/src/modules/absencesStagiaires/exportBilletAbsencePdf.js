import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireDocxBilletsAbsence } from './exportBilletAbsenceDocx.js';
import { nomFichierBillets } from './exportBilletAbsenceTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';

export async function construirePdfBilletsAbsence(donnees) {
  const { tampon: docx } = await construireDocxBilletsAbsence(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierBillets(donnees.billets, 'pdf'),
    contentType: 'application/pdf',
  };
}

const CHEMIN_CANEVAS_PRECHAUFFAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'canevas', 'billetAbsence.docx');
prechaufferLibreOffice(CHEMIN_CANEVAS_PRECHAUFFAGE);
