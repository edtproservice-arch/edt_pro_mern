import mongoose from 'mongoose';

/**
 * Trace d'une génération automatique (F6 · étape d).
 *
 * ═══ POURQUOI CETTE COLLECTION EXISTE ═══ « Sans cela, rien à entraîner dans
 * six mois » (§Phase 6). Une génération est aujourd'hui sans mémoire : le
 * problème soumis, la solution rendue et les raisons des non-placements
 * disparaissent dès que la semaine est écrite. On garde les trois, plus ce que
 * le directeur en a finalement GARDÉ — c'est cette dernière partie qui porte le
 * signal, le reste n'apprend qu'à imiter le glouton.
 *
 * ⚠️ TOUT EST PSEUDONYMISÉ À L'ÉCRITURE (décision du porteur, 2026-09-21) :
 *    aucun matricule, aucun nom de groupe ni de salle n'entre ici. Le sel qui
 *    permettrait de remonter vit dans `AutoGenConfig` et ne quitte jamais la
 *    production — le corpus, lui, peut en sortir.
 *
 * ⚠️ LE MODULE RESTE EN CLAIR : c'est un code du référentiel NATIONAL DRIF, pas
 *    une donnée d'établissement, et il permet de recouper le corpus avec la
 *    répartition pour en tirer de vraies caractéristiques.
 *
 * Volume mesuré sur les données réelles : ~36 Ko de problème + ~14 Ko de
 * solution, soit ~50 Ko par semaine générée — très loin de la limite BSON.
 */

/** Ce que le directeur a fait de la proposition. */
export const STATUTS_TRACE = {
  /** Générée, pas encore figée : le directeur peut encore corriger. */
  EN_COURS: 'en_cours',
  /** La grille a été publiée, ou le délai est passé : elle fait foi. */
  RETENUE: 'retenue',
  /** Une nouvelle génération a remplacé celle-ci avant qu'elle ne soit figée. */
  REJETEE: 'rejetee',
};

/** Ce qui a déclenché le figeage — l'un dit bien plus que l'autre. */
export const CAUSES_FIGEAGE = {
  /** Le directeur a PUBLIÉ la semaine : un geste métier qui dit « elle fait foi ». */
  PUBLICATION: 'publication',
  /** Personne ne l'a publiée, le délai est écoulé : on fige l'état observé. */
  DELAI: 'delai',
};

const traceGenerationSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true },
    semaine: { type: String, required: true, trim: true },

    lanceePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lanceeLe: { type: Date, required: true, default: Date.now },

    /**
     * ⚠️ QUI A PRODUIT CETTE GRILLE. Sans ce champ, les sorties du glouton et
     *    celles de CP-SAT (étape e) se mélangeraient dans le même corpus.
     *    Renseigné depuis le `rapport` du solveur, qui le porte lui-même.
     */
    moteur: { type: String, trim: true, default: 'inconnu' },
    versionMoteur: { type: String, trim: true, default: '' },

    /** Rend la génération rejouable à l'identique. */
    graine: { type: Number },
    assouplissement: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * ⚠️ LES COMPOSITIONS FQ ÉTAIENT-ELLES DÉCLARÉES ? (constat du 2026-09-21 :
     *    les seuls groupes FQ que la génération rencontrait n'en avaient
     *    aucune.) Sans ce drapeau, on entraînerait un modèle sur des grilles qui
     *    ignorent une contrainte réelle, sans jamais pouvoir les écarter.
     */
    compositionsFq: { type: Number, default: 0 },

    /* ── Le problème soumis, la solution rendue ─────────────────────────── */
    probleme: { type: mongoose.Schema.Types.Mixed, required: true },
    /**
     * Le descripteur enrichi des tâches. Le contrat Python ne porte NI le
     * module NI le type — sans eux, ni l'écart ni les caractéristiques
     * d'entraînement ne se calculent.
     */
    taches: { type: mongoose.Schema.Types.Mixed, default: [] },
    solution: { type: mongoose.Schema.Types.Mixed, required: true },

    /** Ce que l'écriture a réellement produit, refus compris. */
    resultat: { type: mongoose.Schema.Types.Mixed, default: {} },

    /* ── Ce que le directeur en a gardé ─────────────────────────────────── */
    statut: {
      type: String,
      enum: Object.values(STATUTS_TRACE),
      default: STATUTS_TRACE.EN_COURS,
      required: true,
    },
    figeeLe: { type: Date, default: null },
    causeFigeage: { type: String, enum: [...Object.values(CAUSES_FIGEAGE), null], default: null },
    /** La grille retenue, pseudonymisée : (tacheId, jour, seance, salle). */
    grilleRetenue: { type: mongoose.Schema.Types.Mixed, default: null },
    /** conservées · déplacées · retirées · ajoutées · fidélité. */
    ecart: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, strict: true }
);

/** Les traces d'une semaine, la plus récente d'abord. */
traceGenerationSchema.index({ etablissementId: 1, anneeScolaire: 1, semaine: 1, lanceeLe: -1 });

/**
 * Le balayage du repli à J+14.
 * ⚠️ PAS D'UNICITÉ SUR (établissement, semaine) : une semaine regénérée garde
 *    ses traces précédentes, marquées « rejetée » — une grille jetée en bloc
 *    dit ce que le directeur NE VEUT PAS, et c'est un signal qu'on perdrait en
 *    ne gardant que les réussites (décision du porteur, 2026-09-21).
 */
traceGenerationSchema.index({ statut: 1, lanceeLe: 1 });

export const TraceGeneration =
  mongoose.models.TraceGeneration ||
  mongoose.model('TraceGeneration', traceGenerationSchema);
