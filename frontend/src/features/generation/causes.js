/**
 * Traduction des causes de non-placement.
 *
 * ═══ ⚠️ LE SOLVEUR REND UN CODE, PAS UNE PHRASE ═══
 * `formateur_occupe`, `creneau_interdit`… Python ne sait pas qu'un créneau
 * interdit vient d'un stage, d'une formation, d'une case cochée par le
 * formateur ou d'une rentrée qui n'a pas eu lieu : il ne voit qu'une liste
 * d'identifiants. C'est ici que le vocabulaire redevient celui de
 * l'établissement.
 *
 * ⚠️ ET C'EST CE QUI REMPLACE LA PHRASE FIXE DE L'ANCIEN — « Conflits d'emploi
 *    du temps ou quota d'heures atteint », affichée à l'identique sur toutes
 *    les lignes du rapport sans jamais rien diagnostiquer.
 */

import { REPLIS_MOTEUR } from 'shared/constants';

const LIBELLES = {
  /*
   * ⚠️ LA PLUS AMBIGUË, ET LA PLUS FRÉQUENTE EN DÉBUT D'ANNÉE. Quatre causes
   *    métier arrivent au solveur sous cette seule forme ; les nommer toutes
   *    vaut mieux qu'en choisir une au hasard, qui enverrait chercher au mauvais
   *    endroit.
   */
  /*
   * ⚠️ CONSERVÉE POUR LES ANCIENNES TRACES ET LES APPELANTS QUI N'ÉTIQUETTENT
   *    PAS. Depuis le 2026-09-22, `probleme.js` envoie l'origine exacte et les
   *    quatre motifs ci-dessous la remplacent. Mesuré sur l'année réelle :
   *    c'était la cause n°1 (163 séances sur 341) — et celle qui envoyait
   *    chercher dans quatre directions à la fois.
   */
  creneau_interdit:
    'Aucun créneau ouvert : groupe en stage, formateur en formation, rentrée non faite, ou créneaux marqués à éviter',
  rentree: 'Le groupe n’a pas encore fait sa rentrée cette semaine-là',
  stage: 'Le groupe est en stage sur les journées concernées',
  formation: 'Le formateur est lui-même en formation',
  a_eviter: 'Les créneaux restants sont marqués « à éviter » par le formateur',
  formateur_occupe: 'Le formateur est déjà occupé sur tous les créneaux restants',
  groupe_occupe: 'Le groupe est déjà occupé sur tous les créneaux restants',
  salle_occupee: 'Aucune salle libre parmi celles autorisées pour ce formateur',
  aucune_salle_declaree: 'Aucune salle autorisée pour ce formateur ni dans l’établissement',
  aucun_creneau: 'Aucun créneau compatible trouvé',
};

/** Ce qu'on peut FAIRE, quand il y a quelque chose à faire. */
const REMEDES = {
  creneau_interdit: 'Vérifiez le calendrier, les stages et les dates de rentrée',
  /*
   * ⚠️ TROIS REMÈDES QUI NE SONT PAS DES RELANCES. Stage, formation et rentrée
   *    sont des FAITS du calendrier : aucun assouplissement ne les contourne, et
   *    en proposer un ferait relancer pour rien. Ce qu'il faut corriger est en
   *    amont — le chronogramme demande des heures pendant une absence.
   */
  rentree:
    'Le chronogramme prévoit des heures avant la rentrée du groupe : décalez-les, ou corrigez la date de rentrée',
  stage:
    'Le chronogramme prévoit des heures pendant le stage : décalez-les, ou corrigez les dates du stage',
  formation:
    'Confiez ces heures à un autre formateur, ou décalez-les hors de sa formation',
  a_eviter:
    'Ce sont des consignes, pas des impossibilités : relancez en les ignorant, ou revoyez-les avec le formateur',
  formateur_occupe: 'Sa semaine est pleine : allégez son chronogramme ou répartissez autrement',
  groupe_occupe: 'La semaine du groupe est pleine : son chronogramme demande plus que 24 créneaux',
  salle_occupee: 'Attribuez-lui d’autres salles, ou relancez en autorisant toutes les salles',
  aucune_salle_declaree: 'Déclarez des salles dans Paramètres → Formateurs',
};

