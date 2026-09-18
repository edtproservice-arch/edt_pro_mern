/**
 * Le vocabulaire visuel PARTAGÉ par les grilles de l'application —
 * chronogramme et emploi du temps.
 *
 * ═══ ⚠️ POURQUOI UN MODULE COMMUN ═══
 * Ces deux écrans montrent la même chose sous deux angles : des séances posées
 * dans le temps. Les habiller séparément, c'est fabriquer deux dialectes qu'il
 * faut réapprendre en passant de l'un à l'autre — et qui divergeront au premier
 * ajustement. C'est le constat §4.2 du plan, appliqué à la mise en forme.
 *
 * Les valeurs viennent de `GrilleChronogramme`, qui les portait en premier.
 */

/** Une séance PRÉSENTIELLE posée. */
export const FOND_PRESENTIEL = 'bg-accent-green/15';

/** Une séance SYNCHRONE — le violet Teams, comme sur la carte d'affectations. */
export const FOND_SYNCHRONE = 'bg-accent-purple/25';

/** Vacances : la colonne est fermée pour tout l'établissement. */
export const FOND_VACANCES = 'bg-primary/10';

/**
 * Jour férié, ou semaine amputée. ⚠️ L'ambre signale un plafond RÉDUIT, pas un
 * blocage : la saisie y reste possible.
 */
export const FOND_REDUIT = 'bg-warning/25';

/**
 * Les DEUX absences — quelqu'un n'est pas là.
 *
 * ═══ ⚠️ MÊME POIDS, DEUX TEINTES ═══
 * Stage et formation sont de même nature : seule change la PORTÉE — un groupe
 * d'un côté, une personne de l'autre. Ils doivent donc peser pareil à l'œil.
 * Le rose était à 15 % quand le cyan est un aplat plein : sur une case de 34 px
 * il ne se voyait pratiquement pas, et la ligne d'un formateur en formation
 * passait pour une ligne ordinaire. Les deux sont désormais équilibrés.
 *
 * ═══ ⚠️ POURQUOI CES DEUX TEINTES-LÀ, ET PAS D'AUTRES ═══
 * La grille a déjà cinq couleurs qui veulent dire quelque chose : le BLEU pour
 * les vacances et la sélection, l'AMBRE pour les fériés, le VERT pour une séance
 * en présentiel, le VIOLET pour une séance à distance, le ROUGE pour un
 * formateur absent. Il ne restait que le MAGENTA et le GRIS.
 *
 * ⚠️ LE CYAN A ÉTÉ ABANDONNÉ (2026-08-25, signalé par le porteur) : posé à côté
 * du bleu pâle des vacances, on ne les distinguait plus — deux fermetures de
 * NATURE DIFFÉRENTE se lisaient comme la même chose.
 *
 * ═══ ⚠️ STAGE ET FORMATION PARTAGENT LE MÊME GRIS ═══
 * (2026-08-26, demande du porteur — REVIENT sur le magenta du 2026-08-25 :
 * « changer la couleur du stage en gris PARTOUT, en chronogramme, en emploi ».)
 *
 * Ce sont deux ABSENCES : quelqu'un n'est pas là, la case s'éteint. Le magenta
 * les distinguait, mais il PESAIT — c'était la teinte la plus voyante de la
 * grille, et elle attirait l'œil avant les séances elles-mêmes. Un gris éteint
 * dit ce qu'il faut : ici, il n'y a rien à faire.
 *
 * ⚠️ CE QUI LES DISTINGUE N'EST PLUS LA COULEUR MAIS LE CONTEXTE : la PORTÉE
 * (un stage ferme un groupe, une formation une personne), les BADGES d'en-tête
 * du chronogramme (« STG » / « FOR », « 3 JSTG » / « 2 JFOR »), et la carte au
 * survol, qui nomme le motif et sa période.
 */
export const FOND_STAGE = 'bg-zinc-300/80';

export const FOND_FORMATION = 'bg-zinc-300/80';

/**
 * ═══ ⚠️ AVANT LA RENTRÉE : LE GRIS DES ABSENCES, PAS LE BLEU DES VACANCES ═══
 * (2026-09-02.) Le bleu dit « l'établissement est fermé » — il vaut pour tout le
 * monde. Ici l'établissement est OUVERT : ce sont les stagiaires d'une année qui
 * ne sont pas encore là, exactement comme un groupe parti en stage. Même
 * famille, donc même gris ; ce qui les distingue est la PORTÉE, que la carte au
 * survol nomme.
 */
