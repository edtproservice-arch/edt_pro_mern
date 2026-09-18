import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initiales } from '@/lib/initiales';
import { teinteRole } from './roles';

/**
 * La colonne « Utilisateur » d'un tableau de comptes : pastille d'initiales,
 * nom, adresse. (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ UN SEUL COMPOSANT POUR LES DEUX TABLEAUX ═══
 * « Directeurs » et « Statistiques » montrent les mêmes personnes sous deux
 * angles. Écrire deux fois cette cellule, c'était la garantie qu'elles
 * divergeraient au premier ajustement — et l'une d'elles est déjà partie de son
 * côté sur les libellés de rôle (cf. `roles.js`).
 *
 * ═══ ⚠️ CIRCULAIRE ICI, CARRÉE DANS LA BARRE ═══ (les deux demandés par le
 * porteur, et ce n'est pas une contradiction.) Dans la barre de navigation,
 * l'avatar est un BOUTON, aligné sur deux autres boutons carrés — un rond s'y
 * lisait comme un objet d'une autre famille. Ici il n'est pas cliquable : c'est
 * une VIGNETTE dans une liste de personnes, et le rond est la forme qui dit
 * « quelqu'un » partout ailleurs.
 *
 * ⚠️ ELLE NE PORTE AUCUNE INFORMATION QUE LA LIGNE N'AIT DÉJÀ : les initiales
 * viennent du nom écrit à côté, la teinte du rôle écrit dans la colonne
 * suivante. Elle sert à RETROUVER une ligne d'un coup d'œil en parcourant, pas à
 * apprendre quelque chose de neuf — d'où `aria-hidden`, qui évite à un lecteur
 * d'écran de relire deux lettres avant chaque nom.
 */
export default function CelluleUtilisateur({ compte }) {
  return (
    <div className="flex items-center gap-3">
      {/* ⚠️ `h-9 w-9`, PAS `size-9` : le composant pose déjà `h-10 w-10`, et
          tailwind-merge n'arbitre un conflit qu'entre propriétés de MÊME nom —
          une classe raccourcie laisserait les deux en place, la dernière
          déclarée dans la feuille l'emportant au hasard. */}
      <Avatar aria-hidden="true" className="h-9 w-9 shrink-0">
        <AvatarFallback className={`text-xs font-semibold ${teinteRole(compte.role)}`}>
          {initiales(compte.nomComplet)}
        </AvatarFallback>
      </Avatar>

      {/* ⚠️ `min-w-0` : sans lui, une adresse longue élargit la colonne au lieu
          de se tronquer — un enfant de flex refuse de descendre sous la largeur
          de son contenu. */}
      <div className="min-w-0">
        <div className="truncate font-medium">{compte.nomComplet}</div>
        <div className="truncate text-sm text-muted-foreground">{compte.email}</div>
      </div>
    </div>
  );
}
