import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { anneeDuNomGroupe } from 'shared/domain';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { forbidden } from '../../lib/httpError.js';
import * as service from './consultation.service.js';
import * as ressources from './ressources.service.js';
import * as reclamation from './reclamation.service.js';
import * as absencesFormateurs from '../absences/absences.service.js';
import * as discipline from '../absencesStagiaires/discipline.service.js';
import * as calendrierService from '../calendrier/calendrier.service.js';
import { Etablissement } from '../../models/Etablissement.js';
import { construireFeuillePresence } from '../absencesStagiaires/exportFeuillePresence.service.js';
import * as demandesDocuments from '../demandesDocuments/demandesDocuments.service.js';
import { TYPES_DEMANDE } from '../../models/DemandeDocument.js';

/**
 * Sessions consultatives — formateur & stagiaire (F14).
 * ← `emploiFormateur.html`, `emploiStagiaire.html`, `avancementFormateur.html`,
 *   `avancementStagiaire.html`, `affectationFormateur.html`
 *
 * ⚠️ UN SEUL ROUTEUR POUR LES DEUX RÔLES, PAS DEUX : « mon emploi » et « mon
 * avancement » posent la MÊME question, seule change l'identité qui répond —
 * un matricule pour un formateur, une liste de groupes pour un stagiaire.
 * Séparer les routeurs aurait dupliqué la validation et le montage pour rien.
 *
 * ⚠️ `identifiant` PORTE LE MATRICULE — c'est la colonne `login` de
 * l'existant, ré-utilisée telle quelle pour retrouver « qui je suis » dans la
 * base e-note ou l'import Konosys, sans table de correspondance en plus.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.FORMATEUR, ROLES.STAGIAIRE), resolveTenant);

/**
 * ⚠️ ELLE N'ACCEPTE PAS `?role=` : le rôle vient TOUJOURS du jeton
 * (`req.utilisateur.role`), jamais d'un paramètre que le client pourrait
 * forger pour se faire passer pour l'autre rôle.
 */
function monIdentite(req) {
  const identifiant = String(req.utilisateur.identifiant ?? '').trim();
  if (identifiant === '') {
    throw forbidden('Ce compte ne porte aucun identifiant', { code: 'IDENTIFIANT_ABSENT' });
  }
  return identifiant;
}

/**
 * `?date=` — même règle que `avancement.routes.js` : une date illisible est
 * IGNORÉE plutôt que refusée, et la borne est la FIN de la journée en heure
 * locale pour inclure les séances du jour désigné.
 */
function dateObservee(req) {
  if (!req.query.date) return null;
  const brute = new Date(`${req.query.date}T23:59:59`);
  return Number.isNaN(brute.getTime()) ? null : brute;
}

router.get('/emploi/semaines', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.semaines(req.etablissementId, req.anneeScolaire)) });
  } catch (error) {
    next(error);
  }
});

/** Les groupes du stagiaire connecté — la page en a besoin pour se titrer. */
router.get('/groupes', requireRole(ROLES.STAGIAIRE), async (req, res, next) => {
  try {
    const donnees = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, monIdentite(req));
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/emploi/:semaine',
  validate({ params: z.object({ semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i) }) }),
  async (req, res, next) => {
    try {
      const identifiant = monIdentite(req);

      const grille =
        req.utilisateur.role === ROLES.FORMATEUR
          ? await service.emploiFormateur(
              req.etablissementId,
              req.anneeScolaire,
              req.params.semaine,
              identifiant
            )
          : await service.emploiStagiaire(
              req.etablissementId,
              req.anneeScolaire,
              req.params.semaine,
              (await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant)).groupes
            );

      res.json({ success: true, ...grille });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/avancement', async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);
    const observation = dateObservee(req);

    const donnees =
      req.utilisateur.role === ROLES.FORMATEUR
        ? await service.avancementFormateur(req.etablissementId, req.anneeScolaire, observation, identifiant)
        : await service.avancementStagiaire(
            req.etablissementId,
            req.anneeScolaire,
            observation,
            (await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant)).groupes
          );

    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * ⚠️ STAGIAIRE SEUL, et c'est le PENDANT de `/affectations` : « qu'est-ce qu'on
 * m'enseigne » contre « qu'est-ce que j'enseigne ». Un formateur a déjà sa
 * réponse dans « Mes affectations » — lui ouvrir celle-ci lui montrerait le
 * programme de groupes auxquels il n'est pas inscrit, puisqu'il n'est inscrit
 * à aucun.
 */
router.get('/programme', requireRole(ROLES.STAGIAIRE), async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);
    const { groupes } = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant);
    const donnees = await service.programmeStagiaire(
      req.etablissementId,
      req.anneeScolaire,
      groupes
    );
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * Ressources en ligne d'un module du programme — vidéos, cours, exercices,
 * cherchées sur le web avec les mots-clés « ofppt », « ofppt life », « ofppt info ».
 * ← `search_ofppt.php` (tiroir de `tableMatieres.html`).
 */
