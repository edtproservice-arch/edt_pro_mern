import { LIBELLES_NIVEAUX } from 'shared/domain';
import {
  CASE_VIDE,
  CONTOUR,
  ESPACE,
  FOND,
  LARGEUR_UTILE,
  PARAGRAPHE_MINUSCULE,
  cellule,
  champ,
  date,
  ligneAvecCases,
  paragraphe,
  partie,
  rangee,
  run,
  tableau,
} from './formulaireComposeDocx.js';

/**
 * ═══ LA FICHE DU CANDIDAT FILS D'AGENT OFPPT (2026-10-17, demande du porteur,
 * Annexe 14 du code d'admission 25-26, transmise en PDF) ═══
 *
 * ⚠️ AU STYLE DES AUTRES DOCUMENTS (2026-10-17, le porteur : « le même style
 * que les autres documents, avec l'en-tête ») : la fiche se greffe sur le
 * canevas de l'attestation de poursuite — son EN-TÊTE officiel (logo OFPPT,
 * intitulé en arabe et en français, nom de l'établissement) —, et son corps
 * reprend la forme du formulaire de transfert : un titre encadré sur fond
 * clair, puis des parties encadrées, leur nom écrit à la verticale à gauche.
 * L'annexe n'existant qu'en PDF, ce corps est COMPOSÉ ici ; le corps du
 * canevas (celui de l'attestation) est ignoré.
 *
 * ⚠️ TÉLÉCHARGÉE VIERGE (2026-10-17, le porteur : « seulement un canevas vide,
 * sans sélectionner le groupe et le stagiaire ») : la page Documents demande un
 * stagiaire sans aucun champ, et tout reste en pointillés et en cases vides.
 * Donnés, nom, prénom, CEF, CNI, date de naissance, niveau, établissement et
 * filière s'écriraient à leur place ; la date du dépôt et le bloc PARENT
 * restent toujours à la main.
 */

function page(stagiaire) {
  const niveau = LIBELLES_NIVEAUX[stagiaire.niveau] ?? stagiaire.niveau ?? '';

  // La provenance de l'annexe, puis le titre encadré — comme « Demande de Transfert ».
  // ⚠️ À GAUCHE, en italique noir et sans « Annexe 14 » (2026-10-17, modèle retouché par le porteur).
  const titre =
    paragraphe(run('Direction de la Formation · Division Orientation et Suivi de l’Insertion', { taille: 20, italique: true }), {
      apres: 60,
    }) +
    tableau(
      [LARGEUR_UTILE],
      rangee(
        cellule(
          paragraphe(run('Fiche du candidat Fils d’Agent OFPPT', { gras: true, taille: 30 }), { alignement: 'center', apres: 40 }) +
            paragraphe(
              run('A ajouter aux pièces du dossier d’inscription et à communiquer à la DR le jour du dépôt du dossier', {
                taille: 18,
                italique: true,
              }),
              { alignement: 'center', apres: 0 }
            ),
          LARGEUR_UTILE,
          { bordures: CONTOUR(4), fond: FOND, marges: [140, 200] }
        )
      )
    ) +
    ESPACE(300);

  const candidat = partie(
    'Candidat',
    paragraphe(champ('Nom :', stagiaire.nom)) +
      paragraphe(champ('Prénom :', stagiaire.prenom)) +
      ligneAvecCases(run('CEF :'), stagiaire.matricule, 10, run('Date de naissance : ') + date(stagiaire.dateNaissance)) +
      ligneAvecCases(run('CNI :'), stagiaire.cin, 10) +
      paragraphe(champ('Niveau de Formation :', niveau)) +
      paragraphe(champ('Etablissement :', stagiaire.etablissement)) +
      paragraphe(champ('Filières :', stagiaire.filiereLibelle)) +
      paragraphe(run('Date du dépôt du dossier : ') + date(''), { apres: 0 })
  );

  const parent = partie(
    'Parent',
    // « Matricule : » et ses sept cases, sur la ligne du nom — comme l'annexe.
    ligneAvecCases(run('Nom : ') + run('…………………………………………………', { couleur: '7F7F7F' }) + run('   Matricule :'), '', 7, null, 5300) +
      paragraphe(champ('Prénom :', '')) +
      paragraphe(champ('Affectation :', '')) +
      paragraphe(
        run('Lien de parenté avec le(a) candidat(e) :   ') + run(`${CASE_VIDE} Père`) + run('          ') + run(`${CASE_VIDE} Mère`),
        { apres: 160 }
      ) +
      paragraphe(run('Signature :', { gras: true }), { alignement: 'right', apres: 520 })
  );

  // Les cases réservées : l'EFP à gauche, la DR (RRH, SRIO, DR) à droite — titres en gras sur fond clair.
  const l = [2706, 2500, 2500, LARGEUR_UTILE - 2706 - 2 * 2500];
  const entete = (texte, note = null) =>
    paragraphe(run(texte, { gras: true, taille: 20 }), { alignement: 'center', apres: 0 }) +
    (note ? paragraphe(run(note, { taille: 14, italique: true }), { alignement: 'center', apres: 0 }) : '');
  const visa = (texte) => paragraphe(run(texte, { gras: true, taille: 18 }), { alignement: 'center', apres: 0 });
  const marges = [80, 100];
  const reserve = tableau(
    l,
    rangee(
      cellule(entete('Case réservée à l’EFP'), l[0], { fond: FOND, vertical: 'center', marges }) +
        cellule(
          entete('Case réservée à la DR', 'La transmission à la DF doit s’effectuer avec le PV de la commission régionale'),
          l[1] + l[2] + l[3],
          { fusion: 3, fond: FOND, vertical: 'center', marges }
        )
    ) +
      rangee(
        cellule(paragraphe(run('Date de transmission à la DR :', { taille: 19 }), { apres: 0 }), l[0], { marges }) +
          cellule(paragraphe(run('Date de transmission à la DF :', { taille: 19 }), { apres: 0 }), l[1] + l[2] + l[3], {
            fusion: 3,
            marges,
          }),
        620
      ) +
      rangee(
        cellule(
          visa('Signature et cachet du Directeur de l’établissement') +
            paragraphe(
              run('Important', { gras: true, souligne: true, taille: 14 }) +
                run(' : une copie de la demande doit être archivée dans le dossier du candidat.', { taille: 14 }),
              { avant: 1500, apres: 0 }
            ),
          l[0],
          { marges }
        ) +
          cellule(visa('Signature et cachet du RRH'), l[1], { marges }) +
          cellule(visa('Cachet et signature du SRIO'), l[2], { marges }) +
          cellule(visa('Cachet et signature du DR'), l[3], { marges }),
        2300
      )
  );

  return titre + candidat + ESPACE(240) + parent + ESPACE(240) + reserve + PARAGRAPHE_MINUSCULE;
}

/**
 * Le corps du document : une fiche par stagiaire, séparées par `sautDePage`.
 * `_gabarit` (le corps de l'attestation) n'est pas repris — seuls l'en-tête et
 * la mise en page du canevas le sont.
 */
export function corpsFicheFilsAgent(_gabarit, feuilles, sautDePage) {
  return feuilles
    .flatMap((feuille) => feuille.stagiaires.map((stagiaire) => page({ ...stagiaire, etablissement: feuille.etablissement })))
    .join(sautDePage);
}
