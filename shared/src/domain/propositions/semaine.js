import { anneeScolaire as anneeDe } from '../planning/anneeScolaire.js';
import { analyserSemaine, valeurSemaine } from '../planning/semaines.js';

/**
 * La semaine qu'un formateur peut proposer.
 * ← `openProposition()` / `submitProposition()` de inbox.html
 *
 * ═══ TOUJOURS LA SEMAINE SUIVANTE (décision du porteur, 2026-09-23) ═══
 * Comme l'existant : `aujourd'hui + 7 jours`. Mais l'existant recalculait la
 * clé avec `mois < 8`, et `apply_proposition.php` avec `mois < 9` — deux règles
 * pour la même clé. Ici `valeurSemaine`, LA définition du projet.
 *
 * ═══ ⚠️ PAS SUR UNE SEMAINE PUBLIÉE (décision du porteur, 2026-09-23) ═══
 * « Si l'emploi est déjà publié, il ne faut pas changer ni proposer. » Publier,
 * c'est annoncer la semaine qui FAIT FOI : la proposer encore ferait revenir sur
 * un emploi que groupes et formateurs consultent déjà.
 *
 * ⚠️ PUBLIÉE = LA SEMAINE PUBLIÉE OU UNE ANTÉRIEURE. On ne publie qu'une semaine
 * à la fois, mais publier la S12 vaut aussi pour la S11 : elle a été publiée
 * avant. Comparer par égalité laisserait proposer sur une semaine déjà dépassée
 * par la publication.
 *
 * @param {number} annee               l'année scolaire active
 * @param {object} [options]
 * @param {Date}   [options.maintenant]
 * @param {string|null} [options.semainePubliee] « 2026-W12 »
 * @returns {{semaine: string, ouverte: boolean, motif: string|null}}
 *   `motif` nomme la raison du refus : `publiee` ou `hors_annee`
 */
export function semaineProposable(annee, { maintenant = new Date(), semainePubliee = null } = {}) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('semaineProposable attend une année scolaire entière');
  }
  if (!(maintenant instanceof Date) || Number.isNaN(maintenant.getTime())) {
    throw new TypeError('semaineProposable attend une Date valide');
  }

  const suivante = new Date(maintenant);
  suivante.setDate(suivante.getDate() + 7);
  const semaine = valeurSemaine(suivante);

  /*
   * ⚠️ LA SEMAINE SUIVANTE PEUT SORTIR DE L'ANNÉE ACTIVE — fin août, ou quand le
   * directeur prépare déjà l'année d'après. Ses séances ne pourraient s'écrire
   * dans aucune des deux : on le dit plutôt que de proposer une grille vouée au
   * refus.
   */
  if (anneeDe(suivante) !== annee) {
    return { semaine, ouverte: false, motif: 'hors_annee' };
  }

  if (semaineEstPubliee(semaine, semainePubliee)) {
    return { semaine, ouverte: false, motif: 'publiee' };
  }

  return { semaine, ouverte: true, motif: null };
}

/**
 * Cette semaine est-elle déjà couverte par la publication ?
 * ⚠️ Une publication illisible ou absente ne ferme rien : on ne sait pas la situer.
 */
export function semaineEstPubliee(semaine, semainePubliee) {
  const cible = analyserSemaine(semaine);
  const publiee = analyserSemaine(semainePubliee);
  if (!cible || !publiee) return false;
  return cible.debut <= publiee.debut;
}
