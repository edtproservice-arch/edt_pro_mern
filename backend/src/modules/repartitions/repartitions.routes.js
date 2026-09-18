import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { Repartition } from '../../models/Repartition.js';

/**
 * Référentiel DRIF — cascade de sélection de la carte d'établissement (F3).
 * ← api/data/get_repartitions.php
 *
 * ═══ DIFFÉRENCE DE FOND AVEC L'EXISTANT ═══
 * `get_repartitions.php` renvoyait les **13 359 lignes** au navigateur — 3 Mo à
 * chaque ouverture du panneau — qui les filtrait ensuite en JavaScript. Ici
 * chaque niveau de la cascade est une requête indexée qui rend quelques dizaines
 * de valeurs, et les modules ne sont chargés que pour la filière retenue.
 */
const router = Router();

/*
 * ⚠️ OUVERT AU FORMATEUR EN LECTURE (Phase 5bis, étape d3) : la carte
 * d'affectations se reconstruit en croisant la base avec CE référentiel, et un
 * formateur invité sur « Affectations » tombait sinon en 403 — la page entière
 * affichait « Accès refusé ». Ce sont les programmes NATIONAUX publiés par la
 * DRIF, aucune donnée d'établissement ; et ce routeur n'écrit rien (l'écriture
 * vit dans `repartitions.admin.routes.js`, sous le rôle ADMIN). Le stagiaire
 * reste dehors : aucun de ses écrans ne le lit.
 */
router.use(authenticate, requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR));

const filtreSchema = z.object({
  secteur: z.string().trim().max(150).optional(),
  niveau: z.string().trim().max(30).optional(),
  creneau: z.string().trim().max(10).optional(),
  annee: z.coerce.number().int().min(1).max(5).optional(),
  filiere: z.string().trim().max(80).optional(),
});

/** Filtre Mongo correspondant aux niveaux déjà choisis. */
function critere({ secteur, niveau, creneau, annee }) {
  const filtre = {};
  if (secteur) filtre.secteur = secteur;
  if (niveau) filtre.niveauFormation = niveau;
  // « ALL » : le directeur ne veut pas trancher entre jour et soir.
  if (creneau && creneau !== 'ALL') filtre.creneau = creneau;
  if (annee) filtre.anneeFormation = annee;
  return filtre;
}

router.get('/secteurs', async (req, res, next) => {
  try {
    const secteurs = await Repartition.distinct('secteur', { secteur: { $ne: '' } });
    res.json({ success: true, secteurs: secteurs.sort((a, b) => a.localeCompare(b, 'fr')) });
  } catch (error) {
    next(error);
  }
});

router.get('/niveaux', validate({ query: filtreSchema }), async (req, res, next) => {
  try {
    const niveaux = await Repartition.distinct('niveauFormation', {
      ...critere(req.validatedQuery),
      niveauFormation: { $ne: '' },
    });
    res.json({ success: true, niveaux: niveaux.sort() });
  } catch (error) {
    next(error);
  }
});

router.get('/annees', validate({ query: filtreSchema }), async (req, res, next) => {
  try {
    const annees = await Repartition.distinct('anneeFormation', critere(req.validatedQuery));
    res.json({ success: true, annees: annees.sort((a, b) => a - b) });
  } catch (error) {
    next(error);
  }
});

/**
 * Filières d'une sélection.
 *
 * Un même intitulé peut porter plusieurs codes DRIF (jour / soir, versions
 * successives) : c'est le CODE qui identifie, l'intitulé n'est qu'un libellé.
 * Renvoyer l'un sans l'autre était la cause des sélections ambiguës.
 */
router.get('/filieres', validate({ query: filtreSchema }), async (req, res, next) => {
  try {
    const filieres = await Repartition.aggregate([
      { $match: critere(req.validatedQuery) },
      {
        $group: {
          _id: '$codeFiliereDrif',
          intitule: { $first: '$intituleFiliere' },
          typeFormation: { $first: '$typeFormation' },
          creneau: { $first: '$creneau' },
          modules: { $sum: 1 },
        },
      },
      { $sort: { intitule: 1 } },
    ]);

    res.json({
      success: true,
      filieres: filieres
        .filter((filiere) => filiere._id)
        .map((filiere) => ({
          code: filiere._id,
          intitule: filiere.intitule,
          typeFormation: filiere.typeFormation,
          creneau: filiere.creneau,
          modules: filiere.modules,
        })),
    });
  } catch (error) {
    next(error);
  }
});

const modulesSchema = z.object({
  filiere: z.string().trim().min(1).max(80),
  annee: z.coerce.number().int().min(1).max(5),
});

