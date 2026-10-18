import { LIBELLES_NIVEAUX } from 'shared/domain';
import {
  CONTOUR,
  ESPACE,
  FOND,
  LARGEUR_UTILE,
  TAB,
  cellule,
  champPlein,
  deuxChamps,
  ligne,
  lignePointillee,
  paragraphe,
  partie,
  rangee,
  run,
  tableau,
} from './formulaireComposeDocx.js';

/**
 * ═══ LA DEMANDE DE DUPLICATA DU DIPLÔME (2026-10-17, demande du porteur,
 * `demande de duplicata (4) (2).docx`) ═══
 *
 * ⚠️ PAR STAGIAIRE, PRÉ-REMPLIE (2026-10-17, le porteur : « laisser le modal
 * de sélection groupe / stagiaire ») : une demande par stagiaire choisi —
 * nom, prénom, naissance, n° d'inscription (le CEF), CIN, niveau, filière et
 * établissement écrits ; la promotion, les raisons, le lieu, la date et la
 * signature restent à la main. Une donnée absente garde ses pointillés.
 * L'option « Imprimer vierge » de la fenêtre (2026-10-17) la sort VIDE — pour
 * un lauréat d'une année passée, absent de la base : voir `DOCUMENTS_VIERGES`.
 *
 * Le canevas transmis tenait dans des zones de texte et des
 * objets OLE (logo, intitulé arabe en WordArt) que LibreOffice rendait mal —
 * le cadre débordait sur la liste des pièces. Le formulaire est donc COMPOSÉ au
 * style des autres documents (`formulaireComposeDocx.js`), sur l'en-tête de
 * l'attestation de poursuite.
 *
 * ⚠️ DES LIGNES EN TABULATIONS À POINTS DE SUITE, pas en caractères « … » :
 * elles vont exactement jusqu'au bord, quelle que soit la longueur du libellé.
 */

const PIECES = [
  'Une déclaration de perte ;',
  'Une attestation de réussite ou une photocopie légalisée du diplôme ;',
  'Un extrait d’acte de naissance ;',
  'Une copie légalisée de la CIN.',
];

/**
 * Le corps : une demande par stagiaire, séparées par `sautDePage`. `_gabarit`
 * (le corps de l'attestation) n'est pas repris — seuls son en-tête et sa mise
 * en page le sont.
 */
export function corpsDemandeDuplicata(_gabarit, feuilles, sautDePage) {
  return feuilles
    .flatMap((feuille) => feuille.stagiaires.map((stagiaire) => page({ ...stagiaire, etablissement: feuille.etablissement })))
    .join(sautDePage);
}

function page(s) {
  const titre = tableau(
    [LARGEUR_UTILE],
    rangee(
      cellule(
        paragraphe(run('Formulaire de demande du duplicata du diplôme', { gras: true, taille: 30 }), { alignement: 'center', apres: 40 }) +
          paragraphe(run('(À remplir par le lauréat)', { taille: 20, italique: true }), { alignement: 'center', apres: 0 }),
        LARGEUR_UTILE,
        { bordures: CONTOUR(4), fond: FOND, marges: [140, 200] }
      )
    )
  );

  const laureat = partie(
    'Lauréat',
    deuxChamps(['Nom :', s.nom], ['Prénom :', s.prenom]) +
      deuxChamps(['Né(e) le :', s.dateNaissance], ['à :', s.lieuNaissance]) +
      deuxChamps(['N° d’inscription :', s.matricule], ['CIN :', s.cin]) +
      deuxChamps(['Niveau de formation :', LIBELLES_NIVEAUX[s.niveau] ?? s.niveau], ['Promotion :', '']) +
      champPlein(['Filière :', s.filiereLibelle]) +
      champPlein(['Etablissement :', s.etablissement], { apres: 0 })
  );

  const demande = partie(
    'Demande',
    paragraphe(run('Raisons de la demande de duplicata :', { gras: true }), { apres: 200 }) +
      Array.from({ length: 5 }, (_, rang) => lignePointillee(rang === 4 ? 0 : 200)).join('')
  );

  // Les pièces à joindre, dans un cadre clair — à lire avant de déposer la demande.
  const pieces = tableau(
    [LARGEUR_UTILE],
    rangee(
      cellule(
        paragraphe(run('NB : ', { gras: true, souligne: true }) + run('il faut joindre à cette demande les pièces suivantes :', { gras: true }), {
          apres: 80,
        }) +
          PIECES.map((piece, rang) =>
            paragraphe(run('–   ') + run(piece), { apres: rang === PIECES.length - 1 ? 0 : 40 })
          ).join(''),
        LARGEUR_UTILE,
        { bordures: CONTOUR(4), fond: FOND, marges: [120, 240] }
      )
    )
  );

  // « Fait à … Le … » à gauche, la signature à droite.
  const signature =
    ligne(run('Fait à : ') + TAB + run('   Le : ') + TAB + TAB + run('Signature du demandeur :', { gras: true }), [
      [3600, 'left', true],
      [6200, 'left', true],
      [LARGEUR_UTILE, 'right'],
    ], { apres: 0 }) + ESPACE(1400);

  return titre + ESPACE(300) + laureat + ESPACE(240) + demande + ESPACE(240) + pieces + ESPACE(480) + signature;
}
