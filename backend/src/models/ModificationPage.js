import mongoose from 'mongoose';
import { PAGES_COLLABORATIVES } from 'shared/domain';

/**
 * La dernière écriture de chaque page — quand, et par qui (2026-09-13, demande
 * du porteur : « la date de modification sur toutes les pages »).
 *
 * ═══ POURQUOI UNE COLLECTION, ET PAS LES `updatedAt` DES DONNÉES ═══
 * Une page ne correspond pas à un document : l'emploi du temps, ce sont des
 * milliers de séances ; « Stages » vit dans le document de l'établissement, que
 * toute autre liste fait aussi changer. Aucun `updatedAt` existant ne dit
 * « cette page a changé ». Chaque écriture ANNONCE déjà les pages qu'elle touche
 * aux collègues connectés (`annoncerModification`) : c'est ce même signal, noté
 * ici, qui date la page.
 *
 * `anneeScolaire` vaut `null` pour une page dont les données ne sont pas rangées
 * par année (salles, stages, comptes…) : sa date ne doit pas disparaître quand on
 * bascule d'année.
 */
const modificationPageSchema = new mongoose.Schema(
  {
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement', required: true },
    anneeScolaire: { type: Number, min: 2000, max: 2100, default: null },
    page: { type: String, enum: PAGES_COLLABORATIVES, required: true },
    modifieLe: { type: Date, required: true },
    auteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    auteurNom: { type: String, trim: true, default: '' },
  },
  { timestamps: false, strict: true }
);

// Une ligne par page, par établissement et par année (ou sans année).
modificationPageSchema.index({ etablissementId: 1, anneeScolaire: 1, page: 1 }, { unique: true });

export const ModificationPage = mongoose.model('ModificationPage', modificationPageSchema);