/** Filière et modules portés par un lot de lignes de répartition. */
function ensembleDepuisLignes(lignes) {
  const premiere = lignes[0];

  return {
    filiere: premiere
      ? {
          code: premiere.codeFiliereDrif,
          intitule: premiere.intituleFiliere,
          secteur: premiere.secteur,
          niveau: premiere.niveauFormation,
          typeFormation: premiere.typeFormation,
          creneau: premiere.creneau,
        }
      : null,
    modules: lignes.map((ligne) => ({
      code: ligne.codeModule,
      nom: ligne.module,
      mhpS1: ligne.mhpS1,
      mhpS2: ligne.mhpS2,
      mhsynS1: ligne.mhsynS1,
      mhsynS2: ligne.mhsynS2,
      mhasynS1: ligne.mhasynS1,
      mhasynS2: ligne.mhasynS2,
      mhpTotale: ligne.mhpTotale,
      mhdTotale: ligne.mhdTotale,
      estRegional: ligne.efmRegional,
      metier: ligne.metier,
    })),
  };
}

/** Modules d'une filière pour une année de formation, masses horaires comprises. */
router.get('/modules', validate({ query: modulesSchema }), async (req, res, next) => {
  try {
    const { filiere, annee } = req.validatedQuery;

    const lignes = await Repartition.find({
      codeFiliereDrif: filiere,
      anneeFormation: annee,
    }).sort({ codeModule: 1 });

    res.json({ success: true, ...ensembleDepuisLignes(lignes) });
  } catch (error) {
    next(error);
  }
});

const ensemblesSchema = z.object({
  // « CODE:ANNEE,CODE:ANNEE ». Borné : au-delà, l'URL cesse d'être transportable
  // et la requête cesse d'être bornée.
  ensembles: z.string().trim().min(1).max(4000),
});

/** « CODE:ANNEE,CODE:ANNEE » → [{ codeFiliere, anneeFormation }], sans doublon. */
function lireEnsembles(valeur) {
  const vus = new Map();

  for (const morceau of valeur.split(',')) {
    const separateur = morceau.lastIndexOf(':');
    if (separateur < 1) continue;

    const codeFiliere = morceau.slice(0, separateur).trim();
    const anneeFormation = Number.parseInt(morceau.slice(separateur + 1), 10);

    if (codeFiliere === '' || !Number.isInteger(anneeFormation)) continue;
    if (anneeFormation < 1 || anneeFormation > 5) continue;

    vus.set(`${codeFiliere}||${anneeFormation}`, { codeFiliere, anneeFormation });
  }

  return [...vus.values()];
}

/**
 * Modules de PLUSIEURS ensembles (filière, année) en un seul appel.
 *
 * ═══ POURQUOI CETTE ROUTE EXISTE ═══
 * L'écran « Affectations » recharge la carte enregistrée : il lui faut la
 * répartition de chaque ensemble présent dans la base. Il lançait donc un appel
 * à `/modules` par ensemble — dix pour une carte de seize groupes, soit dix
 * vérifications de jeton, dix allers-retours HTTP et dix allers-retours vers
 * Atlas, que le navigateur sérialise par vagues de six.
 *
 * Mesuré sur la base réelle (16 groupes, 10 ensembles) : **335 ms** pour les dix
 * requêtes contre **128 ms** pour celle-ci, avant même de compter le HTTP et
 * l'authentification économisés.
 *
 * Le `$or` reste indexé : chaque branche est un préfixe de l'index unique
 * (codeFiliereDrif, anneeFormation, …).
 */
router.get('/modules-multiples', validate({ query: ensemblesSchema }), async (req, res, next) => {
  try {
    const demandes = lireEnsembles(req.validatedQuery.ensembles);

    if (demandes.length === 0) {
      res.json({ success: true, ensembles: {} });
      return;
    }

    const lignes = await Repartition.find({
      $or: demandes.map(({ codeFiliere, anneeFormation }) => ({
        codeFiliereDrif: codeFiliere,
        anneeFormation,
      })),
    }).sort({ codeModule: 1 });

    // Regroupement en mémoire : une passe sur quelques centaines de lignes coûte
    // moins qu'un aller-retour réseau supplémentaire.
    const parEnsemble = new Map();
    for (const ligne of lignes) {
      const cle = `${ligne.codeFiliereDrif}||${ligne.anneeFormation}`;
      if (!parEnsemble.has(cle)) parEnsemble.set(cle, []);
      parEnsemble.get(cle).push(ligne);
    }

    const ensembles = {};
    for (const { codeFiliere, anneeFormation } of demandes) {
      const cle = `${codeFiliere}||${anneeFormation}`;
      // Un ensemble sans aucune ligne est rendu VIDE plutôt qu'omis : l'appelant
      // doit pouvoir distinguer « pas de modules » de « pas demandé ».
      ensembles[cle] = ensembleDepuisLignes(parEnsemble.get(cle) ?? []);
    }

    res.json({ success: true, ensembles });
  } catch (error) {
    next(error);
  }
});

export default router;
