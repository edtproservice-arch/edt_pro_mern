import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import devicesRoutes from './modules/auth/devices.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import etablissementsRoutes from './modules/etablissements/etablissements.routes.js';
import comptesRoutes from './modules/comptes/comptes.routes.js';
import baseRoutes from './modules/base/base.routes.js';
import stagiairesRoutes from './modules/stagiaires/stagiaires.routes.js';
import chronogrammeRoutes from './modules/chronogramme/chronogramme.routes.js';
import seancesRoutes from './modules/seances/seances.routes.js';
import modificationsRoutes from './modules/modifications/modifications.routes.js';
import partagesRoutes from './modules/partages/partages.routes.js';
import absencesRoutes from './modules/absences/absences.routes.js';
import absencesStagiairesRoutes from './modules/absencesStagiaires/absencesStagiaires.routes.js';
import avancementRoutes from './modules/avancement/avancement.routes.js';
import meteoRoutes from './modules/meteo/meteo.routes.js';
import messagerieRoutes from './modules/messagerie/messagerie.routes.js';
import consultationRoutes from './modules/consultation/consultation.routes.js';
import calendrierRoutes from './modules/calendrier/calendrier.routes.js';
import repartitionsRoutes from './modules/repartitions/repartitions.routes.js';
import repartitionsAdminRoutes from './modules/repartitions/repartitions.admin.routes.js';
import reseauRoutes from './modules/reseau/reseau.routes.js';
import reseauAdminRoutes from './modules/reseau/reseau.admin.routes.js';
import {
  lecture as calendrierNationalLecture,
  ecriture as calendrierNationalEcriture,
} from './modules/calendrierNational/calendrierNational.routes.js';

/**
 * Construction de l'application Express — SANS `listen`.
 *
 * Cette séparation permet à Supertest de monter l'app en test sans ouvrir de
 * port. C'est ce qui manquait à l'API PHP : chaque endpoint étant un fichier
 * exécuté par Apache, rien n'y était testable hors serveur.
 *
 * Pas de middleware CORS : Nginx sert le front et l'API sur la même origine
 * (plan §5). Le CORS permissif de config/security.php:25-29 — qui reflétait
 * n'importe quelle origine avec `credentials: true` — ne doit surtout pas
 * être reproduit ici.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '5mb' })); // imports e-note volumineux
  app.use(cookieParser());

  // Derrière Nginx : sans cela, `req.ip` vaudrait l'adresse du proxy pour tout
  // le monde, et la limitation de débit s'appliquerait globalement au lieu de
  // par client.
  app.set('trust proxy', 1);

  app.get('/api/v2/health', (req, res) => {
    res.json({ success: true, status: 'ok' });
  });

  /*
   * ⚠️ SANS AUCUN GARDE, ET C'EST VOULU : l'inscription d'un directeur se fait
   * avant toute session, et sa cascade région → complexe → établissement se sert
   * ici. Ce qui en sort est la liste OFFICIELLE des établissements du réseau —
   * exactement ce que `public/data/etablissements.json` exposait déjà en clair.
   */
  app.use('/api/v2/reseau', reseauRoutes); //                    F1  — Phase 3
  app.use('/api/v2/auth', authRoutes); //                        F1  — Phase 3
  app.use('/api/v2/auth/appareils', devicesRoutes); //           F1  — Phase 3
  /*
   * ⚠️ AVANT `adminRoutes`, ET C'EST VOULU : celui-ci monte `authenticate` et
   * `requireRole` pour TOUT `/api/v2/admin`, y compris les chemins qu'il ne sert
   * pas. Placé après, chaque appel au référentiel traverserait d'abord ces deux
   * middlewares — jeton vérifié deux fois — avant de retomber ici. Le plus
   * spécifique d'abord.
   *
   * L'écriture du référentiel DRIF est réservée à l'administrateur (décision du
   * porteur, 2026-09-02) ; la LECTURE reste sur `/api/v2/repartitions`, ouverte
   * aux directeurs, dont la carte d'établissement en dépend.
   */
  app.use('/api/v2/admin/repartitions', repartitionsAdminRoutes); //  F15 — Phase 4
  app.use('/api/v2/admin/reseau', reseauAdminRoutes); //         F15 — Phase 4
  app.use('/api/v2/admin/calendrier-national', calendrierNationalEcriture); // F15
  app.use('/api/v2/admin', adminRoutes); //                      F15 — Phase 3
  app.use('/api/v2/etablissements', etablissementsRoutes); //    F2  — Phase 3
  app.use('/api/v2/comptes', comptesRoutes); //                  F12 — Phase 3
  app.use('/api/v2/base', baseRoutes); //                     F3, F4 — Phase 4
  app.use('/api/v2/stagiaires', stagiairesRoutes); //            F11 — Phase 4
  app.use('/api/v2/chronogrammes', chronogrammeRoutes); //         F7 — Phase 7
  app.use('/api/v2/calendrier', calendrierRoutes); //         F3, F13 — Phase 4
  /*
   * ⚠️ EN LECTURE POUR TOUT COMPTE CONNECTÉ : le calendrier d'un établissement
   * s'alimente de celui-ci par défaut, et le gel de la rentrée s'y lit. Seul
   * l'admin l'ÉCRIT — voir `/api/v2/admin/calendrier-national`.
   */
  app.use('/api/v2/calendrier-national', calendrierNationalLecture); //  F3, F13
  app.use('/api/v2/repartitions', repartitionsRoutes); //     F3, F13 — Phase 4

  // Modules suivants, phase par phase :
  app.use('/api/v2/seances', seancesRoutes); //      F5, F8  → Phase 5
  app.use('/api/v2/modifications', modificationsRoutes); // « Modifié il y a… » — 2026-09-13
  app.use('/api/v2/partages', partagesRoutes); // collaboration — Phase 5bis (c)
  app.use('/api/v2/absences', absencesRoutes); //   F8      → Phase 5 (d)
  app.use('/api/v2/absences-stagiaires', absencesStagiairesRoutes); // F9 → Phase 8
  app.use('/api/v2/avancement', avancementRoutes); // F7 → Phase 7
  app.use('/api/v2/meteo', meteoRoutes); // l'emblème de la salutation, sur l'accueil
  app.use('/api/v2/messages', messagerieRoutes); // F10     → Phase 9 (a)
  app.use('/api/v2/consultation', consultationRoutes); // F14 → Phase 10
  // …

  app.use(notFoundHandler);
  app.use(errorHandler); // toujours en dernier

  return app;
}
