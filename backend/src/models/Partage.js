import mongoose from 'mongoose';
import { DROITS_ACCORDABLES, PORTEES_GENERALES } from 'shared/domain';
import { PAGES_COLLABORATIVES } from 'shared/domain';

/**
 * Qui a accès à une page collaborative, et avec quel droit — la boîte
 * « Partager » de Notion (Phase 5bis, étape c).
 *
 * Nouveau : rien d'équivalent dans le PHP.
 *
 * ⚠️ UN DOCUMENT PAR PAGE ET PAR ANNÉE (décision du 2026-09-12 : « la page, sur
 * l'année scolaire active, révocable »). L'année fait partie de la clé, comme
 * pour la salle temps réel : inviter quelqu'un sur 2026-2027 ne lui ouvre pas
 * 2027-2028, que le directeur prépare peut-être déjà.
 *
 * ⚠️ LE DIRECTEUR N'Y FIGURE PAS : il est propriétaire par son RÔLE
 * (`droitSurPage`). L'écrire ici ferait deux sources pour un même fait, et un
 * document effacé lui retirerait l'accès à sa propre page.
 *
 * ⚠️ RETIRER UN MEMBRE, C'EST LE SUPPRIMER du tableau. La trace de qui a invité
 * ou retiré qui vit dans `auditLogs`, pas ici : un membre « révoqué » gardé dans
 * la liste serait une ligne de plus que chaque contrôle de droit devrait penser
 * à écarter.
 */
const membreSchema = new mongoose.Schema(
  {
    utilisateurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    droit: { type: String, enum: DROITS_ACCORDABLES, required: true },
    invitePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    inviteLe: { type: Date, default: Date.now },
    /*
     * ═══ ⚠️ UNE INVITATION DOIT ÊTRE ACCEPTÉE (2026-09-12, demande du porteur) ═══
     * Tant qu'elle est `en_attente`, elle ne donne AUCUN accès : ni la page, ni
     * la salle, ni l'entrée du menu.
     *
     * ⚠️ LE DÉFAUT EST `accepte`, ET C'EST VOULU : les invitations écrites AVANT
     * cette règle n'ont pas de statut et fonctionnaient déjà. Un défaut
     * `en_attente` les aurait coupées en silence à la première relecture — et
     * Mongoose réécrit tout le tableau quand on en retire un membre, ce qui les
     * aurait figées en attente. Toute NOUVELLE invitation pose `en_attente`
     * explicitement.
     */
    statut: { type: String, enum: ['en_attente', 'accepte'], default: 'accepte' },
    accepteLe: { type: Date, default: null },
  },
  { _id: false, strict: true }
);

const partageSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },
    page: { type: String, enum: PAGES_COLLABORATIVES, required: true },

    general: {
      portee: {
        type: String,
        enum: Object.values(PORTEES_GENERALES),
        default: PORTEES_GENERALES.RESTREINT,
      },
      droit: { type: String, enum: DROITS_ACCORDABLES, default: 'consulter' },
    },

    membres: { type: [membreSchema], default: [] },
  },
  { timestamps: true, strict: true }
);

partageSchema.index({ etablissementId: 1, anneeScolaire: 1, page: 1 }, { unique: true });
// « Quelles pages me sont partagées ? » — la question que pose le menu à chaque
// ouverture de session.
partageSchema.index({ 'membres.utilisateurId': 1 });

export const Partage = mongoose.model('Partage', partageSchema);
