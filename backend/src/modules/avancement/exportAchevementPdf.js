import { construireDocxAchevement } from './exportAchevementDocx.js';
import { nomFichierAchevement } from './exportAchevementTexte.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';

/** Le PDF : le Word, converti par LibreOffice — un seul rendu à tenir. */
export async function construirePdfAchevement(donnees) {
  const { tampon: docx } = await construireDocxAchevement(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierAchevement('pdf'),
    contentType: 'application/pdf',
  };
}