export function libelleCause(code) {
  return LIBELLES[code] ?? `Cause inconnue (${code})`;
}

export function remedeCause(code) {
  return REMEDES[code] ?? null;
}

/**
 * Les assouplissements qui peuvent débloquer une cause donnée.
 *
 * ← les trois boutons de la fenêtre de résolution de l'ancien. ⚠️ On ne propose
 * que ce qui a une CHANCE d'aider : offrir « toutes les salles » à un formateur
 * dont la semaine est pleine relancerait une génération identique, et ferait
 * croire que l'outil ne sert à rien.
 */
export function assouplissementsUtiles(causes) {
  const codes = new Set(causes);
  const propositions = [];

  /*
   * ═══ ⚠️ `a_eviter` ET NON PLUS `creneau_interdit` ═══ (2026-09-22)
   * L'ancien code proposait cette relance dès qu'un créneau était fermé — donc
   * aussi quand le groupe était en STAGE, alors que l'explication juste en
   * dessous dit noir sur blanc que les stages « ne se contournent pas ». Le
   * directeur cliquait, attendait, et retrouvait la même grille. C'est très
   * exactement ce que l'en-tête de cette fonction interdit : « on ne propose
   * que ce qui a une CHANCE d'aider ».
   *
   * ⚠️ `creneau_interdit` RESTE ACCEPTÉ : les anciennes traces ne portent pas
   *    de motif, et pour elles la proposition large vaut mieux que rien.
   */
  if (codes.has('a_eviter') || codes.has('creneau_interdit')) {
    propositions.push({
      cle: 'ignorerIndisponibilites',
      libelle: 'Ignorer les créneaux « à éviter »',
      explication:
        'Les indisponibilités déclarées par les formateurs sont levées. Les stages, formations, fériés et rentrées, eux, restent — ils ne se contournent pas.',
    });
  }

  if (codes.has('salle_occupee') || codes.has('aucune_salle_declaree')) {
    propositions.push({
      cle: 'toutesLesSalles',
      libelle: 'Autoriser toutes les salles',
      explication:
        'Les salles attribuées aux formateurs ne sont plus prises en compte : toutes celles de l’établissement deviennent disponibles.',
    });
  }

  return propositions;
}

/**
 * Pourquoi la recherche approfondie n'a pas servi, sur une semaine donnée.
 *
 * ═══ ⚠️ ELLE NE SERT PAS LA PLUPART DU TEMPS, ET IL FAUT LE DIRE ═══
 * Mesuré sur l'année réelle (2026-09-21) : demandée sur 37 semaines, CP-SAT n'a
 * été RETENU que sur 9. Sans cette traduction, le directeur paierait sept
 * minutes d'attente puis lirait un rapport identique à celui du glouton, sans
 * jamais savoir si la recherche avait tourné, échoué, ou simplement rien
 * trouvé de mieux. Le silence serait ici la pire des réponses.
 */
const REPLIS = {
  [REPLIS_MOTEUR.RIEN_A_GAGNER]: 'déjà complète — rien à chercher',
  [REPLIS_MOTEUR.PAS_MIEUX]: 'la recherche n’a pas fait mieux',
  [REPLIS_MOTEUR.ORTOOLS_ABSENT]:
    'recherche approfondie indisponible sur ce serveur (OR-Tools n’est pas installé)',
  [REPLIS_MOTEUR.ERREUR_SOLVEUR]: 'la recherche a échoué — la grille rapide a été conservée',
  [REPLIS_MOTEUR.NON_DEMANDE]: null,
};

export function libelleRepli(code) {
  return REPLIS[code] ?? null;
}
