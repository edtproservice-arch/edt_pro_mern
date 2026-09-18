import mongoose from 'mongoose';
import { bus, EVENEMENTS } from '../lib/bus.js';

/**
 * ← table `sessions` (suivi des appareils connectés).
 *
 * Une ligne = un appareil connecté. C'est ce qui alimente l'onglet « Appareils »
 * du profil et permet la révocation à distance, comportement conservé de
 * l'existant (api/profile/revoke_session.php).
 *
 * Différence de fond avec PHP : la table stockait l'identifiant de session PHP
 * EN CLAIR, et cet identifiant servait aussi de jeton d'authentification
 * (renvoyé au client, accepté via l'en-tête `X-Session-Id`). Une lecture de la
 * table suffisait donc à usurper n'importe quelle session. Ici on ne stocke
 * qu'une EMPREINTE SHA-256 du refresh token : la base volée ne permet pas de
 * se connecter.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    utilisateurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** SHA-256 du jeton. Le jeton lui-même n'est jamais persisté. */
    empreinte: { type: String, required: true, unique: true, index: true },

    appareil: {
      nom: { type: String, trim: true, default: null },
      navigateur: { type: String, trim: true, default: null },
      os: { type: String, trim: true, default: null },
      type: { type: String, trim: true, default: 'desktop' },
    },

    ip: { type: String, trim: true, default: null },

    /**
     * Administrateur agissant a la place de l'utilisateur, le cas echeant.
     * Une session usurpee reste identifiable meme apres rafraichissement.
     */
    impersonateurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /**
     * L'établissement avec lequel un ADMINISTRATEUR collabore, en son nom propre
     * (2026-09-14). Conservé au travers des rafraîchissements, comme
     * l'usurpation : sans lui, la collaboration s'arrêterait au bout de 15 min.
     */
    collaborationEtablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      default: null,
    },

    derniereActivite: { type: Date, default: Date.now },
    revoqueLe: { type: Date, default: null },
    expireLe: { type: Date, required: true },
  },
  { timestamps: true, strict: true }
);

/** Purge automatique des jetons expirés — évite la croissance sans fin de la collection. */
refreshTokenSchema.index({ expireLe: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.methods.estValide = function estValide() {
  return !this.revoqueLe && this.expireLe > new Date();
};

/**
 * Les identifiants d'utilisateur que désigne un filtre de suppression.
 * Il en existe trois formes dans le code : un identifiant seul, `{ $in: [...] }`
 * pour une suppression en lot, et rien du tout (purge générale, sans cible).
 */
function utilisateursDuFiltre(filtre) {
  const cible = filtre?.utilisateurId;
  if (!cible) return [];
  if (Array.isArray(cible?.$in)) return cible.$in.map(String);
  return [String(cible)];
}

/*
 * ═══ ⚠️ TOUTE RÉVOCATION FERME AUSSI LES SOCKETS TEMPS RÉEL ═══
 * (2026-09-12.) Une socket ouverte ne repasse pas par `authenticate` à chaque
 * message : bloquer, désactiver ou supprimer un compte la laisserait vivre
 * jusqu'à l'expiration de son jeton. Neuf endroits du code révoquent des
 * sessions — blocage par l'admin, désactivation et suppression par le
 * directeur, réinitialisation de mot de passe… Les accrocher un par un, c'est
 * la garantie d'en oublier un au prochain ajout. Le crochet est donc posé ICI,
 * sur la seule opération qu'ils ont tous en commun.
 *
 * La socket fermée tente de se reconnecter, et repasse alors par
 * `chargerSession` : un compte bloqué ou supprimé y est refusé, un utilisateur
 * dont on n'a fermé que les AUTRES appareils y revient aussitôt.
 */
refreshTokenSchema.post('deleteMany', function annoncerRevocation() {
  const utilisateurIds = utilisateursDuFiltre(this.getFilter());
  if (utilisateurIds.length === 0) return;
  // ⚠️ Jamais d'exception vers la révocation elle-même : les jetons SONT
  // supprimés, et c'est ce qui compte. Une socket non fermée expirera d'elle-même.
  try {
    bus.emit(EVENEMENTS.SESSIONS_REVOQUEES, { utilisateurIds });
  } catch {
    // Rien à faire : voir ci-dessus.
  }
});

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
