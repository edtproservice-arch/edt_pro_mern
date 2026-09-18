import { ROLES } from 'shared/constants';

/**
 * Le vocabulaire des rôles, en un seul endroit.
 *
 * ═══ ⚠️ IL EXISTAIT EN TROIS EXEMPLAIRES ═══ (2026-09-02.) `StatistiquesAdmin`,
 * `TableauActivite` et le tableau des directeurs portaient chacun leur table de
 * libellés — et le troisième affichait la valeur BRUTE (« formateur »), là où
 * les deux autres écrivaient « Formateur ». Le même compte se lisait donc de
 * deux façons d'un écran à l'autre. C'est la cause n°1 d'instabilité du §4.2,
 * appliquée à cinq mots.
 */
export const LIBELLES_ROLE = {
  [ROLES.ADMIN]: 'Administrateur',
  [ROLES.DIRECTEUR]: 'Directeur',
  [ROLES.GESTIONNAIRE]: 'Gestionnaire',
  [ROLES.FORMATEUR]: 'Formateur',
  [ROLES.STAGIAIRE]: 'Stagiaire',
};

export const libelleRole = (role) => LIBELLES_ROLE[role] ?? role;

/**
 * ⚠️ L'ORDRE EST CELUI DE LA HIÉRARCHIE, pas celui de l'alphabet : une liste qui
 * commence par « Formateur » et finit par « Stagiaire » ne se lit pas comme une
 * organisation.
 */
export const ORDRE_ROLES = [
  ROLES.ADMIN,
  ROLES.DIRECTEUR,
  ROLES.GESTIONNAIRE,
  ROLES.FORMATEUR,
  ROLES.STAGIAIRE,
];

/**
 * La couleur d'un rôle, pour les GRAPHIQUES.
 *
 * ⚠️ `hsl(var(--…))`, PAS UNE CLASSE TAILWIND : recharts écrit un attribut SVG
 * `fill`, qui ne comprend pas les classes. Les variables, elles, se résolvent.
 *
 * ⚠️ LA PALETTE EST LA DÉCORATIVE (`accent-*`), jamais le bleu structurel :
 * celui-ci désigne l'action dans tout le produit, et cinq parts bleutées le
 * videraient de son sens.
 */
export const COULEURS_ROLE = {
  [ROLES.ADMIN]: 'hsl(var(--accent-purple-mid))',
  [ROLES.DIRECTEUR]: 'hsl(var(--accent-sky-deep))',
  [ROLES.GESTIONNAIRE]: 'hsl(var(--accent-teal))',
  [ROLES.FORMATEUR]: 'hsl(var(--accent-orange))',
  [ROLES.STAGIAIRE]: 'hsl(var(--accent-green))',
};

/**
 * La même famille de teintes, en classes, pour l'AVATAR d'un tableau.
 *
 * ⚠️ DEUX ÉCRITURES D'UNE MÊME PALETTE, ET C'EST INÉVITABLE : un `<Cell>` de
 * recharts ne prend qu'une couleur CSS résolue, un élément HTML ne prend qu'une
 * classe — Tailwind ne génère jamais un nom composé à l'exécution. Les deux
 * tables sont donc côte à côte, pour qu'un rôle ajouté à l'une saute aux yeux
 * dans l'autre.
 *
 * ⚠️ ET LA TEINTE N'EST QU'UN APPUI, jamais le seul porteur du rôle : la colonne
 * « Rôle » l'écrit en toutes lettres juste à côté. Un daltonien lit le mot.
 */
export const TEINTE_ROLE = {
  [ROLES.ADMIN]: 'bg-accent-purple/25 text-accent-purple-deep',
  [ROLES.DIRECTEUR]: 'bg-accent-sky/25 text-accent-sky-deep',
  [ROLES.GESTIONNAIRE]: 'bg-accent-teal/20 text-accent-teal',
  [ROLES.FORMATEUR]: 'bg-accent-orange/20 text-accent-orange-deep',
  [ROLES.STAGIAIRE]: 'bg-accent-green/20 text-accent-green-deep',
};

export const teinteRole = (role) => TEINTE_ROLE[role] ?? 'bg-muted text-muted-foreground';
