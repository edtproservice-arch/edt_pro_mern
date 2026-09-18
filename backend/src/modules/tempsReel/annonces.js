import { normaliserValeurSemaine } from 'shared/domain';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { logger } from '../../lib/logger.js';
import { noter } from '../modifications/modifications.service.js';

/** L'en-tête par lequel un onglet se désigne lui-même. */
export const EN_TETE_CONNEXION = 'x-connexion-id';

/**
 * Annonce aux autres membres de la salle qu'une page vient d'être modifiée.
 *
 * ⚠️ APPELÉE APRÈS UNE ÉCRITURE RÉUSSIE, JAMAIS AVANT. Annoncer une pose que le
 * serveur refuse ensuite ferait relire aux autres une semaine inchangée — sans
 * dommage, mais pour rien, et le jour où l'annonce portera le détail de la case
 * (étape b), elle décrirait une séance qui n'existe pas.
 *
 * ⚠️ L'ONGLET QUI ÉCRIT EST ÉCARTÉ (`origine`) : il relit déjà sa grille à la
 * fin de sa propre écriture. Lui renvoyer l'annonce déclencherait une seconde
 * relecture identique. Ses AUTRES onglets, eux, la reçoivent — ce sont d'autres
 * connexions.
 *
 * @param {import('express').Request} req  une requête déjà passée par
 *   `authenticate` et `resolveTenant`
 * ⚠️ UNE ÉCRITURE PEUT CONCERNER PLUSIEURS PAGES (étape d2) : une séance
 * marquée absente dans l'emploi du temps apparaît dans « Absences », change les
 * taux de l'« Avancement » et l'occupation que lit l'« EFM régional ». Chaque
 * salle concernée est prévenue — sinon l'écran d'un collègue resterait sur
 * l'état d'avant, et c'est précisément ce que la collaboration doit empêcher.
 *
 * @param {string | string[]} pages  la ou les salles concernées (`emploi`…)
 * @param {object} details  `action`, et `semaine` quand l'écriture en vise une
 */
export function annoncerModification(req, pages, details = {}) {
  for (const page of [].concat(pages)) {
    annoncerSurPage(req, page, details);
    noterModification(req, page);
  }
}

/*
 * ═══ LA MÊME ANNONCE DATE LA PAGE (2026-09-13) ═══ « Modifié il y a 3 min » dans
 * la barre du haut : chaque écriture annonce déjà les pages qu'elle touche, et
 * c'est ce signal qu'on note — pas un second inventaire des écritures, qui
 * finirait par en oublier une.
 *
 * ⚠️ SANS ATTENDRE, ET SANS JAMAIS FAIRE ÉCHOUER LA ROUTE : l'écriture a réussi
 * et la réponse est partie ; une date manquée coûte au pire un « Modifié » en
 * retard.
 */
function noterModification(req, page) {
  noter({
    etablissementId: req.etablissementId,
    anneeScolaire: req.anneeScolaire,
    page,
    auteur: { id: req.utilisateur.id, nom: req.utilisateur.nomComplet },
  }).catch((erreur) => logger.warn({ err: erreur, page }, 'Date de modification non notée'));
}

function annoncerSurPage(req, page, { action, semaine = null, ...reste }) {
  /*
   * ⚠️ JAMAIS UNE EXCEPTION VERS LA ROUTE. `emit` appelle les auditeurs de façon
   * SYNCHRONE : une socket défaillante lèverait ici, APRÈS `res.json` — la route
   * passerait l'erreur à `next`, qui tenterait d'envoyer une seconde réponse.
   * L'écriture a réussi ; une annonce manquée coûte au pire une relecture.
   */
  try {
    bus.emit(EVENEMENTS.MODIFICATION, {
      etablissementId: String(req.etablissementId),
      anneeScolaire: req.anneeScolaire,
      page,
      action,
      // La forme NORMALISÉE : le client compare avec la semaine qu'il affiche, et
      // « 2026-W039 » ne doit pas manquer « 2026-W39 ».
      semaine: semaine ? (normaliserValeurSemaine(semaine) ?? semaine) : null,
      auteur: { id: String(req.utilisateur.id), nom: req.utilisateur.nomComplet },
      origine: req.get(EN_TETE_CONNEXION) || null,
      ...reste,
    });
  } catch (erreur) {
    logger.error({ err: erreur, page, action }, 'Annonce temps réel impossible');
  }
}
