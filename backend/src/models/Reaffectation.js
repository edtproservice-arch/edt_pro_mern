import mongoose from 'mongoose';

/**
 * Le JOURNAL DES RÉAFFECTATIONS (2026-10-22, demande du porteur : « il faut une
 * traçabilité quand un module affecté à un formateur est réaffecté à un autre »).
 *
 * ═══ POURQUOI UNE COLLECTION À PART ═══
 * La carte des affectations (`Base`) est REMPLACÉE en entier à chaque
 * enregistrement — et elle s'enregistre toute seule pendant la saisie. Rien de
 * ce qu'elle porte ne survit donc d'une version à l'autre : l'historique doit
 * vivre ailleurs.
 *
 * Une entrée par (groupe, module, type) et par ANCIEN titulaire : qui l'a
 * quitté, qui l'a repris, quand, et par quel compte. `derniereSemaine`, vide par
 * défaut, est la bascule FIXÉE À LA MAIN — sinon, elle se lit dans l'emploi du
 * temps (`detecterReaffectations`).
 */
const reaffectationSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /** Un groupe, jamais une fusion : c'est la grille d'un groupe qui se coupe. */
    groupe: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    type: { type: String, enum: ['P', 'S'], required: true },

    /** Matricules (ou noms, sans matricule) — la clé de `Base.affectations`. */
    ancien: { type: String, required: true, trim: true },
    /** Vide tant que la carte n'a pas encore nommé le successeur. */
    nouveau: { type: String, trim: true, default: '' },

    /** Dernière semaine de l'ancien — fixée à la main ; `null` : lue dans l'emploi. */
    derniereSemaine: { type: Number, min: 1, max: 60, default: null },

    /**
     * « Ce n'était pas une réaffectation » (2026-10-23) : un remplaçant que
     * l'emploi faisait passer pour l'ancien titulaire. Le module n'est plus coupé.
     */
    ignoree: { type: Boolean, default: false },

    auteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Qui a fixé la bascule à la main, s'il y a lieu. */
    basculePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true }
);

reaffectationSchema.index(
  { etablissementId: 1, anneeScolaire: 1, groupe: 1, module: 1, type: 1, ancien: 1 },
  { unique: true }
);

export const Reaffectation = mongoose.model('Reaffectation', reaffectationSchema);
