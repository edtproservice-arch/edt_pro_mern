import mongoose from 'mongoose';
import { TYPES_COURS } from 'shared/constants';

/**
 * ← table `donnees_de_base` (5 lignes JSON → 1 document).
 *
 * MySQL stockait une ligne par `(etablissement, année, type)`, chaque ligne
 * portant un blob JSON : `formateur`, `groupe`, `fusion_groupe`, `affectation`,
 * `groupe_mode`. Elles étaient toujours lues ensemble et réécrites ensemble —
 * d'où un seul document ici.
 *
 * (L'enum SQL déclarait un 6e type, `module`, mais aucune ligne n'en porte :
 * les modules se déduisent des affectations.)
 *
 * Le blob `affectation` atteint 123 Ko, très en dessous de la limite BSON de
 * 16 Mo : le regroupement ne pose aucun problème de taille.
 */

/** Un formateur de la base, tel que produit par l'import e-note. */
const formateurSchema = new mongoose.Schema(
  {
    /** Identifiant STABLE. Vide si le fichier n'en portait pas (cf. §4 du plan). */
    matricule: { type: String, trim: true, default: '' },
    nomComplet: { type: String, required: true, trim: true },
    /** Nom court désambiguïsé — sortie de `resoudreHomonymes()`. */
    nomUnique: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    masseHoraire: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

/**
 * Une affectation = un formateur enseigne un module à un groupe.
 *
 * `formateur` porte le MATRICULE quand il existe, sinon le nom complet en
 * repli — jamais une chaîne vide, sous peine de voir l'affectation rejetée
 * silencieusement (c'est le piège documenté dans parse_base_rows.php:236).
 */
const affectationSchema = new mongoose.Schema(
  {
    formateur: { type: String, required: true, trim: true },
    groupe: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: Object.values(TYPES_COURS) },
    s1Heures: { type: Number, default: 0, min: 0 },
    s2Heures: { type: Number, default: 0, min: 0 },
    /** EFM régional — colonne S du fichier e-note. */
    estRegional: { type: Boolean, default: false },
    filiere: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const baseSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    /** Année de septembre. Une seule représentation dans toute l'application. */
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /**
     * Formateurs AVEC leur détail — nom unique, adresse, masse horaire.
     * MySQL séparait `donnees_de_base` (liste courte) et `formateurs_details`
     * (table à part), ce qui obligeait à les tenir cohérentes à la main : c'est
     * l'origine de `reparer_formateurs_details.php`. Une seule liste ici.
     */
    formateurs: [formateurSchema],

    /** Noms APRÈS renommage : suffixes (CDS), (FQ) ou préfixe de filière inclus. */
    groupes: [{ type: String, trim: true }],

    /** Groupes fusionnés, non renommés : « GM101 GM102 ». */
    fusionGroupes: [{ type: String, trim: true }],

    affectations: [affectationSchema],

    /** groupe → « Alterné » | « Résidentiel ». */
    groupeModes: { type: Map, of: String, default: {} },

    /**
     * groupe → codes des modules DÉSACTIVÉS pour ce groupe.
     *
     * ⚠️ SANS CE CHAMP, LA DÉSACTIVATION NE SURVIT PAS À L'ENREGISTREMENT. Un
     * module inactif ne produit AUCUNE ligne e-note — c'est ce qui le retire du
     * bilan et de la charge. Mais la carte se reconstruit en croisant la base
     * avec la répartition DRIF, et le référentiel, lui, connaît toujours le
     * module : il revenait donc ACTIF au rechargement, indiscernable d'un module
     * simplement pas encore affecté.
     *
     * C'est le même piège que `metier`, avec une conséquence visible : le
     * commutateur paraissait sans effet.
     */
    modulesInactifs: { type: Map, of: [String], default: {} },

    /**
     * groupe → code de filière DRIF.
     *
     * ⚠️ SANS CE CHAMP, UN GROUPE SANS AFFECTATION PERD SON IDENTITÉ. La filière
     * se déduisait des affectations, avec un rattrapage par un groupe VOISIN de
     * même préfixe. Un groupe seul dans sa filière — et dont tous les modules
     * sont désactivés ou pas encore affectés — n'avait donc plus de filière : la
     * répartition ne pouvait plus être interrogée, et l'ensemble disparaissait
     * de l'écran alors que le groupe existait toujours en base.
     */
    groupeFilieres: { type: Map, of: String, default: {} },

    /**
     * Version optimiste (Phase 5bis, étape d3) : la carte d'affectations REMPLACE
     * la base entière. Deux personnes sur la carte, et la seconde effaçait le
     * travail de la première. Le compteur survit au remplacement — la nouvelle
     * base reprend celui de l'ancienne, plus un. Voir `lib/versionOptimiste.js`.
     */
    version: { type: Number, default: 0, min: 0 },

    /** Provenance : import e-note, ou carte saisie à la main. */
    origine: { type: String, enum: ['enote', 'carte'], default: 'enote' },
  },
  { timestamps: true, strict: true }
);

// Une seule base par établissement et par année — c'est la clé unique de MySQL,
// conservée.
baseSchema.index({ etablissementId: 1, anneeScolaire: 1 }, { unique: true });

export const Base = mongoose.model('Base', baseSchema);