export const FOND_AVANT_RENTREE = 'bg-zinc-300/80';

/**
 * La boîte intérieure d'une case saisissable.
 *
 * ⚠️ LA BORDURE N'APPARAÎT QU'AU SURVOL. Dessinée en permanence, elle ajoutait
 * un cadre à chacune des centaines de cases et la grille devenait un damier ;
 * transparente au repos, elle réserve sa place — la mise en page ne bouge donc
 * pas quand elle se révèle.
 */
export const CASE_SAISISSABLE = [
  'flex w-full min-w-0 items-center justify-center rounded-md border border-transparent',
  'tabular-nums transition-colors',
  'hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
].join(' ');

/**
 * La valeur d'une case : couleur selon ce qu'elle porte.
 *
 * ⚠️ LE VERT FONCÉ, PAS LE VERT DÉCORATIF. `--accent-green` (L 37 %) est fait
 * pour des aplats ; posé en TEXTE sur le fond vert pâle d'une séance placée
 * (`bg-accent-green/15`), il manquait de tenue. `--accent-green-deep` (L 26 %)
 * est la même teinte, assombrie — c'est le token déjà introduit pour le badge de
 * semestre, pas un troisième vert.
 */
export const VALEUR_PRESENTIEL = 'font-semibold text-accent-green-deep';
export const VALEUR_SYNCHRONE = 'font-semibold text-accent-purple-deep';

/**
 * ═══ LA SURVEILLANCE D'EFM ═══
 * Fond ET valeurs (groupe, module, salle) — couleurs données par le porteur le
 * 2026-08-26 : fond #FFFF8F, texte #FFD700.
 *
 * ⚠️ DEUX TOKENS DÉDIÉS, pas deux valeurs écrites en dur : la charte interdit
 * une couleur hors token (`DESIGN_SYSTEM.md`), et le fond vivait jusqu'ici
 * recopié à l'identique dans les TROIS grilles — emploi, vue globale, vue
 * détaillée. Il rejoint les six autres fonds du module commun, où une teinte se
 * change une fois.
 *
 * ⚠️ CE N'EST PLUS L'AMBRE DE L'ÉTOILE. `--warning` (#f59e0b) reste la couleur
 * de l'étoile ⭐ et du badge « EFM » ; la CASE porte désormais son propre jaune.
 * Trois essais l'ont précédé — `accent-orange` (se lit orange), un `warning-deep`
 * assombri (sortait de la teinte), puis `warning` lui-même.
 *
 * ⚠️ CONTRASTE MESURÉ : 1,33:1. L'or sur le jaune pâle est à la limite du
 * lisible — c'est un choix assumé du porteur. Ce qui qualifie la case reste
 * donc porté par son FOND et par son badge, jamais par le texte seul, et
 * `font-semibold` compense en partie.
 */
export const FOND_EFM = 'bg-efm';
export const VALEUR_EFM = 'font-semibold text-efm-foreground';
export const VALEUR_VIDE = 'text-muted-foreground';

/**
 * ═══ LE RATTRAPAGE (2026-09-14, décision C du porteur) ═══
 * Un cadre POINTILLÉ orange et la pastille ↺, POSÉS PAR-DESSUS la couleur de la
 * nature du cours — jamais à sa place. La grille compte déjà six couleurs de
 * sens ; une septième pour le fond aurait brouillé les autres, et un rattrapage
 * reste un cours en salle ou à distance, compté comme tel.
 *
 * ⚠️ L'ORANGE EST `--accent-orange`, celui du badge « Module annuel » : c'est la
 * seule teinte de la palette qui ne porte pas déjà un état de CASE (vert, violet,
 * bleu, ambre, gris, rouge). Le badge ne vit que dans la rangée d'indicateurs, la
 * confusion ne se pose pas.
 *
 * ⚠️ `TRAIT_RATTRAPAGE` EST UNE COULEUR CSS, PAS UNE CLASSE : le cadre de la grille
 * d'emploi se dessine en fonds superposés (`contourDuBloc`), là où une classe
 * Tailwind n'entre pas.
 *
 * Le BROUILLON — placé d'un clic, pas encore enregistré — prend un fond orange
 * pâle à la place de celui de sa nature : il n'existe pas encore.
 */
