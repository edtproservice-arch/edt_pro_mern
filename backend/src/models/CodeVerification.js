import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * ← tables `verification_codes` + `device_approvals` + `password_resets`.
 *
 * Les trois faisaient la même chose — un code à durée de vie limitée — avec
 * trois schémas et trois chemins de code distincts. Un seul modèle ici,
 * discriminé par `type`.
 *
 * Le code est stocké HACHÉ. En PHP, `verification_codes.code` et
 * `device_approvals.code` étaient en clair : quiconque lisait la table pouvait
 * valider n'importe quel appareil. (`password_resets` hachait déjà son jeton —
 * les trois n'étaient donc même pas cohérentes entre elles.)
 */
export const TYPES_CODE = {
  EMAIL: 'email',
  APPAREIL: 'appareil',
  MOT_DE_PASSE: 'motDePasse',
};

const codeVerificationSchema = new mongoose.Schema(
  {
    utilisateurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: { type: String, required: true, enum: Object.values(TYPES_CODE) },

    empreinte: { type: String, required: true },

    /** Contexte de l'appareil à autoriser (type `appareil` uniquement). */
    appareil: {
      nom: { type: String, trim: true, default: null },
      navigateur: { type: String, trim: true, default: null },
      os: { type: String, trim: true, default: null },
      type: { type: String, trim: true, default: 'desktop' },
    },

    ip: { type: String, trim: true, default: null },

    /** Limite les essais : au-delà, le code est invalidé plutôt que devinable. */
    tentatives: { type: Number, default: 0, max: 10 },

    expireLe: { type: Date, required: true },
  },
  { timestamps: true, strict: true }
);

codeVerificationSchema.index({ expireLe: 1 }, { expireAfterSeconds: 0 });
codeVerificationSchema.index({ utilisateurId: 1, type: 1 });

/** Code numérique à 6 chiffres, comme l'existant (login.php:217). */
export function genererCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function empreinteCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export const CodeVerification = mongoose.model('CodeVerification', codeVerificationSchema);
