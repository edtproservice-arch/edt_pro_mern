import mongoose from 'mongoose';

/**
 * ═══ UNE INDISCIPLINE ═══ (2026-09-14, nouveau — la vue SQL n'avait pas de
 * partie comportement.) La note de discipline compte le COMPORTEMENT sur
 * 5 points : la n-ième indiscipline porte le total retiré à n, de la mise en
 * garde à l'exclusion définitive (`sanctionComportement`).
 *
 * Le RANG n'est pas stocké : il se déduit de l'ordre chronologique. Le stocker
 * obligerait à renuméroter toutes les suivantes quand on en retire une.
 *
 * Rattachée au CEF pour la même raison que `AbsenceStagiaire` : un réimport
 * Konosys renouvelle les identifiants des stagiaires.
 */
const indisciplineStagiaireSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    matricule: { type: String, required: true, trim: true },
    nomComplet: { type: String, required: true, trim: true },
    groupe: { type: String, trim: true, default: '' },

    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    motif: { type: String, required: true, trim: true },
    observation: { type: String, trim: true, default: '' },

    saisiePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true }
);

indisciplineStagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, matricule: 1, date: 1 });

export const IndisciplineStagiaire = mongoose.model(
  'IndisciplineStagiaire',
  indisciplineStagiaireSchema
);
