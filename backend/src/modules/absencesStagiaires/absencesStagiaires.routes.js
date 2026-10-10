import { Router } from 'express';
import { z } from 'zod';
import { ROLES, SEANCES } from 'shared/constants';
import { appelStagiairesSchema, indisciplineSchema, justificationAbsenceSchema } from 'shared/schemas';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as appelService from './absencesStagiaires.service.js';
import * as discipline from './discipline.service.js';
import { construireExportFeuilleAbsence } from './exportFeuilleAbsence.service.js';
import { construireBilletsAbsence, construireBilletsVierges } from './exportBilletAbsence.service.js';
import { construireFeuillePresence } from './exportFeuillePresence.service.js';

/**
 * Absences, retards et indisciplines des stagiaires — la note de discipline (F9).
 *
 * ═══ QUI FAIT QUOI (décision du porteur, 2026-09-14) ═══
 *   - l'APPEL (lire, marquer) : directeur, gestionnaire, et chaque FORMATEUR
 *     pour ses propres séances — le service le restreint ;
 *   - la JUSTIFICATION, les NOTES et les INDISCIPLINES : directeur et
 *     gestionnaire (le surveillant général). La grille réserve les sanctions au
 *     SG, au directeur et au Conseil de discipline : un formateur signale,
 *     il ne sanctionne pas.
 *
 * ⚠️ PAR RÔLE, PAS PAR DROIT DE PAGE : la page « Absences » ne se partage plus
 * (2026-09-14), et le gestionnaire n'y a accès QUE pour ses stagiaires — pas pour
 * le registre des formateurs, qui reste gardé par `exigerDroitPage('absences')`.
 */
const router = Router();

router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const ENCADREMENT = requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE);

const acteur = (req) => ({
  id: req.utilisateur._id,
  role: req.utilisateur.role,
  /*
   * ⚠️ CELUI QUI A VRAIMENT CLIQUÉ (2026-09-29, bogue signalé par le porteur :
   * « validé par doit être le propriétaire de la session qui a validé »). Le
   * service écrivait jusqu'ici le NOM DU FORMATEUR DE LA SÉANCE dans
   * `validateurNom` — vrai quand c'est lui qui valide, faux dès qu'un
   * gestionnaire ou un directeur le fait à sa place (2026-09-28, ils le
   * peuvent désormais). C'est LUI, l'acteur de la requête, qu'il faut nommer.
   */
  nomComplet: req.utilisateur.nomComplet,
  identifiant: String(req.utilisateur.identifiant ?? '').trim(),
});

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const identifiant = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, 'Identifiant invalide') });

/** Toute écriture de cette page date et prévient la salle « absences ». */
const annoncer = (req, action) => annoncerModification(req, 'absences', { action });

const route = (gestionnaire) => async (req, res, next) => {
  try {
    await gestionnaire(req, res);
  } catch (erreur) {
    next(erreur);
  }
};

router.get(
  '/groupes',
  ENCADREMENT,
  route(async (req, res) => {
    res.json({ groupes: await discipline.groupes(req.etablissementId, req.anneeScolaire) });
  })
);

/**
 * Le tableau de bord du gestionnaire (2026-09-29, demande du porteur) — les
 * statistiques d'absence et de discipline des stagiaires, agrégées pour tout
 * l'établissement.
 */
router.get(
  '/tableau-bord',
  ENCADREMENT,
  route(async (req, res) => {
    res.json(await discipline.tableauDeBord(req.etablissementId, req.anneeScolaire));
  })
);

/**
 * La feuille d'absence hebdomadaire d'un ou plusieurs groupes, en Word, PDF
 * ou Excel (2026-09-29, demande du porteur, canevas transmis) — voir
 * `exportFeuilleAbsence.service.js`. Bouton posé sur la grille de « Faire
 * l'appel », avec le même filtre filière/niveau/année qu'en Édition : il
 * télécharge tous les groupes que ce filtre laisse visibles.
 *
 * ⚠️ RÉSERVÉE À L'ENCADREMENT, comme `/notes` et `/stagiaires/:matricule` : la
 * feuille porte le nom de tous les stagiaires de chaque groupe, pas seulement
 * ceux qu'un formateur enseigne.
 */
