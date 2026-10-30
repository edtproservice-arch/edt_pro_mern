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
import { DOCUMENTS_VIERGES, construireDocumentVierge, construireFeuillePresence } from './exportFeuillePresence.service.js';
import { construireExportRegistreAbsences } from './exportRegistreAbsences.service.js';
import { construireExportNotesDiscipline } from './exportNotesDiscipline.service.js';
import { FORMULAIRES_EXAMEN, construireFormulaireExamen } from './exportFormulairesExamen.service.js';
import { adresseDeLaRequete, construireCartesStagiaires, liensDesCartes } from './exportCarteStagiaire.service.js';
import * as documentsDeSeance from '../consultation/reclamation.service.js';
import * as pvSanctions from './pvSanctions.service.js';

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

/*
 * ═══ LES PV DES SANCTIONS D'ASSIDUITÉ (2026-10-26, demande du porteur) ═══
 * La liste des stagiaires dont la sanction actuelle (mise en garde, avertissement,
 * blâme) n'a pas encore son PV, et l'impression d'un PV — en français ou en arabe —,
 * qui le retire de la liste. Voir `pvSanctions.service.js`.
 */
router.get(
  '/pv-sanctions',
  ENCADREMENT,
  validate({ query: z.object({ imprimes: z.enum(['true', 'false']).optional() }) }),
  route(async (req, res) => {
    const stagiaires = await pvSanctions.lister(req.etablissementId, req.anneeScolaire, {
      imprimes: req.validatedQuery?.imprimes === 'true',
    });
    res.json({ success: true, stagiaires });
  })
);

// Les PV de la page Documents, section Discipline — des groupes choisis, ou vierges (2026-10-26).
router.post(
  '/documents-pv-sanctions',
  ENCADREMENT,
  validate({
    body: z.object({
      langue: z.enum(['fr', 'ar']),
      format: z.enum(['docx', 'pdf']),
      vierge: z.boolean().optional(),
      groupes: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
      matricules: z.array(z.string().trim().min(1).max(50)).max(5000).optional(),
    }),
  }),
  route(async (req, res) => {
    envoyerDocument(res, await pvSanctions.imprimerDocuments(req.etablissementId, req.anneeScolaire, req.body, req.utilisateur._id));
  })
);

// Tous les PV en attente, un par page, dans un seul document (2026-10-26).
router.post(
  '/pv-sanctions',
  ENCADREMENT,
  validate({ body: z.object({ langue: z.enum(['fr', 'ar']), format: z.enum(['docx', 'pdf']) }) }),
  route(async (req, res) => {
    envoyerDocument(res, await pvSanctions.imprimerTous(req.etablissementId, req.anneeScolaire, req.body, req.utilisateur._id));
  })
);

router.post(
  '/pv-sanctions/:matricule',
  ENCADREMENT,
  validate({
    params: z.object({ matricule: z.string().trim().min(1).max(50) }),
    body: z.object({ langue: z.enum(['fr', 'ar']), format: z.enum(['docx', 'pdf']) }),
  }),
  route(async (req, res) => {
    envoyerDocument(
      res,
      await pvSanctions.imprimer(req.etablissementId, req.anneeScolaire, req.params.matricule, req.body, req.utilisateur._id)
    );
  })
);

/*
 * ═══ LES DOCUMENTS D'UNE SÉANCE, POUR L'ENCADREMENT (2026-10-26, demande du
 * porteur : « les mêmes options pour le gestionnaire et le directeur, en page
 * Documents ») ═══ Ce que le formateur fait depuis « Mes documents » — fiche de
 * réclamation, feuille CC/EFM —, ouvert à TOUTE séance de l'établissement, et la
 * fiche nomme le FORMATEUR DE LA SÉANCE. Voir `consultation/reclamation.service.js`
 * (`matricule` à `null`).
 *
 * ⚠️ `/documents-seance`, PAS `/seances` : ce préfixe est déjà pris par les
 *    séances de l'appel, et `:id` y serait lu comme un autre paramètre.
 */
const idSeance = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide') });
const MAX_SAISIE_RECLAMATION = 256;

