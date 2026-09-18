/**
 * Brouillon d'une page « tout ou rien », sous version optimiste
 * (Phase 5bis, étape d3).
 *
 * ═══ LES TROIS VALEURS QU'ON TIENT ═══
 *   - `brouillon`  ce qui est à l'écran, saisie comprise ;
 *   - `reference`  ce que le serveur a en base, d'après la dernière lecture ou
 *                  la dernière écriture réussie — « modifié » = brouillon ≠ référence ;
 *   - `version`    le compteur de cette référence. C'est lui qu'on renvoie à
 *                  l'écriture : s'il a bougé en base, le serveur refuse en 409.
 *
 * ═══ QUAND UN COLLÈGUE ENREGISTRE ═══
 * L'annonce temps réel fait relire la page. Deux cas :
 *   - rien n'est en cours de saisie ici → on ADOPTE sa version, en silence ;
 *   - une saisie est en cours → on la GARDE, avec l'ancienne version. Son
 *     enregistrement sera refusé en 409, et la page rechargée : c'est la règle
 *     du porteur, « refus si modifiée entre-temps ». Écraser la saisie dès
 *     l'annonce ferait perdre ce qu'on est en train de taper, sans même un envoi.
 *
 * Fonctions PURES : elles décident de ce qui s'écrit en base, et doivent se
 * vérifier autrement qu'à l'œil (même choix que `etatPlannings.js`).
 */

export const egaliteJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const BROUILLON_VIDE = Object.freeze({
  charge: false,
  brouillon: null,
  reference: null,
  version: null,
});

/**
 * Une lecture du serveur arrive (premier chargement, ou relecture après une
 * annonce).
 *
 * ⚠️ RENDRE LE MÊME OBJET QUAND RIEN NE CHANGE : l'état React ne se re-rend pas,
 * et la minuterie d'enregistrement ne se ré-arme pas pour rien.
 *
 * @param {{ valeur: unknown, version: number } | null | undefined} serveur
 */
export function recevoirServeur(etat, serveur, egal = egaliteJson) {
  if (!serveur) return etat;
  const { valeur, version } = serveur;

  if (!etat.charge) return { charge: true, brouillon: valeur, reference: valeur, version };

  // Une réponse plus ancienne que ce qu'on sait déjà (une relecture partie avant
  // notre propre écriture) : elle ne dit rien de neuf.
  if (typeof version === 'number' && typeof etat.version === 'number' && version < etat.version) {
    return etat;
  }

  if (egal(etat.brouillon, etat.reference)) {
    if (version === etat.version && egal(valeur, etat.reference)) return etat;
    // Rien en cours ici : la page suit le serveur.
    return { ...etat, brouillon: valeur, reference: valeur, version };
  }

  // Le serveur rejoint ce qu'on a saisi (un collègue a fait la même chose) :
  // plus rien à enregistrer, et la version est la sienne.
  if (egal(etat.brouillon, valeur)) return { ...etat, reference: valeur, version };

  // Saisie en cours, divergente : on la garde, avec la version sur laquelle elle
  // repose. Le conflit se déclarera à l'enregistrement.
  return etat;
}

/** La saisie : une valeur, ou une fonction de la valeur courante (comme `setState`). */
export function saisir(etat, valeur) {
  const suivante = typeof valeur === 'function' ? valeur(etat.brouillon) : valeur;
  return { ...etat, brouillon: suivante };
}

/**
 * L'écriture a réussi.
 *
 * ⚠️ LA RÉFÉRENCE EST CE QUE LE SERVEUR A RENDU, PAS CE QU'ON A ENVOYÉ : il
 * dédoublonne les espaces, remet les périodes dans l'ordre. Et si rien n'a été
 * tapé pendant l'envoi, le brouillon prend cette forme normalisée — sinon la
 * page resterait « modifiée » sur un écart qu'elle ne peut pas réduire.
 * ⚠️ UNE FRAPPE FAITE PENDANT L'ENVOI N'EST PAS PERDUE : le brouillon la garde,
 * et reste « modifié » — la minuterie repart.
 *
 * @param {{ envoye: unknown, retour?: unknown, version: number }} ecriture
 */
export function enregistre(etat, { envoye, retour, version }, egal = egaliteJson) {
  const reference = retour === undefined ? envoye : retour;
  const brouillon = egal(etat.brouillon, envoye) ? reference : etat.brouillon;
  return { ...etat, charge: true, brouillon, reference, version };
}

/** Après un 409 : la page reprend ce que le serveur porte, saisie abandonnée. */
export function adopter(etat, { valeur, version }) {
  return { charge: true, brouillon: valeur, reference: valeur, version };
}

export const estModifie = (etat, egal = egaliteJson) =>
  etat.charge && !egal(etat.brouillon, etat.reference);
