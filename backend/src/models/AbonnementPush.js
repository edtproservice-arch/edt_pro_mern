import mongoose from 'mongoose';

/**
 * ═══ UN APPAREIL ABONNÉ AUX NOTIFICATIONS PUSH (2026-11-01) ═══ Ce qui permet de prévenir une
 * personne même application ou site FERMÉ — « comme Facebook » (demande du porteur) :
 *   - `web` : un navigateur (Web Push, clés VAPID) — `abonnement` est le PushSubscription ;
 *   - `fcm` : l'application Android (Firebase Cloud Messaging) — `cle` est le jeton de l'appareil.
 *
 * ⚠️ `cle` (le point d'accès web, ou le jeton FCM) est UNIQUE : un appareil sur lequel une autre
 *    personne se connecte passe à elle — l'ancienne ne doit plus y recevoir ses messages.
 */
const abonnementPushSchema = new mongoose.Schema(
  {
    utilisateurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['web', 'fcm'], required: true },
    cle: { type: String, required: true, unique: true },
    abonnement: { type: mongoose.Schema.Types.Mixed, default: null },
    appareil: { type: String, default: '' },
  },
  { timestamps: true }
);

export const AbonnementPush = mongoose.model('AbonnementPush', abonnementPushSchema);