export const TRAIT_RATTRAPAGE = 'hsl(var(--accent-orange))';
export const CADRE_RATTRAPAGE = 'border-2 border-dashed border-accent-orange';
export const FOND_BROUILLON_RATTRAPAGE = 'bg-accent-orange/15';
export const PASTILLE_RATTRAPAGE =
  'inline-flex shrink-0 items-center rounded bg-accent-orange px-1 text-[0.55rem] font-semibold leading-4 text-white';

/**
 * Semaine PLEINE, en heures — le repère des couleurs de charge.
 *
 * En dessous il reste de la place, au-dessus la semaine déborde : le générateur
 * ne pourra pas tout caser, et l'écart se découvrirait bien plus tard comme un
 * retard du formateur.
 */
export const SEMAINE_PLEINE = 30;

/**
 * Couleur d'une charge hebdomadaire — TEXTE ET FOND.
 * ← `couleurTotal()` du pied de grille du chronogramme.
 *
 * Le fond seul ne suffit pas (trop pâle pour être lu sur une colonne étroite),
 * le texte seul se perd dans une file de chiffres : les deux ensemble font
 * ressortir la semaine qui déborde sans avoir à la chercher.
 *
 * ⚠️ ZÉRO N'EST PAS UN MANQUE. Une semaine vide se lit en gris, pas en rouge :
 * au début de la saisie, toute la grille serait en alerte.
 */
export function couleurCharge(total, seuil = SEMAINE_PLEINE) {
  if (!total) return 'text-muted-foreground';
  if (total < seuil) return 'text-primary bg-primary/10';
  if (total === seuil) return 'text-success bg-success/10';
  return 'text-destructive bg-destructive/10';
}

/**
 * La même règle, TEXTE SEUL — pour les endroits qui portent déjà un fond.
 *
 * ⚠️ DÉRIVÉE DE `couleurCharge`, jamais réécrite : deux listes de seuils
 * divergeraient au premier ajustement, et la même charge se lirait bleue ici et
 * verte ailleurs. C'est le constat §4.2 du plan, à l'échelle d'une couleur.
 */
export function couleurChargeTexte(total, seuil = SEMAINE_PLEINE) {
  return couleurCharge(total, seuil)
    .split(' ')
    .filter((classe) => classe.startsWith('text-'))
    .join(' ');
}


/**
 * La marge que `ContenuPage` pose sur toutes les pages (`p-6`).
 *
 * ⚠️ ELLE SERT AUX EN-TÊTES COLLANTS. Chrome accroche un élément collant au bord
 * du CONTENU du conteneur qui défile, pas de sa zone visible : sans remonter de
 * cette valeur, l'en-tête s'immobilise 24 px trop bas et les séances défilent
 * dans la bande ainsi laissée — mesuré, 50 cellules.
 *
 * ⚠️ ET LE ZOOM LA DIVISE : `zoom` divise toutes les longueurs du sous-arbre, si
 * bien qu'un `top` en pixels doit être divisé par le zoom pour que le décalage
 * RENDU reste constant d'un palier à l'autre.
 *
 * ⚠️ C'EST UN COUPLAGE ASSUMÉ avec la coquille. Le mesurer à l'exécution
 * demanderait un `ResizeObserver` — qui ne se déclenche pas dans un panneau
 * navigateur masqué, donc invérifiable — pour une valeur qui n'a pas bougé du
 * projet.
 */
/**
 * Les mêmes absences, mais PARTIELLES — quelques jours seulement.
 * (2026-08-26, demande du porteur.)
 *
 * ⚠️ LA MÊME TEINTE, EN PLUS CLAIRE. Une semaine amputée de trois jours n'est
 * pas fermée : lui donner l'aplat plein d'une semaine fermée ferait croire
 * qu'on n'y peut rien poser. Plus claire, elle dit « il en manque un morceau »
 * sans interdire — et la carte au survol donne le plafond exact.
 */
export const FOND_STAGE_PARTIEL = 'bg-zinc-300/35 dark:bg-zinc-700/35';
export const FOND_FORMATION_PARTIEL = 'bg-zinc-300/35 dark:bg-zinc-700/35';

/**
 * ⚠️ LA SEMAINE DE LA RENTRÉE EST PRESQUE TOUJOURS À CHEVAL. En 2026-2027 les
 * 1ʳᵉ années reprennent un VENDREDI : quatre jours gelés, deux ouverts. Elle se
 * lit donc comme une semaine amputée, jamais comme une semaine fermée.
 */
export const FOND_AVANT_RENTREE_PARTIEL = 'bg-zinc-300/35 dark:bg-zinc-700/35';

export const MARGE_PAGE = 24;
