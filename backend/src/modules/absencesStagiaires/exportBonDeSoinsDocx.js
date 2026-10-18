import { CONTOUR, ESPACE, FOND, LARGEUR_UTILE, TAB, cellule, ligne, paragraphe, rangee, rempli, run, tableau, valeur } from './formulaireComposeDocx.js';

/**
 * ═══ LE BON DE SOINS (2026-10-18, demande du porteur, canevas `Bon de soins.docx`) ═══
 *
 * ⚠️ UN BON PAR PAGE (2026-10-18, le porteur : « un seul exemplaire par page »),
 * là où le canevas en mettait deux à découper. Au style des autres documents
 * (`formulaireComposeDocx.js`) : l'EN-TÊTE officiel de l'attestation — qui dit
 * déjà « OFPPT » et l'établissement, d'où le « OFPPT / DRCN » et l'EFP du canevas
 * retirés —, « ………… le : … » à droite, un titre encadré sur fond clair, des
 * lignes à points de suite, les deux signatures.
 *
 * Par stagiaire : son nom et son groupe écrits, la date du jour ; l'hôpital, la
 * ville et le jour de la visite restent à la main. Vierge : tout en pointillés.
 * Un champ rempli n'a pas de pointillés.
 */

const MILIEU = 6400;

/** « 18/10/2026 » — le jour où le bon est délivré. */
function dateDuJour() {
  const maintenant = new Date();
  return [maintenant.getDate(), maintenant.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('/') + `/${maintenant.getFullYear()}`;
}

/** Un champ suivi de ses points jusqu'à `fin` — sans points s'il est rempli. */
const champ = (libelle, texte) => run(`${libelle} `) + valeur(texte) + (rempli(texte) ? '' : TAB);

function bon(v) {
  const delivre = v.matricule ? dateDuJour() : '';

  // « ………… le : … » à droite — la ville à la main, le jour de délivrance écrit.
  const entete = paragraphe(run('……………………… le : ') + (rempli(delivre) ? valeur(delivre) : run('……………………')), {
    alignement: 'right',
    apres: 300,
  });

  const titre = tableau(
    [LARGEUR_UTILE],
    rangee(
      cellule(paragraphe(run('Bon de soins', { gras: true, taille: 30 }), { alignement: 'center', apres: 0 }), LARGEUR_UTILE, {
        bordures: CONTOUR(4),
        fond: FOND,
        marges: [120, 200],
      })
    )
  );

  const nomComplet = `${v.nom ?? ''} ${v.prenom ?? ''}`.trim();
  const champs =
    // Deux tabulations vers « Groupe » : la première porte les points (si le nom manque), la seconde laisse l'écart.
    ligne(run('Le(a) nommé(e) : ') + valeur(nomComplet) + TAB + TAB + champ('Groupe :', v.matricule ? v.groupe : ''), [
      [MILIEU - 200, 'left', !rempli(nomComplet)],
      [MILIEU],
      [LARGEUR_UTILE, 'right', true],
    ]) +
    ligne(champ('Est autorisé(e) à se présenter à l’hôpital :', ''), [[LARGEUR_UTILE, 'right', true]]) +
    ligne(run('au service des Urgences, le : ') + TAB, [[MILIEU - 200, 'left', true]], { apres: 0 });

  const signatures =
    ligne(run('Gestionnaire des stagiaires', { gras: true }) + TAB + run('Médecin', { gras: true }), [[MILIEU + 600, 'left']], {
      apres: 0,
    }) + ESPACE(1100);

  return entete + titre + ESPACE(400) + champs + ESPACE(600) + signatures;
}

/** Le corps : un bon par stagiaire, une page chacun. `_gabarit` n'est pas repris. */
export function corpsBonDeSoins(_gabarit, feuilles, sautDePage) {
  return feuilles
    .flatMap((feuille) => feuille.stagiaires.map((stagiaire) => bon({ ...stagiaire, groupe: feuille.groupe })))
    .join(sautDePage);
}
