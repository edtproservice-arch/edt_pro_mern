import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate, collaborationDe } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { Etablissement } from '../../models/Etablissement.js';
import { User } from '../../models/User.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './etablissements.service.js';
import { enregistrerAvecCascade } from '../fermetures/fermetures.service.js';
import { nomCourt, renommerLibelles } from '../espaces/espaces.service.js';
import { construireExportPeriodes } from './exportPeriodes.service.js';

/**
 * Établissements et année scolaire (F2).
 * ← api/auth/get_session_etablissements.php, set_etablissement.php,
 *   api/data/get_school_years.php
 *
 * Différence de fond : PHP mémorisait l'établissement actif dans la session
 * serveur (`$_SESSION['etablissement_id']`), ce qui rendait impossible d'ouvrir
 * deux établissements dans deux onglets. Ici l'établissement actif est porté par
 * la requête (en-tête `X-Etablissement-Id`), donc par le client.
 */
const router = Router();

router.use(authenticate);

/** Les établissements auxquels le compte connecté a accès. */
router.get('/', async (req, res, next) => {
  try {
    const etablissements = await Etablissement.find({
      // L'administrateur en collaboration n'a que l'établissement de son jeton.
      _id: { $in: collaborationDe(req.utilisateur) ? [collaborationDe(req.utilisateur)] : req.utilisateur.etablissementIds },
    }).sort({ nom: 1 });

    res.json({
      success: true,
      etablissements: etablissements.map(presenter),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Contexte courant : établissement actif et année scolaire retenue.
 * Permet au client de vérifier ce que le serveur a réellement résolu.
 */
router.get('/courant', resolveTenant, (req, res) => {
  res.json({
    success: true,
    etablissement: presenter(req.etablissement),
    anneeScolaire: req.anneeScolaire,
    anneesDisponibles: anneesDisponibles(req.etablissement),
  });
});

/*
 * ⚠️ LA VERSION LUE PAR L'ÉCRAN (étape d3). Facultative : l'assistant de
 * configuration écrit sans elle — voir `lib/versionOptimiste.js`.
 */
const version = z.number().int().min(0).optional();

/**
 * Une route qui REMPLACE une liste de l'établissement.
 *
 * ═══ PAR DROIT SUR LA PAGE, PLUS PAR RÔLE (étape d3) ═══
 * Le directeur passe par son rôle (propriétaire), un invité « peut modifier »
 * par son partage. ⚠️ Le gestionnaire perd l'écriture par son seul rôle — la
 * règle déjà appliquée aux absences et au chronogramme en d2 ; son menu ne lui
 * ouvrait d'ailleurs plus ces pages depuis le 2026-09-03.
 *
 * ⚠️ L'ANNONCE PRÉVIENT AUSSI LES PAGES QUI LISENT LA LISTE : une salle
 * ajoutée doit apparaître dans la grille d'un collègue, un stage verrouiller
 * sa colonne de chronogramme.
 */
function remplacementDeListe(champ, page, schema, pagesAnnoncees) {
  return [
    resolveTenant,
    exigerDroitPage(page, 'modifier'),
    validate({ body: schema }),
    async (req, res, next) => {
      try {
        const resultat = await service.remplacerListe(
          req.etablissementId,
          champ,
          req.body[champ],
          req.body.version
        );
        res.json({ success: true, [champ]: resultat.valeur, version: resultat.version });
        annoncerModification(req, [page, ...pagesAnnoncees], { action: 'enregistrer' });
      } catch (error) {
        next(error);
      }
    },
  ];
}

/**
 * Une route qui remplace une liste de PÉRIODES (stages, formations) — avec la
 * cascade du 2026-09-23 : une période nouvelle supprime les séances et les
 * heures de chronogramme qu'elle recouvre, mais seulement après un oui
 * explicite (`confirmerSuppressions`). Voir `modules/fermetures`.
 *
 * ⚠️ MÊMES DROITS, MÊME VERSION, MÊME ANNONCE que `remplacementDeListe` : seule
 * l'écriture change de chemin. La grille et l'avancement sont prévenus en plus,
 * puisque des séances peuvent y disparaître.
 */
function remplacementDePeriodes(champ, page, schema, pagesAnnoncees) {
  return [
    resolveTenant,
    exigerDroitPage(page, 'modifier'),
    validate({ body: schema }),
    async (req, res, next) => {
      try {
        const { etablissement, cascade } = await enregistrerAvecCascade(req.etablissementId, {
          anneeScolaire: req.anneeScolaire,
          $set: { [champ]: req.body[champ] },
          cheminVersion: `versions.${champ}`,
          version: req.body.version,
          confirmerSuppressions: req.body.confirmerSuppressions,
        });
        res.json({
          success: true,
          [champ]: etablissement[champ],
          version: etablissement.versions?.[champ] ?? 0,
          cascade,
        });
        annoncerModification(req, [page, ...pagesAnnoncees], { action: 'enregistrer' });
      } catch (error) {
        next(error);
      }
    },
  ];
}

/*
 * ⚠️ FAUX PAR DÉFAUT : c'est tout le garde-fou de la cascade (2026-09-23).
 */
const confirmerSuppressions = z.boolean().default(false);

const espacesSchema = z.object({
  version,
  espaces: z
    .array(z.string().trim().min(1).max(60))
    .max(500)
    // Dédoublonnage insensible à la casse, comme setup.html:985 — « Salle 1 » et
    // « salle 1 » désignent la même pièce, et deux entrées feraient croire à
    // deux salles libres au générateur.
    .transform((liste) => {
      const vues = new Set();
      return liste.filter((espace) => {
        const cle = espace.toLowerCase();
        if (vues.has(cle)) return false;
        vues.add(cle);
        return true;
      });
    }),
});

/**
 * Liste des espaces de travail (salles).
 * ← api/setup/complete_setup.php:290-294, api/profile/save_espaces.php
 *
 * Remplacement complet, comme en PHP (`DELETE` puis `INSERT`) : l'écran envoie
 * la liste telle qu'affichée, et une salle retirée doit disparaître.
 */
router.put('/courant/espaces', remplacementDeListe('espaces', 'espaces', espacesSchema, ['emploi', 'efm']));

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jour = z.string().regex(JOUR, 'Date attendue au format AAAA-MM-JJ');

/**
 * Remet une période saisie à l'envers dans le bon sens.
 *
 * Les dates sont des CHAÎNES « AAAA-MM-JJ » : leur ordre alphabétique EST leur
 * ordre chronologique. Une période inversée passerait sinon les contrôles et
 * ne rendrait jamais personne indisponible — un stage invisible.
 */
const remettreEnOrdre = (periode) =>
  periode.debut <= periode.fin ? periode : { ...periode, debut: periode.fin, fin: periode.debut };

const stagesSchema = z.object({
  version,
  confirmerSuppressions,
  stages: z
    .array(
      z
        .object({
          groupe: z.string().trim().min(1).max(100),
          debut: jour,
          fin: jour,
        })
        .strict()
        .transform(remettreEnOrdre)
    )
    .max(300)
    .default([]),
});

const formationsSchema = z.object({
  version,
  confirmerSuppressions,
  formations: z
    .array(
      z
        .object({
          /*
           * ⚠️ Le MATRICULE est obligatoire, pas le nom. `isFormateurEnFormation()`
           * apparie d'abord dessus ; la table MySQL d'origine laissait
           * `nom_formateur` nullable, et une ligne au nom vide rendait TOUS les
           * formateurs indisponibles sur sa période (cf. le défaut corrigé dans
           * shared/src/domain/planning/calendrier.js).
           */
          matriculeFormateur: z.string().trim().min(1).max(20),
          nomFormateur: z.string().trim().max(150).default(''),
          debut: jour,
          fin: jour,
        })
        .strict()
        .transform(remettreEnOrdre)
    )
    .max(300)
    .default([]),
});

/**
 * Périodes de stage, par groupe.
 * ← table `stages` + le panneau « stages » de profile.html
 *
 * Pendant un stage, le groupe est en entreprise : aucune séance ne peut lui
 * être placée. Remplacement complet, comme les espaces — l'écran envoie la
 * liste telle qu'affichée.
 */
router.put(
  '/courant/stages',
  remplacementDePeriodes('stages', 'stages', stagesSchema, ['emploi', 'chronogramme', 'avancement'])
);

/**
 * Formations suivies par les formateurs.
 * ← table `formations` + le panneau « formations » de profile.html
 *
 * Un formateur en formation est indisponible : le générateur ne doit rien lui
 * placer sur la période.
 */
router.put(
  '/courant/formations',
  remplacementDePeriodes('formations', 'formations', formationsSchema, [
    'emploi',
    'chronogramme',
    'avancement',
  ])
);

/**
 * Les périodes de stage ou de formation en Word, PDF ou Excel (2026-10-10,
 * demande du porteur). La liste vient de l'ÉCRAN — voir
 * `exportPeriodes.service.js`. Lire la page suffit : exporter n'écrit rien.
 */
const exportPeriodesSchema = z.object({
  format: z.enum(['docx', 'pdf', 'xlsx']),
  // « calendrier » : l'écran montrait la frise — le document ajoute le Gantt.
  affichage: z.enum(['liste', 'calendrier']).default('liste'),
  periodes: z
    .array(
      z
        .object({
          sujet: z.string().trim().min(1).max(150),
          detail: z.string().trim().max(150).default(''),
          debut: jour,
          fin: jour,
        })
        .strict()
        .transform(remettreEnOrdre)
    )
    .max(2000),
});

for (const type of ['stages', 'formations']) {
  router.post(
    `/courant/${type}/export`,
    resolveTenant,
    exigerDroitPage(type, 'consulter'),
    validate({ body: exportPeriodesSchema }),
    async (req, res, next) => {
      try {
        const { tampon, nomFichier, contentType } = await construireExportPeriodes({
          etablissementId: req.etablissementId,
          anneeScolaire: req.anneeScolaire,
          type,
          format: req.body.format,
          affichage: req.body.affichage,
          periodes: req.body.periodes,
        });
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
}

/*
 * ⚠️ UN COUPLE NE FIGURE QU'UNE FOIS. La table d'origine portait une clé unique
 * `(etablissement, fq, constituant)` ; ici la liste est remplacée en bloc, donc
 * rien ne l'empêcherait plus. Un doublon ne casserait rien au calcul — les
 * groupes comparés sont un ensemble — mais il s'afficherait deux fois dans la
 * composition, et on chercherait lequel supprimer.
 */
const groupesFqSchema = z.object({
  version,
  groupesFq: z
    .array(
      z
        .object({
          groupeFq: z.string().trim().min(1).max(100),
          groupeConstituant: z.string().trim().min(1).max(100),
        })
        .strict()
    )
    .max(500)
    .default([])
    .transform((liens) => {
      const vus = new Set();
      return liens.filter((lien) => {
        const cle = `${lien.groupeFq} ${lien.groupeConstituant}`;
        if (vus.has(cle)) return false;
        vus.add(cle);
        return true;
      });
    })
    /*
     * ⚠️ UN GROUPE NE SE COMPOSE PAS DE LUI-MÊME. Le lien serait sans effet sur
     * les conflits — l'ensemble le contient déjà — mais il rendrait la
     * composition illisible, et l'écran l'affiche comme un constituant.
     */
    .refine(
      (liens) => liens.every((lien) => lien.groupeFq !== lien.groupeConstituant),
      { message: 'Un groupe FQ ne peut pas se composer de lui-même' }
    ),
});

/**
 * Composition des groupes FQ.
 * ← table `fq_group_mappings` + le panneau « Affectation des Groupes aux FQ »
 *
 * ═══ À QUOI ELLE SERT ═══
 * Un groupe FQ (formation qualifiante) n'a pas de stagiaires à lui : ce sont
 * ceux des groupes réels qui le composent. Déclarer la composition permet à la
 * détection de conflits de refuser un cours posé sur un constituant pendant que
 * le FQ siège — ce sont les mêmes personnes.
 *
 * Remplacement complet, comme les stages et les formations : l'écran envoie la
 * liste telle qu'affichée.
 */
router.put(
  '/courant/groupes-fq',
  remplacementDeListe('groupesFq', 'groupesFq', groupesFqSchema, ['emploi'])
);

/**
 * Nom abrégé de l'établissement.
 * ← `etablissements.nom_abrege`, modélisé mais qu'aucun écran ne remplissait.
 *
 * ═══ À QUOI IL SERT ═══
 * Le nom officiel — « Institut Spécialisé de Technologie Appliquée NTIC Sidi
 * Maârouf » — ne tient ni dans un en-tête de grille, ni sur une carte de
 * stagiaire, ni dans le pied d'une liste d'émargement. C'est cette forme
 * courte qui y figure. Vide, ces documents retombent sur le nom complet et
 * débordent.
 */
const nomAbregeSchema = z.object({
  nomAbrege: z
    .string()
    .trim()
    .min(2, 'Le nom abrégé doit compter au moins 2 caractères')
    // 30 : au-delà, ce n'est plus une abréviation, et les en-têtes débordent.
    .max(30, 'Le nom abrégé ne doit pas dépasser 30 caractères'),
});

router.patch(
  '/courant/nom-abrege',
  requireRole(ROLES.DIRECTEUR),
  resolveTenant,
  validate({ body: nomAbregeSchema }),
  async (req, res, next) => {
    try {
      const avant = nomCourt(req.etablissement);
      req.etablissement.nomAbrege = req.body.nomAbrege;
      await req.etablissement.save();
      // Le nom abrégé est dans le libellé des espaces qu'on prête (« Salle 4 (ISTA NTIC) ») :
      // les séances des établissements qui les utilisent suivent, sans quoi elles perdent leur pièce.
      await renommerLibelles(req.etablissement, avant, nomCourt(req.etablissement));
      res.json({ success: true, nomAbrege: req.etablissement.nomAbrege });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Clôture de la configuration initiale.
 * ← api/setup/complete_setup.php:300
 *
 * Le drapeau est porté par l'UTILISATEUR et non par l'établissement, comme
 * `utilisateurs.is_setup_complete` en base : c'est le directeur qui a
 * configuré, et c'est sa redirection de connexion qui en dépend.
 *
 * Idempotent : rappeler la route sur un compte déjà configuré répond sans rien
 * changer, plutôt que d'échouer — le directeur qui revient corriger son
 * calendrier repasse par cette étape.
 */
/*
 * ═══ OÙ EN EST LA CONFIGURATION (2026-09-20) ═══
 * L'assistant y lit ce qui est DÉJÀ FAIT pour reprendre là où l'on s'est arrêté — après une
 * déconnexion, une coupure de réseau, un onglet fermé. Voir
 * `shared/domain/etablissement/configuration.js`.
 */
router.get(
  '/courant/configuration-progression',
  requireRole(ROLES.DIRECTEUR),
  resolveTenant,
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        ...(await service.progressionConfiguration(req.etablissement, req.anneeScolaire)),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/courant/configuration-terminee',
  requireRole(ROLES.DIRECTEUR),
  resolveTenant,
  async (req, res, next) => {
    try {
      /*
       * ⚠️ ON PEUT CLORE UNE CONFIGURATION INCOMPLÈTE (2026-09-20, demande du porteur —
       * elle revient sur la règle posée le même jour : « permettre de terminer, mais
       * verrouiller, dans l'application, les pages qui dépendent d'étapes non faites »).
       * La clôture ne juge donc plus : elle lève la porte de l'application. Ce qui manque
       * se lit par `configuration-progression`, et c'est l'écran de chaque page qui se
       * verrouille, avec la liste des étapes à finir.
       */
      await User.updateOne({ _id: req.utilisateur.id }, { $set: { configurationTerminee: true } });

      /*
       * ═══ L'ÉTABLISSEMENT ADOPTE L'ANNÉE QU'IL VIENT DE CONFIGURER ═══
       * `etablissement.anneeScolaire` était posé à l'INSCRIPTION et plus jamais
       * revu. Or l'assistant laisse désormais choisir son année, et la déduction
       * elle-même a pu changer entre-temps : un directeur inscrit en mai 2027
       * (donc sur 2026-2027) qui configure en juin travaille sur 2027-2028.
       *
       * Sans cette ligne, la référence restait sur l'année de l'inscription.
       * `resolveTenant` y retombe dès qu'aucun en-tête `X-Annee-Scolaire` n'est
       * envoyé — autre navigateur, stockage local vidé — et l'établissement
       * s'ouvrait alors sur une année VIDE, sa base étant rangée sous l'autre.
       * Elle sert aussi de pivot à `anneesDisponibles()` : le sélecteur de la
       * barre latérale n'aurait même pas proposé la bonne.
       */
      if (req.etablissement.anneeScolaire !== req.anneeScolaire) {
        await Etablissement.updateOne(
          { _id: req.etablissement.id },
          { $set: { anneeScolaire: req.anneeScolaire } }
        );
      }

      res.json({
        success: true,
        configurationTerminee: true,
        anneeScolaire: req.anneeScolaire,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Années scolaires proposables.
 *
 * ⚠️ Provisoire : la vraie liste doit se déduire des données réellement
 * présentes (bases e-note importées, semaines d'emploi du temps), ce qui
 * suppose les collections des Phases 4 et 5. En attendant, on encadre l'année
 * de référence de l'établissement.
 */
function anneesDisponibles(etablissement) {
  const reference = etablissement.anneeScolaire;
  return [reference - 1, reference, reference + 1];
}

function presenter(etablissement) {
  return {
    id: etablissement.id,
    nom: etablissement.nom,
    nomAbrege: etablissement.nomAbrege,
    region: etablissement.region,
    complexe: etablissement.complexe,
    anneeScolaire: etablissement.anneeScolaire,
    nombreEspaces: etablissement.espaces?.length ?? 0,
    /*
     * La LISTE, et pas seulement son compte : l'écran de réglage des espaces
     * doit repartir de ce qui est enregistré. Sans elle, il s'ouvrait vide et
     * un enregistrement effaçait les salles existantes — `PUT` remplace tout.
     */
    espaces: etablissement.espaces ?? [],
    // Les écrans de réglage repartent de ce qui est enregistré : sans la
    // liste, ils s'ouvriraient vides et le premier `PUT` effacerait tout.
    stages: etablissement.stages ?? [],
    formations: etablissement.formations ?? [],
    groupesFq: etablissement.groupesFq ?? [],
    /*
     * ⚠️ LES VERSIONS REPARTENT AVEC LES LISTES (étape d3) : l'écran renvoie
     * celle qu'il a lue, et c'est ce qui fait refuser une écriture faite sur
     * une liste qu'un collègue a modifiée entre-temps.
     */
    versions: {
      espaces: etablissement.versions?.espaces ?? 0,
      stages: etablissement.versions?.stages ?? 0,
      formations: etablissement.versions?.formations ?? 0,
      groupesFq: etablissement.versions?.groupesFq ?? 0,
      calendrier: etablissement.versions?.calendrier ?? 0,
    },
  };
}

export default router;
