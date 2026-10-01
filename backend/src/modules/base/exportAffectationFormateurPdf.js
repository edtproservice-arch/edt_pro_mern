import { CHEMIN_CANEVAS_AFFECTATION, construireDocxAffectationFormateur } from './exportAffectationFormateurDocx.js';
import { nomFichierAffectation } from './exportAffectationFormateurTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';

/** Le PDF : le Word, converti par LibreOffice — un seul rendu à tenir, comme les autres exports. */
export async function construirePdfAffectationFormateur(donnees) {
  const { tampon: docx } = await construireDocxAffectationFormateur(donnees);
  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierAffectation(donnees.formateur, 'pdf'),
    contentType: 'application/pdf',
  };
}

prechaufferLibreOffice(CHEMIN_CANEVAS_AFFECTATION);
