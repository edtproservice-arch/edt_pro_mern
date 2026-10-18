import {
  CASE_VIDE,
  CONTOUR,
  ESPACE,
  FOND,
  LARGEUR_UTILE,
  PARAGRAPHE_MINUSCULE,
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
 * ═══ LE PV DE RÉORIENTATION (2026-10-17, demande du porteur, canevas transmis
 * `VF-Modèle PV Réorientation 2021.docx`) ═══
 *
 * ⚠️ AU STYLE DES AUTRES DOCUMENTS (2026-10-18, le porteur : « avec le même
 * style des autres documents ») : greffé d'abord dans son propre canevas — un
 * en-tête différent, des tableaux à cases —, le PV est désormais COMPOSÉ comme
 * la demande de duplicata (`formulaireComposeDocx.js`) : l'en-tête officiel de
 * l'attestation, un titre encadré, des parties encadrées à libellé vertical,
 * des lignes à points de suite. Les rubriques sont celles du canevas.
 *
 * Un PV par stagiaire choisi. Sont écrits : la rentrée, le complexe et l'EFP ;
 * le stagiaire — nom, prénom, CEF, CIN, date de naissance, filière d'origine.
 * Ce qui se décide en commission reste à la main : la date, le type de
 * réorientation, la filière d'accueil, la moyenne, les motifs, l'avis du CGCP.
 * Un champ rempli n'a pas de pointillés ; vide, il garde sa ligne de points.
 *
 * Imprimé VIERGE (option de la fenêtre), seuls la rentrée, le complexe et
 * l'EFP s'écrivent : voir `construireDocumentVierge`.
 */

function page(v, anneeScolaire) {
  const titre = tableau(
    [LARGEUR_UTILE],
    rangee(
      cellule(
        paragraphe(run('PV de réorientation', { gras: true, taille: 30 }), { alignement: 'center', apres: 40 }) +
          paragraphe(run(`Rentrée ${anneeScolaire}/${anneeScolaire + 1}`, { taille: 22, gras: true }), {
            alignement: 'center',
            apres: 0,
          }),
        LARGEUR_UTILE,
        { bordures: CONTOUR(4), fond: FOND, marges: [140, 200] }
      )
    )
  );

  const commission = partie(
    'Commission',
    champPlein(['Date :', '']) +
      champPlein(['Complexe de formation :', v.complexe]) +
      champPlein(['EFP :', v.efp]) +
      ligne(
        run('Type de réorientation :   ') + run(`${CASE_VIDE} Interne`) + run('            ') + run(`${CASE_VIDE} Externe`),
        [],
        { apres: 0 }
      )
  );

  const stagiaire = partie(
    'Stagiaire',
    deuxChamps(['Nom :', v.nom], ['Prénom :', v.prenom]) +
      deuxChamps(['CEF :', v.matricule], ['CIN :', v.cin]) +
      champPlein(['Date de naissance :', v.dateNaissance]) +
      champPlein(['Filière d’origine :', [v.filiereLibelle, v.groupe && `(${v.groupe})`].filter(Boolean).join(' ')]) +
      champPlein(['Filière d’accueil :', '']) +
      champPlein(['Moyenne générale (pour les bacheliers) :', ''], { apres: 0 })
  );

  const decision = partie(
    'Décision',
    paragraphe(run('Motifs de réorientation :', { gras: true }), { apres: 160 }) +
      Array.from({ length: 3 }, () => lignePointillee()).join('') +
      paragraphe(run('Avis du CGCP :', { gras: true }), { avant: 40, apres: 160 }) +
      Array.from({ length: 2 }, (_, rang) => lignePointillee(rang === 1 ? 0 : 200)).join('')
  );

  // Les trois signatures du canevas — titres en gras sur fond clair, comme les cases réservées de la fiche fils d'agent.
  const l = [3402, 3402, LARGEUR_UTILE - 2 * 3402];
  const marges = [80, 100];
  const titreSignature = (texte) => paragraphe(run(texte, { gras: true, taille: 19 }), { alignement: 'center', apres: 0 });
  const signatures = tableau(
    l,
    rangee(
      cellule(titreSignature('Signature et cachet du directeur de l’établissement'), l[0], { fond: FOND, vertical: 'center', marges }) +
        cellule(titreSignature('Signature et cachet du Conseiller en orientation'), l[1], { fond: FOND, vertical: 'center', marges }) +
        cellule(titreSignature('Signature et cachet du Chef de département ou Gestionnaire Stagiaire'), l[2], {
          fond: FOND,
          vertical: 'center',
          marges,
        })
    ) +
      rangee(
        cellule(PARAGRAPHE_MINUSCULE, l[0], { marges }) + cellule(PARAGRAPHE_MINUSCULE, l[1], { marges }) + cellule(PARAGRAPHE_MINUSCULE, l[2], { marges }),
        2000
      )
  );

  return (
    titre + ESPACE(300) + commission + ESPACE(240) + stagiaire + ESPACE(240) + decision + ESPACE(240) + signatures + PARAGRAPHE_MINUSCULE
  );
}

/**
 * Le corps : un PV par stagiaire, séparés par `sautDePage`. `_gabarit` (le
 * corps de l'attestation) n'est pas repris — seuls son en-tête et sa mise en
 * page le sont. Vierge (`stagiaires: [{}]`), le PV n'a que la rentrée, le
 * complexe et l'EFP.
 */
export function corpsPvReorientation(_gabarit, feuilles, sautDePage) {
  return feuilles
    .flatMap((feuille) =>
      feuille.stagiaires.map((stagiaire) =>
        page(
          { ...stagiaire, complexe: feuille.complexe, efp: feuille.efp, groupe: stagiaire.matricule ? feuille.groupe : '' },
          feuille.anneeScolaire
        )
      )
    )
    .join(sautDePage);
}
