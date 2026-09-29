import { construireDocxEmargement } from './exportEmargementDocx.js';
import { nomFichierEmargement } from './exportEmargementTexte.js';
import { convertirDocxEnPdf } from './libreOffice.js';

/**
 * Le PDF de l'émargement journalier — le même Word, converti. ← même principe
 * que `exportGlobalPdf.js`, sur la même file de conversion partagée
 * (`libreOffice.js`) : les deux documents ne se marchent jamais dessus.
 */
export async function construirePdfEmargement(donnees) {
  const { tampon: docx } = await construireDocxEmargement(donnees);

  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierEmargement(donnees, 'pdf'),
    contentType: 'application/pdf',
  };
}
