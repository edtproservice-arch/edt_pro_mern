import {
  LARGEUR_UTILE_PAYSAGE,
  SAUT_DE_PAGE,
  construireDocxPaysage,
  paragraphe,
  tableau,
} from '../avancement/exportAchevementDocx.js';
import { colonnesNotes } from './exportNotesDisciplineTexte.js';

/**
 * Le Word des notes de discipline : l'en-tête officiel (celui de l'achèvement
 * des modules), puis UNE PAGE PAR GROUPE — son examen et le tableau de ses
 * stagiaires, ligne d'en-tête répétée s'il déborde.
 * Le PDF en est la conversion (`exportNotesDiscipline.service.js`).
 */
export async function construireDocxNotesDiscipline({ etablissement, anneeScolaire, feuilles }) {
  const pages = feuilles.map(({ groupe, examen, stagiaires }) => {
    const passage = examen?.type !== 'fin';
    const colonnes = colonnesNotes(passage);
    const somme = colonnes.reduce((total, c) => total + c.poids, 0);
    const largeurs = colonnes.map((c) => Math.floor((c.poids / somme) * LARGEUR_UTILE_PAYSAGE));
    const centrees = new Set(colonnes.filter((c) => !c.gauche).map((c) => c.id));
    const lignes = stagiaires.map((s, index) => colonnes.map((c) => texte(c.valeur(s, index))));

    /*
     * ⚠️ LE CANEVAS DU PORTEUR (2026-10-11, « respect ce canvas ») : l'année,
     * le groupe, le tableau — sans ligne de résumé (effectif, sanctionnés,
     * examen) —, puis « Gestionnaire de stagiaire : » pour la signature.
     */
    return (
      paragraphe(`Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`, { centre: true, apres: 40 }) +
      paragraphe(`Groupe ${groupe}`, { gras: true, taille: 24, centre: true, apres: 120 }) +
      tableau(colonnes, lignes, { largeurs, centrees }) +
      paragraphe('Gestionnaire de stagiaire :', { taille: 20, avant: 240, apres: 0 })
    );
  });

  return construireDocxPaysage({
    etablissement,
    titre: 'Notes de discipline',
    enteteCompact: true,
    corps: pages.join(SAUT_DE_PAGE),
  });
}

/** « 9,5 » — l'écriture française des notes ; `null` (pas de /20) en tiret. */
function texte(valeur) {
  if (valeur === null || valeur === undefined) return '—';
  return typeof valeur === 'number' ? String(valeur).replace('.', ',') : String(valeur);
}