const envoyerDocument = (res, { tampon, nomFichier, contentType }) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(tampon);
};

router.get(
  '/documents-seance/:id/stagiaires',
  ENCADREMENT,
  validate({ params: idSeance }),
  route(async (req, res) => {
    const stagiaires = await documentsDeSeance.stagiairesDeLaSeance(req.etablissementId, req.anneeScolaire, null, req.params.id);
    res.json({ success: true, stagiaires });
  })
);

router.post(
  '/documents-seance/:id/reclamation',
  ENCADREMENT,
  validate({
    params: idSeance,
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      matricules: z.array(z.string().trim().min(1).max(40)).min(1).max(60),
      actionNonDisciplinaire: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
      degats: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
    }),
  }),
  route(async (req, res) => {
    envoyerDocument(
      res,
      await documentsDeSeance.ficheReclamation(req.etablissementId, req.anneeScolaire, null, {
        ...req.body,
        seanceId: req.params.id,
      })
    );
  })
);

router.post(
  '/documents-seance/:id/presence-cc-efm',
  ENCADREMENT,
  validate({
    params: idSeance,
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      epreuve: z
        .object({
          type: z.enum(['cc', 'efm']),
          numero: z.number().int().min(1).max(6).optional(),
          nature: z.enum(['ecrit', 'oral', 'tp']).optional(),
          portee: z.enum(['local', 'regional']).optional(),
        })
        .optional(),
    }),
  }),
  route(async (req, res) => {
    envoyerDocument(
      res,
      await documentsDeSeance.feuilleCcEfmDeSeance(req.etablissementId, req.anneeScolaire, null, {
        ...req.body,
        seanceId: req.params.id,
      })
    );
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
    params: z.object({ modele: z.enum(['eff', 'cc-efm', 'liste', 'badges-sans', 'badges-infos', 'checklist', 'verification', 'retrait-definitif', 'retrait-provisoire', 'attestation-poursuite', 'convention', 'convocation-eff', 'transfert', 'pv-discipline', 'reclamation', 'duplicata', 'reorientation', 'soins']) }),
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      // Seulement ces stagiaires (2026-10-11 : le PV du conseil d'UN stagiaire, depuis « Notes de discipline »).
      matricules: z.array(z.string().trim().min(1).max(50)).min(1).max(500).optional(),
      // La convocation à l'EFF (2026-10-11) : date, horaire et type d'épreuve, communs à tous.
      examen: z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
          debut: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')).optional(),
          fin: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')).optional(),
          epreuve: z.string().trim().max(100).optional(),
          // La feuille CC/EFM d'un groupe, sans séance (2026-10-30) : l'épreuve cochée.
          type: z.enum(['cc', 'efm']).optional(),
          numero: z.number().int().min(1).max(6).optional(),
          nature: z.enum(['ecrit', 'oral', 'tp']).optional(),
          portee: z.enum(['local', 'regional']).optional(),
        })
        .optional(),
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

/**
 * Les cartes de stagiaire des groupes choisis, en Word ou PDF (2026-10-11) —
 * dix par page, QR de connexion au compte. Voir `exportCarteStagiaire.service.js`.
 *
 * ⚠️ RÉSERVÉES À L'ENCADREMENT : chaque QR ouvre la session d'un stagiaire.
 * `renouveler` invalide les cartes déjà imprimées des stagiaires concernés.
 */
