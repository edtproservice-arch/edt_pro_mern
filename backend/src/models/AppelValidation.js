import mongoose from 'mongoose';
import { JOURS, SEANCES } from 'shared/constants';

/**
 * L'appel d'UN cours, VALIDÉ par son formateur (2026-09-27, demande du
 * porteur : « en absence chez le gestionnaire je veux un signe que le
 * formateur a marqué l'absence » — et, chez le formateur, un bouton
 * « Valider l'appel » qui remplace l'enregistrement automatique).
 *
 * ═══ ⚠️ UN DOCUMENT PAR (CRÉNEAU, GROUPE), PAS PAR MARQUE ═══
 * L'appel lui-même — présent, absent, retard — reste porté par
 * `AbsenceStagiaire` (une absence ou un retard) et par l'ABSENCE de document
 * (un présent). Celui-ci ne porte qu'UN fait de plus : le formateur a-t-il
 * ATTESTÉ que cette liste, à cet instant, est la sienne ? C'est pourquoi il ne
 * réunit pas les stagiaires un par un — il n'y en a qu'UN par cours.
 *
 * ═══ ⚠️ TOUTE RÉÉCRITURE DE L'APPEL RETIRE LA VALIDATION ═══ — c'est
 * `enregistrerAppel` qui l'efface, pas ce modèle : une liste modifiée APRÈS
 * validation (par l'encadrement, ou par le formateur qui rouvre son appel)
 * n'est plus celle qui a été attestée, et le signe chez le gestionnaire doit
 * le dire — jamais laisser croire qu'un formateur a validé une liste que lui
 * seul, ou quelqu'un d'autre, a changée depuis.
 */
const appelValidationSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    jour: { type: String, required: true, enum: JOURS },
    seance: { type: String, required: true, enum: SEANCES },
    periode: { type: String, enum: ['jour', 'soir'], default: 'jour' },
    /** Le libellé de la SÉANCE — fusion comprise (« GM101 GM102 »), comme `AbsenceStagiaire.groupeSeance`. */
    groupe: { type: String, required: true, trim: true },

    validePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Dénormalisé : la carte au survol du gestionnaire n'a pas à rejoindre un compte pour nommer qui a validé. */
    validateurNom: { type: String, trim: true, default: '' },
    valideLe: { type: Date, required: true },
  },
  { timestamps: true, strict: true }
);

// Un seul document par cours : une nouvelle validation REMPLACE la précédente, elle ne s'y ajoute pas.
appelValidationSchema.index(
  { etablissementId: 1, anneeScolaire: 1, date: 1, seance: 1, periode: 1, groupe: 1 },
  { unique: true }
);

export const AppelValidation = mongoose.model('AppelValidation', appelValidationSchema);
