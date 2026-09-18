import mongoose from 'mongoose';

/**
 * ← table `chronogrammes` : planning annuel prévisionnel d'un groupe.
 *
 * Forme du blob d'origine :
 *   { module → { « S1 » → « 5|P », « S2 » → « 2.5|S », … } }
 * soit, par semaine scolaire, « heures|type » où P = présentiel, S = synchrone.
 *
 * Ce format compact est conservé sous forme structurée : il alimente la
 * comparaison « planifié vs réalisé » (F7), et le décomposer en documents
 * unitaires n'apporterait rien — un chronogramme est toujours lu en entier,
 * pour un groupe donné, et pèse 1,6 Ko.
 */
const seanceChronogrammeSchema = new mongoose.Schema(
  {
    semaine: { type: String, required: true, trim: true }, // « S1 », « S24 »
    heures: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['P', 'S'], required: true },
  },
  { _id: false }
);

const chronogrammeSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },
    groupe: { type: String, required: true, trim: true },

    /** module → répartition hebdomadaire. */
    planning: { type: Map, of: [seanceChronogrammeSchema], default: {} },

    /**
     * Version optimiste (Phase 5bis, étape d3) : l'écran REMPLACE le planning du
     * groupe en entier. Deux personnes sur le même groupe, et la seconde effaçait
     * les cellules de la première. Tout écrivain du planning l'avance — import de
     * classeur et report de rattrapage compris. Voir `lib/versionOptimiste.js`.
     */
    version: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: true }
);

// ← clé unique `unique_planning` de MySQL.
chronogrammeSchema.index({ etablissementId: 1, groupe: 1, anneeScolaire: 1 }, { unique: true });

export const Chronogramme = mongoose.model('Chronogramme', chronogrammeSchema);
