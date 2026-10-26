import mongoose from 'mongoose';

/**
 * ═══ LES PV DE SANCTION D'ASSIDUITÉ IMPRIMÉS (2026-10-26, demande du porteur) ═══
 * Une ligne par stagiaire et par PALIER de la grille d'assiduité — 1ère et 2ème mise en
 * garde, 1er et 2ème avertissement, blâme (les points retirés, de 1 à 5). Elle dit que
 * le PV de ce palier est sorti : le stagiaire quitte alors la liste « PV de sanction »,
 * jusqu'au palier suivant.
 *
 * ⚠️ PAR PALIER, PAS PAR STAGIAIRE : un stagiaire dont on a imprimé la 1ère mise en
 *    garde doit revenir dans la liste à la 2ème. Réimprimer le même palier met la ligne à
 *    jour (index unique), sans la doubler.
 */
const pvSanctionSchema = new mongoose.Schema(
  {
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement', required: true },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },
    matricule: { type: String, required: true, trim: true },
    palier: { type: Number, required: true, min: 1, max: 5 },
    /** Le libellé du palier au moment de l'impression (« 2ème mise en garde »). */
    sanction: { type: String, required: true, trim: true },
    langue: { type: String, enum: ['fr', 'ar'], required: true },
    imprimeLe: { type: Date, default: Date.now },
    imprimePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true }
);

pvSanctionSchema.index({ etablissementId: 1, anneeScolaire: 1, matricule: 1, palier: 1 }, { unique: true });

export const PvSanction = mongoose.model('PvSanction', pvSanctionSchema);
