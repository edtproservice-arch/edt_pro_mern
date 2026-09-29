import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireDocxGlobal } from './exportGlobalDocx.js';
import { nomFichierExport } from './exportGlobalTexte.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from './libreOffice.js';

/**
 * Le PDF de la « vue globale » — LE MÊME WORD, CONVERTI (2026-09-23, demande
 * du porteur : « utiliser LibreOffice pour convertir »). Aucun second rendu
 * HTML/CSS à tenir en phase avec le Word : `construireDocxGlobal()` greffe
 * déjà les données dans le canevas exact de l'établissement, et
 * `convertirDocxEnPdf()` (`libreOffice.js`, partagée avec l'émargement)
 * n'a plus qu'à l'imprimer tel quel.
 */
export async function construirePdfGlobal(donnees) {
  const { tampon: docx } = await construireDocxGlobal(donnees);

  return {
    tampon: await convertirDocxEnPdf(docx),
    nomFichier: nomFichierExport(donnees, 'pdf'),
    contentType: 'application/pdf',
  };
}

const CHEMIN_CANEVAS_PRECHAUFFAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'canevas',
  'emploiGlobalFormateur.docx'
);

prechaufferLibreOffice(CHEMIN_CANEVAS_PRECHAUFFAGE);
