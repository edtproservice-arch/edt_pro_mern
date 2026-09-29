import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireDocxAbsences } from './exportAbsencesDocx.js';
import { nomFichierAbsences } from './exportAbsencesTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';

/** Le PDF du rapport des absences — le Word greffé, converti par LibreOffice. */
export async function construirePdfAbsences(donnees) {
  const { tampon: docx } = await construireDocxAbsences(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierAbsences('pdf'),
    contentType: 'application/pdf',
  };
}

const CHEMIN_CANEVAS_PRECHAUFFAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'canevas',
  'rapportAbsences.docx'
);
prechaufferLibreOffice(CHEMIN_CANEVAS_PRECHAUFFAGE);