router.get(
  '/programme/ressources',
  requireRole(ROLES.STAGIAIRE),
  validate({
    query: z.object({
      intitule: z.string().trim().min(2).max(160),
      code: z.string().trim().max(40).default(''),
      groupe: z.string().trim().max(80).default(''),
    }),
  }),
  async (req, res, next) => {
    try {
      const { intitule, code, groupe } = req.validatedQuery;
      // ⚠️ LA FILIÈRE VIENT DE LA FICHE DU STAGIAIRE, pas de la requête.
      const filiere = await service.filiereDuGroupe(
        req.etablissementId,
        req.anneeScolaire,
        monIdentite(req),
        groupe
      );
      const donnees = await ressources.ressourcesDuModule(intitule, {
        filiere,
        code,
        annee: groupe ? anneeDuNomGroupe(groupe) : null,
      });
      res.json({ success: true, ...donnees });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ⚠️ FORMATEUR SEUL : un stagiaire n'est affecté à rien, il est INSCRIT à des
 * groupes — c'est `groupesDuStagiaire` qui répond à sa question à lui.
 */
router.get('/affectations', requireRole(ROLES.FORMATEUR), async (req, res, next) => {
  try {
    const donnees = await service.affectationsFormateur(
      req.etablissementId,
      req.anneeScolaire,
      monIdentite(req)
    );
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * ═══ LA PAGE « DOCUMENTS » DU FORMATEUR (2026-10-23, demande du porteur) ═══
 * Les documents qui le concernent, pour SES groupes seulement — d'abord la feuille
 * de présence CC/EFM. `/absences-stagiaires/presence/:modele` reste à l'encadrement :
 * elle accepte n'importe quel groupe. Ici, chaque groupe demandé doit être l'un des
 * siens. (La version vierge passe par `/absences-stagiaires/documents-vierges`,
 * déjà ouverte au formateur : elle ne dit rien de personne.)
 */
router.get('/documents', requireRole(ROLES.FORMATEUR), async (req, res, next) => {
  try {
    const groupes = await service.groupesDuFormateur(req.etablissementId, req.anneeScolaire, monIdentite(req));
    res.json({ success: true, groupes });
  } catch (error) {
    next(error);
  }
});

/*
 * ═══ LA FEUILLE CC/EFM DEPUIS UNE SÉANCE (2026-10-26, demande du porteur : « le
 * même pour CC/EFM — je sélectionne la séance et je coche ») ═══ Avec `seanceId`,
 * la séance — la sienne, vérifiée — donne le groupe, le module, la date et
 * l'horaire ; `epreuve` dit les cases à cocher. Sans elle, l'ancien chemin : des
 * groupes, le reste à la main.
 */
const epreuveSchema = z.object({
  type: z.enum(['cc', 'efm']),
  numero: z.number().int().min(1).max(6).optional(),
  nature: z.enum(['ecrit', 'oral', 'tp']).optional(),
  portee: z.enum(['local', 'regional']).optional(),
});

/*
 * L'en-tête d'une épreuve — contrôle continu ou EFM (2026-10-26) : depuis une de SES séances,
 * vérifiée ; sans séance, l'exemplaire vierge. Voir `reclamation.enteteExamenDeSeance`.
 */
router.post(
  '/documents/entete-examen',
  requireRole(ROLES.FORMATEUR),
  validate({
    body: z.object({
      // Word seulement (2026-10-28) : le formateur écrit son sujet sous l'en-tête.
      format: z.enum(['docx']),
      type: z.enum(['cc', 'efm']),
      seanceId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide').optional(),
      numero: z.number().int().min(1).max(6).optional(),
      portee: z.enum(['local', 'regional']).optional(),
      epreuve: z.enum(['th', 'tp', 'sy']).optional(),
      duree: z.enum(['1H', '1H30', '2H', '2H30', '3H', '5H']).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      envoyerFichier(
        res,
        await reclamation.enteteExamenDeSeance(
          req.etablissementId,
          req.anneeScolaire,
          // Sans séance, rien ne se rattache au formateur : l'exemplaire vierge.
          req.body.seanceId ? monIdentite(req) : null,
          req.body
        )
      );
    } catch (erreur) {
      next(erreur);
    }
  }
);

router.post(
  '/documents/presence-cc-efm',
  requireRole(ROLES.FORMATEUR),
  validate({
    body: z
      .object({
        format: z.enum(['docx', 'pdf']),
        groupes: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
        seanceId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide').optional(),
        epreuve: epreuveSchema.optional(),
      })
      .refine((corps) => Boolean(corps.seanceId) || Boolean(corps.groupes?.length), {
        message: 'Choisissez une séance ou des groupes',
      }),
  }),
  async (req, res, next) => {
    try {
      if (req.body.seanceId) {
        envoyerFichier(
          res,
          await reclamation.feuilleCcEfmDeSeance(req.etablissementId, req.anneeScolaire, monIdentite(req), req.body)
        );
        return;
      }

      const { groupes } = req.body;
      const siens = new Set(
        await service.groupesDuFormateur(req.etablissementId, req.anneeScolaire, monIdentite(req))
      );
      const etrangers = groupes.filter((groupe) => !siens.has(groupe));
      if (etrangers.length > 0) {
        throw forbidden('Ces groupes ne sont pas les vôtres', { code: 'GROUPE_ETRANGER', details: { groupes: etrangers } });
      }

      const { tampon, nomFichier, contentType } = await construireFeuillePresence(
        req.etablissementId,
        req.anneeScolaire,
        'cc-efm',
        { format: req.body.format, groupes }
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
      );
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(tampon);
    } catch (error) {
      next(error);
    }
  }
);

/** Les deux saisies de la fiche — action non disciplinaire, dégâts : 256 caractères au plus (2026-10-26, demande du porteur). */
const MAX_SAISIE_RECLAMATION = 256;

/*
 * ═══ LA FICHE DE RÉCLAMATION DU FORMATEUR (2026-10-25, demande du porteur) ═══
 * La séance se choisit dans SON emploi du temps (`/emploi/:semaine`) ; ici, les
 * stagiaires de cette séance, puis la fiche remplie — voir `reclamation.service.js`.
 * Le matricule vient du jeton, jamais de la requête.
 */
router.get(
  '/documents/reclamation/seances/:id/stagiaires',
  requireRole(ROLES.FORMATEUR),
  validate({ params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide') }) }),
  async (req, res, next) => {
    try {
      const stagiaires = await reclamation.stagiairesDeLaSeance(
        req.etablissementId,
        req.anneeScolaire,
        monIdentite(req),
        req.params.id
      );
      res.json({ success: true, stagiaires });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/documents/reclamation',
  requireRole(ROLES.FORMATEUR),
  validate({
    body: z.object({
      format: z.enum(['docx', 'pdf']),
      seanceId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
      matricules: z.array(z.string().trim().min(1).max(40)).min(1).max(60),
      actionNonDisciplinaire: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
      degats: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
    }),
  }),
  async (req, res, next) => {
    try {
      const fichier = await reclamation.ficheReclamation(
        req.etablissementId,
        req.anneeScolaire,
        { matricule: monIdentite(req), nomComplet: req.utilisateur.nomComplet },
        req.body
      );
      envoyerFichier(res, fichier);
    } catch (error) {
      next(error);
    }
  }
);

/** La même fiche, ENVOYÉE au directeur et aux gestionnaires par la messagerie (2026-10-26). */
router.post(
  '/documents/reclamation/envoyer',
  requireRole(ROLES.FORMATEUR),
  validate({
    body: z.object({
      seanceId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
      matricules: z.array(z.string().trim().min(1).max(40)).min(1).max(60),
      actionNonDisciplinaire: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
      degats: z.string().trim().max(MAX_SAISIE_RECLAMATION).default(''),
    }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await reclamation.envoyerReclamation(
        req.etablissementId,
        req.anneeScolaire,
        { id: req.utilisateur.id, matricule: monIdentite(req), nomComplet: req.utilisateur.nomComplet },
        req.body
      );
      res.json({ success: true, envoyes: bilan.envoyes, refuses: bilan.refuses });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ═══ LA PAGE « DOCUMENTS » DU STAGIAIRE (2026-10-23, demande du porteur) ═══
 *   - sa demande de duplicata du diplôme : téléchargée directement, à SON nom
 *     seulement (le matricule vient du jeton). La carte de stagiaire en est
 *     retirée (2026-10-23, demande du porteur) : l'administration la remet ;
 *   - l'attestation de poursuite de formation : DEMANDÉE, parce qu'elle doit être
 *     signée et cachetée — l'administration la traite (`/demandes-documents`).
 */
const envoyerFichier = (res, { tampon, nomFichier, contentType }) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(tampon);
};

router.get('/mes-documents', requireRole(ROLES.STAGIAIRE), async (req, res, next) => {
  try {
    const matricule = monIdentite(req);
    res.json({ success: true, demandes: await demandesDocuments.demandesDuStagiaire(req.etablissementId, matricule) });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/mes-documents/duplicata',
  requireRole(ROLES.STAGIAIRE),
  validate({ body: z.object({ format: z.enum(['docx', 'pdf']) }) }),
  async (req, res, next) => {
    try {
      const matricule = monIdentite(req);
      const { groupes } = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, matricule);
      envoyerFichier(
        res,
        await construireFeuillePresence(req.etablissementId, req.anneeScolaire, 'duplicata', {
          format: req.body.format,
          groupes,
          matricules: [matricule],
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/demandes',
  requireRole(ROLES.STAGIAIRE),
  validate({ body: z.object({ type: z.enum(TYPES_DEMANDE) }) }),
  async (req, res, next) => {
    try {
      const matricule = monIdentite(req);
      const { groupePrincipal } = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, matricule);
      const demande = await demandesDocuments.demander(req.etablissementId, req.anneeScolaire, {
        type: req.body.type,
        matricule,
        nomComplet: req.utilisateur.nomComplet,
        groupe: groupePrincipal ?? '',
      });
      res.status(201).json({ success: true, demande });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * « Mes absences » — la section de la page Compte (2026-09-23).
 *   - formateur : ses absences au registre, avec leur rattrapage ;
 *   - stagiaire : sa fiche de discipline — absences, retards, indisciplines et note.
 *
 * ⚠️ LE MATRICULE VIENT DU JETON, jamais de la requête : c'est ce qui permet
 * d'ouvrir cette lecture sans le droit de page « absences ».
 */
router.get('/absences', async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);

    if (req.utilisateur.role === ROLES.FORMATEUR) {
      const absences = await absencesFormateurs.lister(req.etablissementId, req.anneeScolaire, {
        formateurMatricule: identifiant,
      });
      res.json({ success: true, role: ROLES.FORMATEUR, absences });
      return;
    }

    const fiche = await discipline.fiche(req.etablissementId, req.anneeScolaire, identifiant);
    res.json({ success: true, role: ROLES.STAGIAIRE, ...fiche });
  } catch (error) {
    next(error);
  }
});

/**
 * La fiche du compte connecté — matricule, masse horaire et groupes pour un
 * formateur ; CEF, filière, niveau et groupes pour un stagiaire. Affichée dans
 * la page Compte. Le matricule vient du jeton, jamais de la requête.
 */
router.get('/fiche', async (req, res, next) => {
  try {
    const fiche = await service.ficheCompte(
      req.etablissementId,
      req.anneeScolaire,
      req.utilisateur.role,
      monIdentite(req)
    );
    res.json({ success: true, fiche });
  } catch (error) {
    next(error);
  }
});

/**
 * « Mes stages » (stagiaire) et « Mes formations » (formateur) — 2026-10-10,
 * demande du porteur. Les périodes déclarées par la direction, restreintes au
 * compte connecté :
 *   - stagiaire : les stages de SES groupes (`groupesDuStagiaire`) ;
 *   - formateur : ses formations, appariées sur son MATRICULE.
 *
 * ⚠️ LE CALENDRIER VOYAGE AVEC LES PÉRIODES : `/calendrier` et ses jours fériés
 * sont réservés à la direction. Sans eux ici, la frise de ces comptes
 * s'afficherait sans vacances ni fériés.
 */
router.get('/periodes', async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);
    const estStagiaire = req.utilisateur.role === ROLES.STAGIAIRE;

    const [etablissement, calendrier, feries] = await Promise.all([
      Etablissement.findById(req.etablissementId).select('stages formations').lean(),
      calendrierService.obtenir(req.etablissementId, req.anneeScolaire).catch(() => null),
      calendrierService.joursFeries(req.etablissementId, req.anneeScolaire).catch(() => null),
    ]);

    let periodes;
    let groupes = [];
    if (estStagiaire) {
      ({ groupes } = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant));
      periodes = (etablissement?.stages ?? [])
        .filter((stage) => groupes.includes(stage.groupe))
        .map(({ groupe, debut, fin }) => ({ groupe, debut, fin }));
    } else {
      periodes = (etablissement?.formations ?? [])
        .filter((formation) => formation.matriculeFormateur === identifiant)
        // Le motif (2026-10-11) : le formateur lit pourquoi il est indisponible — une période sans motif est une formation.
        .map(({ matriculeFormateur, nomFormateur, debut, fin, motif }) => ({
          matriculeFormateur,
          nomFormateur,
          debut,
          fin,
          motif: motif || 'Formation',
        }));
    }

    res.json({
      success: true,
      role: req.utilisateur.role,
      anneeScolaire: req.anneeScolaire,
      groupes,
      periodes: periodes.sort((a, b) => a.debut.localeCompare(b.debut)),
      // Ce qu'il faut à la frise, rien de plus.
      calendrier: {
        nationales: calendrier?.nationales ?? [],
        vacances: calendrier?.vacances ?? [],
        ecartees: calendrier?.ecartees ?? [],
        rentrees: calendrier?.rentrees ?? [],
      },
      joursFeries: feries?.joursFeries ?? [],
    });
  } catch (error) {
    next(error);
  }
});

export default router;
