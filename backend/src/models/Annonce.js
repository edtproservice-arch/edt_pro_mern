import mongoose from 'mongoose';
import { ROLES } from 'shared/constants';

/**
 * Une ANNONCE — note ou information courte, affichée dans le bandeau passant
 * de ses destinataires et doublée d'un message dans leur messagerie
 * (2026-10-10, demande du porteur).
 *
 * Qui écrit à qui — fixé par le SERVEUR, jamais par la requête :
 *   - administrateur → directeurs (tous, ou ceux des établissements choisis) ;
 *   - directeur      → formateurs de son établissement ;
 *   - gestionnaire   → stagiaires de son établissement.
 *
 * ⚠️ UNE DURÉE DE VIE : `debut` → `fin`. Un bandeau qui garderait toutes les
 * annonces passées finirait par n'être plus lu. Retirée (`retireeLe`), elle
 * quitte le bandeau sans effacer le message déjà remis.
 */
export const IMPORTANCES = ['info', 'importante', 'urgente'];
export const CIBLES = [ROLES.DIRECTEUR, ROLES.FORMATEUR, ROLES.STAGIAIRE];

const annonceSchema = new mongoose.Schema(
  {
    auteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roleAuteur: { type: String, enum: [ROLES.ADMIN, ROLES.DIRECTEUR, ROLES.GESTIONNAIRE], required: true },
    cible: { type: String, enum: CIBLES, required: true },
    /*
     * Les établissements visés. ⚠️ VIDE = TOUS — seulement pour l'administrateur,
     * qui écrit au réseau entier. Directeur et gestionnaire y mettent toujours
     * le leur, et le leur seul.
     */
    etablissementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement' }],
    /*
     * Le RESSERREMENT de la cible (2026-10-10, demande du porteur : « le select
     * des formateurs, et en gestionnaire la sélection des groupes — par défaut
     * tous »). ⚠️ VIDE = TOUS, comme `etablissementIds`.
     *   - `matricules` : les formateurs visés par le directeur ;
     *   - `groupes`    : les groupes visés par le gestionnaire (leurs stagiaires).
     */
    matricules: [{ type: String, trim: true }],
    groupes: [{ type: String, trim: true }],
    texte: { type: String, trim: true, required: true, maxlength: 500 },
    importance: { type: String, enum: IMPORTANCES, default: 'info' },
    /*
     * La PAGE LIÉE (2026-10-10, demande du porteur : « cliquer l'annonce À la une
     * mène à la page concernée »). Un chemin INTERNE (`/app/…`), jamais une
     * adresse externe : un bandeau officiel ne doit pas pouvoir mener ailleurs.
     */
    lien: { type: String, trim: true, default: '' },
    lienTitre: { type: String, trim: true, default: '' },
    // « AAAA-MM-JJ », bornes comprises — comme les stages.
    debut: { type: String, required: true },
    fin: { type: String, required: true },
    retireeLe: { type: Date, default: null },
    destinataires: { type: Number, default: 0 },
    /*
     * ═══ UNE ANNONCE PROGRAMMÉE (2026-10-10, demande du porteur) ═══ Son
     * `debut` est à venir : elle n'entre dans le bandeau QUE ce jour-là, et sa
     * copie en messagerie part ce jour-là aussi — pas à la publication, où elle
     * arriverait une semaine trop tôt.
     *   - `destinatairesIds` : figés à la publication (ceux qu'on a visés) ;
     *   - `remiseLe` : null tant que la copie n'est pas partie.
     */
    destinatairesIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    remiseLe: { type: Date, default: null },
  },
  { timestamps: true }
);

annonceSchema.index({ cible: 1, fin: 1 });
annonceSchema.index({ auteurId: 1, createdAt: -1 });

export const Annonce = mongoose.model('Annonce', annonceSchema);
