import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireDocxIndividuel } from './exportIndividuelDocx.js';
import { nomFichierIndividuel } from './exportIndividuelTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from './libreOffice.js';

/** Le PDF de l'emploi individuel — le Word greffé, converti par LibreOffice. */
export async function construirePdfIndividuel(donnees) {
  const { tampon: docx } = await construireDocxIndividuel(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierIndividuel(donnees, 'pdf'),
    contentType: 'application/pdf',
  };
}

const CHEMIN_CANEVAS_PRECHAUFFAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'canevas',
  'emploiIndividuelFormateur.docx'
);
prechaufferLibreOffice(CHEMIN_CANEVAS_PRECHAUFFAGE);
