import PageAffectations from './PageAffectations';

/**
 * Carte d'établissement — configuration de la filière et génération des groupes.
 * ← le bloc 1 de la carte d'affectations, déplacé ici à la demande du porteur
 *   (2026-09-19).
 *
 * ⚠️ CE N'EST PAS UNE SECONDE PAGE DE CARTE : c'est `PageAffectations` en variante
 * « carte ». La carte est enregistrée d'un bloc, avec la version de la base, par
 * un seul code — le dupliquer ferait deux enregistreurs concurrents.
 */
export default function PageCarte() {
  return <PageAffectations variante="carte" />;
}