router.post(
  '/cartes',
  ENCADREMENT,
  validate({
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      renouveler: z.boolean().default(false),
      // Seulement ces stagiaires (2026-10-17 : le filtre par stagiaire de Documents).
      matricules: z.array(z.string().trim().min(1).max(50)).min(1).max(500).optional(),
      // L'adresse de l'écran (`window.location.origin`) : où mènera le QR — voir `adresseDesLiens`.
      adresse: z.string().trim().max(200).optional(),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireCartesStagiaires(req.etablissementId, req.anneeScolaire, {
      ...req.body,
      // Le QR mène à l'application qu'on utilise — voir `adresseDesLiens`.
      adresse: adresseDeLaRequete(req, req.body.adresse),
    });
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
 * Les liens de connexion (et leurs QR) des stagiaires d'un groupe — la colonne
 * QR de la fiche stagiaire (2026-10-11). Mêmes liens que les cartes imprimées.
 *
 * ⚠️ RÉSERVÉS À L'ENCADREMENT : chaque lien ouvre la session d'un stagiaire. La
 * page Documents se partage en lecture : un formateur invité ne les voit pas.
 */
router.get(
  '/cartes/liens',
  ENCADREMENT,
  validate({
    query: z.object({
      groupe: z.string().trim().min(1).max(200),
      adresse: z.string().trim().max(200).optional(),
    }),
  }),
  route(async (req, res) => {
    const { groupe, adresse } = req.validatedQuery ?? req.query;
    res.json(await liensDesCartes(req.etablissementId, req.anneeScolaire, groupe, adresseDeLaRequete(req, adresse)));
  })
);

/**
 * Les notes de discipline des groupes choisis, en Word, PDF ou Excel
 * (2026-10-11) — une page ou un onglet par groupe. Voir
 * `exportNotesDiscipline.service.js`. Réservées à l'encadrement, comme `/notes`.
 */
router.post(
  '/notes/export',
  ENCADREMENT,
  validate({
    body: z.object({
      format: z.enum(['docx', 'pdf', 'xlsx']),
      groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(300),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireExportNotesDiscipline(
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
 * Le registre des absences de l'année en Excel (2026-10-10) — une ligne par
 * stagiaire, une colonne par jour, les heures non justifiées et justifiées en
 * fin de ligne. Voir `exportRegistreAbsences.service.js`.
 *
 * ⚠️ RÉSERVÉ À L'ENCADREMENT : il porte tous les stagiaires de tous les
 * groupes, et le motif des justifications.
 */
router.post(
  '/registre/export',
  ENCADREMENT,
  validate({
    body: z.object({
      groupes: z.array(z.string().trim().min(1).max(200)).max(300).optional(),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireExportRegistreAbsences(
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

/**
 * Les documents VIERGES de la page Documents (2026-10-17) — la fiche du candidat
 * fils d'agent, la demande de duplicata et le PV de réorientation imprimés vides :
 * voir `construireDocumentVierge`.
 * Ouverts comme les billets vierges : ils ne disent rien de personne.
 */
router.post(
  '/documents-vierges',
  validate({ body: z.object({ cle: z.enum(Object.keys(DOCUMENTS_VIERGES)), format: z.enum(['docx', 'pdf']) }) }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireDocumentVierge(
      req.etablissementId,
      req.anneeScolaire,
      req.body.cle,
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
 * Les formulaires d'examen VIERGES de la carte « Examen » de la page Documents
 * (2026-10-11, treize canevas transmis) — voir `exportFormulairesExamen.service.js`.
 * Ouverts comme les billets vierges : ils ne disent rien de personne.
 */
router.post(
  '/formulaires-examen',
  validate({
    body: z.object({
      cle: z.enum(Object.keys(FORMULAIRES_EXAMEN)),
      format: z.enum(['docx', 'pdf']),
    }),
  }),
  route(async (req, res) => {
    const { tampon, nomFichier, contentType } = await construireFormulaireExamen(req.body.cle, req.body.format);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(tampon);
  })
);

/** Les cours passés dont l'appel n'a pas été validé — le rappel au formateur (2026-10-25). */
router.get(
  '/appel/en-attente',
  route(async (req, res) => {
    res.json(await appelService.appelsEnAttente(req.etablissementId, req.anneeScolaire, acteur(req)));
  })
);

/** Justifier toutes les absences d'un stagiaire sur une période (2026-10-25) — l'encadrement, comme `/:id`. */
router.post(
  '/justifier-periode',
  ENCADREMENT,
  validate({
    body: z
      .object({
        matricule: z.string().trim().min(1).max(50),
        du: jour,
        au: jour,
        motif: z.string().trim().max(255).optional(),
        retards: z.boolean().default(false),
      })
      .strict(),
  }),
  route(async (req, res) => {
    res.json(await appelService.justifierPeriode(req.etablissementId, req.anneeScolaire, req.body));
    annoncer(req, 'justification');
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
