import { droitSuffit } from 'shared/domain';
import { forbidden } from '../../lib/httpError.js';
import { meilleurDroit } from './partages.service.js';

/**
 * Garde de route par DROIT SUR UNE PAGE, et non plus par rôle.
 *
 * ═══ POURQUOI ═══ Depuis les invitations (Phase 5bis), le rôle ne suffit plus à
 * dire qui lit ou écrit l'emploi du temps : un formateur invité le peut, un
 * formateur non invité non. `requireRole(DIRECTEUR, GESTIONNAIRE)` aurait refusé
 * le premier ; l'élargir au rôle FORMATEUR aurait ouvert la page au second.
 *
 * ⚠️ À MONTER APRÈS `authenticate` ET `resolveTenant` : le droit se lit dans
 * l'établissement et l'année que ces deux-là ont résolus.
 *
 * ⚠️ PLUSIEURS PAGES POSSIBLES (étape d) : une route que deux pages partagent
 * — la base e-note, lue par Affectations comme par Formateurs — s'ouvre à qui
 * détient le droit requis sur L'UNE d'elles. Le plus fort l'emporte.
 *
 * Renseigne `req.droitPage` (`{ droit, source }`).
 *
 * @param {string | string[]} page
 */
export function exigerDroitPage(page, requis) {
  const pages = [].concat(page);
  return async function gardeDroitPage(req, res, next) {
    try {
      const acces = await meilleurDroit(req.utilisateur, req.etablissementId, req.anneeScolaire, pages);
      if (!droitSuffit(acces?.droit, requis)) {
        return next(
          forbidden(
            acces
              ? 'Vous pouvez consulter cette page, pas la modifier'
              : 'Cette page ne vous est pas partagée',
            { code: acces ? 'DROIT_INSUFFISANT' : 'PAGE_NON_PARTAGEE' }
          )
        );
      }
      req.droitPage = acces;
      return next();
    } catch (erreur) {
      return next(erreur);
    }
  };
}