router.post(
  '/export',
  ENCADREMENT,
  validate({
    body: z.object({
      format: z.enum(['docx', 'pdf', 'xlsx']),
      groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      semaine: z.string().regex(/^\d{4}-W\d{1,3}$/, 'Semaine attendue au format AAAA-Wn'),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireExportFeuilleAbsence(
      req.etablissementId,
      req.anneeScolaire,
      req.body
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(tampon);
  })
);

/**
 * Une feuille de présence d'épreuve — `eff` ou `cc-efm` — pour un ou plusieurs
 * groupes, en Word ou PDF (2026-10-02, canevas transmis) — voir
 * `exportFeuillePresence.service.js`. Depuis la page Documents.
 *
 * ⚠️ RÉSERVÉE À L'ENCADREMENT, comme `/export` : elle porte le nom et le
 * matricule de tous les stagiaires de chaque groupe.
 */
router.post(
  '/presence/:modele',
  ENCADREMENT,
  validate({
    params: z.object({ modele: z.enum(['eff', 'cc-efm', 'liste', 'badges-sans', 'badges-infos', 'checklist', 'verification', 'retrait-definitif', 'retrait-provisoire', 'attestation-poursuite', 'convention']) }),
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireFeuillePresence(
      req.etablissementId,
      req.anneeScolaire,
      req.params.modele,
      req.body
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(tampon);
  })
);

router.get(
  '/seances',
  validate({ query: z.object({ date: jour, groupe: z.string().trim().max(200).optional() }) }),
  route(async (req, res) => {
    res.json(
      await appelService.seancesDuJour(req.etablissementId, req.anneeScolaire, req.query, acteur(req))
    );
  })
);

router.get(
  '/appel',
  validate({
    query: z.object({
      date: jour,
      seance: z.enum(SEANCES),
      periode: z.enum(['jour', 'soir']).default('jour'),
      groupe: z.string().trim().min(1).max(200),
    }),
  }),
  route(async (req, res) => {
    res.json(await appelService.appel(req.etablissementId, req.anneeScolaire, req.query, acteur(req)));
  })
);

router.put(
  '/appel',
  validate({ body: appelStagiairesSchema }),
  route(async (req, res) => {
    res.json(
      await appelService.enregistrerAppel(req.etablissementId, req.anneeScolaire, req.body, acteur(req))
    );
    annoncer(req, 'appel');
  })
);

/**
 * Enregistre l'appel ET l'ATTESTE (2026-09-27) — le bouton « Valider l'appel »
 * du formateur, qui remplace l'enregistrement automatique pour lui : ses
 * changements restent dans l'écran jusqu'à ce clic.
 */
router.put(
  '/appel/valider',
  validate({ body: appelStagiairesSchema }),
  route(async (req, res) => {
    res.json(
      await appelService.validerAppel(req.etablissementId, req.anneeScolaire, req.body, acteur(req))
    );
    annoncer(req, 'appel');
  })
);

/**
 * Le signe « validé » directement sur la grille de la page Absences
 * (2026-09-27, demande du porteur : « je veux un signe de validé sans cliquer
 * sur la séance »).
 */
router.get(
  '/appel/validations',
  validate({ query: z.object({ debut: jour, fin: jour }) }),
  route(async (req, res) => {
    res.json(await appelService.validationsSemaine(req.etablissementId, req.anneeScolaire, req.query));
  })
);

router.get(
  '/notes',
  ENCADREMENT,
  validate({ query: z.object({ groupe: z.string().trim().min(1).max(200) }) }),
  route(async (req, res) => {
    res.json(await discipline.notes(req.etablissementId, req.anneeScolaire, req.query.groupe));
  })
);

router.get(
  '/stagiaires/:matricule',
  ENCADREMENT,
  validate({ params: z.object({ matricule: z.string().trim().min(1).max(50) }) }),
  route(async (req, res) => {
    res.json(await discipline.fiche(req.etablissementId, req.anneeScolaire, req.params.matricule));
  })
);

router.post(
  '/indisciplines',
  ENCADREMENT,
  validate({ body: indisciplineSchema }),
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await discipline.ajouterIndiscipline(req.etablissementId, req.anneeScolaire, req.body, req.utilisateur._id)
      );
    annoncer(req, 'indiscipline');
  })
);

router.delete(
  '/indisciplines/:id',
  ENCADREMENT,
  validate({ params: identifiant }),
  route(async (req, res) => {
    await discipline.supprimerIndiscipline(req.etablissementId, req.anneeScolaire, req.params.id);
    res.json({ success: true });
    annoncer(req, 'indiscipline');
  })
);

router.get(
  '/',
  validate({
    query: z.object({
      groupe: z.string().trim().max(200).optional(),
      matricule: z.string().trim().max(50).optional(),
    }),
  }),
  route(async (req, res) => {
    res.json(await appelService.lister(req.etablissementId, req.anneeScolaire, req.query, acteur(req)));
  })
);

/**
 * Le(s) billet(s) d'excuse (Word, PDF ou Excel) d'une ou plusieurs absences
 * ou retards JUSTIFIÉS (2026-09-29, demande du porteur : « si une absence ou
 * retard est justifié afficher un billet d'absence » ; « si deux stagiaires
 * justifient en même temps il s'affiche deux billets » ; « je veux avec trois
 * word, pdf, excel »), canevas transmis — voir `exportBilletAbsence.service.js`.
 * Un seul identifiant rend un seul billet ; plusieurs en rendent autant, sur
 * le même gabarit à quatre par page.
 *
 * ⚠️ RÉSERVÉE À L'ENCADREMENT, comme `/:id` (justifier) : c'est la suite du
 * même geste.
 */
router.post(
  '/billets',
  ENCADREMENT,
  validate({
    body: z.object({
      format: z.enum(['docx', 'pdf', 'xlsx']),
      ids: z.array(z.string().regex(/^[a-f0-9]{24}$/, 'Identifiant invalide')).min(1).max(200),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireBilletsAbsence(
      req.etablissementId,
      req.anneeScolaire,
      req.body.ids,
      req.body.format
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(tampon);
  })
);

/**
 * Une page de billets VIERGES, à remplir à la main — depuis la page Documents
 * (2026-10-01). Voir `construireBilletsVierges`.
 *
 * ⚠️ PAS RÉSERVÉE À L'ENCADREMENT, contrairement à `/billets` : la page
 * Documents s'ouvre aussi en consultation, et un billet vierge ne dit rien de
 * personne.
 */
router.post(
  '/billets/vierges',
  validate({ body: z.object({ format: z.enum(['docx', 'pdf']) }) }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireBilletsVierges(req.anneeScolaire, req.body.format);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(tampon);
  })
);

router.patch(
  '/:id',
  ENCADREMENT,
  validate({ params: identifiant, body: justificationAbsenceSchema }),
  route(async (req, res) => {
    res.json(await appelService.justifier(req.etablissementId, req.anneeScolaire, req.params.id, req.body));
    annoncer(req, 'justification');
  })
);

router.delete(
  '/:id',
  ENCADREMENT,
  validate({ params: identifiant }),
  route(async (req, res) => {
    await appelService.supprimer(req.etablissementId, req.anneeScolaire, req.params.id);
    res.json({ success: true });
    annoncer(req, 'absence');
  })
);

export default router;
