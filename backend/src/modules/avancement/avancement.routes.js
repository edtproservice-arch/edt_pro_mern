import { Router } from 'express';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import * as service from './avancement.service.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';

/**
 * Avancement réalisé / prévu (F7).
 * ← api/data/get_avancement_data.php · get_planned_progress.php
 */
const router = Router();

/*
 * ═══ LE DROIT SUR LA PAGE DÉCIDE, PLUS LE RÔLE (Phase 5bis, étape d2) ═══
 * La page est en LECTURE SEULE (`droitMax: 'consulter'`) : toutes ses routes
 * lisent, et un invité — formateur ou gestionnaire — les lit toutes. Le
 * gestionnaire perd l'accès par son seul rôle, que l'écran ne lui ouvrait pas
 * depuis le 2026-09-03.
 *
 * ⚠️ L'ADMINISTRATEUR N'Y A PLUS ACCÈS DIRECTEMENT : il n'appartient à aucun
 * établissement, et c'est en prenant la place d'un directeur qu'il consulte.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant,
  exigerDroitPage('avancement', 'consulter')
);

/**
 * La date à laquelle l'écran est rembobiné (`?date=AAAA-MM-JJ`), ou `null`.
 *
 * ⚠️ UNE DATE ILLISIBLE EST IGNORÉE plutôt que refusée : le pire serait de
 * rendre une erreur là où l'état courant fait parfaitement l'affaire, et l'écran
 * afficherait une page vide pour un paramètre mal formé.
 *
 * ⚠️ FIN DE JOURNÉE (`T23:59:59`), et en heure LOCALE : « l'état au 19 » inclut
 * les séances DU 19. À minuit — a fortiori en UTC — la journée désignée serait
 * exclue, et le dernier point de la frise ne montrerait jamais sa propre semaine.
 */
function dateObservee(req) {
  if (!req.query.date) return null;
  const brute = new Date(`${req.query.date}T23:59:59`);
  return Number.isNaN(brute.getTime()) ? null : brute;
}

/*
 * UNE SEULE ROUTE POUR LES DEUX FACES ET LES TROIS AXES. Les séparer ferait
 * relire la base, les séances et l'import à chaque bascule de l'écran — pour le
 * même travail. Le calcul est le même parcours ; ce qui change est la clé
 * d'agrégation, et elle ne coûte rien.
 */
router.get('/', async (req, res, next) => {
  try {
    /*
     * ⚠️ `?date=` REMBOBINE L'ÉCRAN. Une date illisible est IGNORÉE plutôt que
     * refusée : le pire serait de rendre une erreur là où l'état courant fait
     * parfaitement l'affaire, et l'écran afficherait une page vide pour un
     * paramètre mal formé.
     */
    res.json(
      await service.avancement(req.etablissementId, req.anneeScolaire, dateObservee(req))
    );
  } catch (erreur) {
    next(erreur);
  }
});

/*
 * Les points de la frise, par face.
 * ← `get_timeline_dates.php`
 */
router.get(
  '/chronologie',
  async (req, res, next) => {
    try {
      res.json(await service.chronologie(req.etablissementId, req.anneeScolaire));
    } catch (erreur) {
      next(erreur);
    }
  }
);

/*
 * Les PLAGES de chaque module — prévue au chronogramme, posée dans la grille.
 * ← `get_modules_completion_dates.php`
 *
 * ⚠️ UNE ROUTE À PART, PAS UN AJOUT À LA PRÉCÉDENTE : elle relit TOUS les
 * chronogrammes de l'année, un travail qui n'a rien à voir avec le calcul des
 * taux et qu'on ne consulte qu'en ouvrant le détail de l'achèvement. L'y verser
 * ferait payer ce parcours à chaque ouverture de la page.
 */
router.get(
  '/achevement',
  async (req, res, next) => {
    try {
      /* ⚠️ ELLE SUIT LA MÊME DATE que les taux : les plages posées et le nombre
         de modules achevés vivent dans le même bloc de l'écran, et deux dates
         différentes s'y contrediraient sans que rien ne le dise. */
      res.json({
        plages: await service.achevementDesModules(
          req.etablissementId,
          req.anneeScolaire,
          dateObservee(req)
        ),
      });
    } catch (erreur) {
      next(erreur);
    }
  }
);

export default router;
