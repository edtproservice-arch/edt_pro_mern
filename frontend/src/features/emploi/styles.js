/**
 * Classes partagées par la grille et ses cases.
 *
 * ⚠️ DANS UN MODULE À PART, PAS DANS `GrilleEmploi`. La grille importe la case,
 * et la case a besoin de ces classes : les y laisser créait un cycle d'imports
 * — qui « marche » en ESM jusqu'au jour où l'ordre d'évaluation change et rend
 * la constante `undefined` sans la moindre erreur.
 */

/**
 * Le trait qui SÉPARE DEUX JOURS.
 *
 * Plus épais, plus foncé ET EN POINTILLÉS : sur 24 colonnes de même largeur,
 * une hairline identique partout ne dit plus où le mardi finit, et un trait
 * plein se lisait comme une bordure de tableau de plus. Le pointillé dit
 * « séparation », pas « limite ».
 *
 * ⚠️ `[border-right-style:dashed]` et non `border-dashed` : celui-ci porte sur
 * les QUATRE côtés, et rendrait aussi pointillée la bordure basse de chaque
 * ligne — toute la grille se serait mise à clignoter.
 *
 * Il est posé sur les TROIS étages du tableau — deux rangées d'en-tête et le
 * corps — et trois copies auraient dérivé, le trait tombant alors d'une colonne
 * à côté selon l'étage.
 */
export const SEPARATION_JOUR =
  'border-r-2 border-r-slate-300 [border-right-style:dashed] dark:border-r-slate-600';

/**
 * Le trait PLEIN qui structure l'EN-TÊTE, d'un jour à l'autre.
 *
 * ⚠️ CE N'EST PAS LE MÊME RÔLE QUE DANS LE CORPS. En tête, le trait ENCADRE le
 * jour — c'est lui qui donne sa structure au tableau depuis qu'il n'a plus de
 * fond ; dans le corps, il ne fait que séparer deux colonnes de saisie, d'où le
 * pointillé.
 */
export const BORD_PLEIN = 'border-r-2 border-r-slate-300 dark:border-r-slate-600';

/**
 * Les deux EXTRÉMITÉS du tableau : le trait qui suit la colonne d'intitulés, et
 * celui qui ferme la dernière colonne.
 *
 * ⚠️ SIMPLE, PAS ÉPAIS (2026-08-26, demande du porteur). Ils portaient le trait
 * de 2 px des séparations de jour — or ils ne séparent aucun jour : le premier
 * borde les en-têtes de ligne, le dernier est le bord du tableau, que le cadre
 * arrondi dessine déjà. Doublés en épaisseur, ils encadraient la semaine plus
 * fort que les jours eux-mêmes, et l'œil s'arrêtait aux bords au lieu de suivre
 * les colonnes.
 *
 * ⚠️ VAUT POUR LES DEUX ÉTAGES — en-tête ET corps. Le corps, lui, garde ses
 * pointillés ENTRE les jours : c'est ce que la demande précise.
 */
export const BORD_TABLEAU = 'border-r';

/** Intitulés de ligne, abrégés : « Formateur » n'entre pas dans 2,25 rem. */
export const ABREGES = { Formateur: 'Frm', Groupe: 'Grp', Module: 'Mod', Salle: 'Sal' };
