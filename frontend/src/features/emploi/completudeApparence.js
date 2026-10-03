/**
 * Les couleurs du rapport de complétude, définies UNE fois.
 * ← les hex en dur de `chargerCompletude()` / `completudeAfficher()` (emploi.html)
 *
 * ═══ ⚠️ UNE SEULE LISTE DE SEUILS ═══
 * L'ancien répétait la règle à deux endroits — la pastille du bouton et le
 * grand chiffre de la fenêtre — avec deux jeux de hex écrits à la main. Deux
 * listes divergent au premier ajustement, et le même taux se lit orange ici et
 * rouge là. C'est le constat §4.2 du plan, à l'échelle d'une couleur.
 *
 * ⚠️ DES JETONS, PAS DES HEX. L'ancien posait `#16a34a`, `#d97706`, `#dc2626` :
 * invisibles au thème sombre, et hors du système de design du projet.
 */

/** Conforme : chaque module a exactement ses heures. */
export const SEUIL_CONFORME = 100;
/** En deçà, l'écart devient franc plutôt que marginal. */
export const SEUIL_PROCHE = 90;

/**
 * Ton d'un taux de conformité.
 *
 * ⚠️ `null` N'EST PAS ZÉRO : rien n'est prévu cette semaine-là, donc rien n'est
 *    en retard. Le gris dit « sans objet », le rouge dirait « raté ».
 */
export function tonCompletude(taux) {
  if (taux === null || taux === undefined) return 'neutre';
  if (taux >= SEUIL_CONFORME) return 'conforme';
  if (taux >= SEUIL_PROCHE) return 'proche';
  return 'ecarte';
}

const CLASSES = {
  neutre: { texte: 'text-muted-foreground', fond: 'bg-muted', barre: 'bg-muted-foreground/40' },
  conforme: { texte: 'text-success', fond: 'bg-success/10', barre: 'bg-success' },
  proche: { texte: 'text-warning', fond: 'bg-warning/10', barre: 'bg-warning' },
  ecarte: { texte: 'text-destructive', fond: 'bg-destructive/10', barre: 'bg-destructive' },
};

/** Classes d'un taux : `{ texte, fond, barre }`. */
export const couleurCompletude = (taux) => CLASSES[tonCompletude(taux)];

/**
 * Les trois natures d'écart.
 *
 * ⚠️ ELLES N'APPELLENT PAS LA MÊME SUITE, et c'est pourquoi elles sont
 *    distinguées : compléter la grille, en retirer, ou vérifier le
 *    chronogramme d'où ce module ne devrait pas sortir.
 */
export const NATURES = {
  manquante: { libelle: 'À placer', classe: 'bg-destructive/10 text-destructive' },
  en_trop: { libelle: 'En trop', classe: 'bg-warning/15 text-warning' },
  hors_chronogramme: {
    libelle: 'Hors chronogramme',
    classe: 'bg-accent-purple/20 text-accent-purple-deep',
  },
};

/** Libellé d'une nature, jamais le code brut si elle est inconnue. */
export const libelleNature = (nature) => NATURES[nature]?.libelle ?? nature;

/**
 * Où une séance manquante a été posée (2026-09-27).
 *
 * ⚠️ « À ÉVITER » ET « SANS SALLE » SONT DITS, PAS TUS : l'un va contre la
 *    demande d'un formateur, l'autre laisse une salle à compléter. Les poser
 *    sans le montrer ferait découvrir le coût par les réclamations.
 */
export const NIVEAUX_PLACEMENT = {
  libre: { libelle: 'Créneau libre', classe: 'bg-success/10 text-success' },
  a_eviter: { libelle: 'Indisponibilité formateur', classe: 'bg-warning/15 text-warning' },
  sans_salle: { libelle: 'Sans salle', classe: 'bg-accent-purple/20 text-accent-purple-deep' },
};

export const libelleNiveau = (niveau) => NIVEAUX_PLACEMENT[niveau]?.libelle ?? niveau;

/** Pourquoi une séance n'a trouvé aucune place — ce qui dit où chercher. */
export const RAISONS_NON_PLACEE = {
  creneaux_fermes: 'Tous les créneaux sont fermés (stage, formation, rentrée, jours fermés)',
  formateur_occupe: 'Le formateur est pris sur chaque créneau libre',
  groupe_occupe: 'Le groupe est pris sur chaque créneau libre',
  aucun_creneau_commun: 'Le formateur et le groupe ne sont jamais libres en même temps',
  sans_affectation: 'Aucun formateur n’est affecté à ce module',
  refusee: 'Refusée par le serveur',
};

export const libelleRaison = (raison) => RAISONS_NON_PLACEE[raison] ?? raison;
