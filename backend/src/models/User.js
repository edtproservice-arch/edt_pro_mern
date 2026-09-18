import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

/**
 * ← table `utilisateurs` (MySQL).
 *
 * Changement structurant : `etablissementIds` est un TABLEAU, là où MySQL ne
 * portait qu'une seule clé `etablissement_id`. Un directeur supervisant
 * plusieurs établissements était jusqu'ici reconstitué par une requête sur
 * `etablissements.utilisateur_id`, et un formateur par une jointure sur son
 * e-mail dans `formateurs_details` (login.php:361) — deux mécaniques
 * différentes pour la même notion.
 *
 * `strict: true` + `required` + `enum` : garde-fou n°3 du §5bis.
 */
const userSchema = new mongoose.Schema(
  {
    nomComplet: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    /** ← colonne `login` : matricule formateur, CEF stagiaire, identifiant gestionnaire. */
    identifiant: { type: String, trim: true, default: null, index: true },

    telephone: { type: String, trim: true, default: null },

    /**
     * Hash bcrypt. `select: false` : jamais renvoyé par une requête ordinaire,
     * il faut le demander explicitement (`.select('+motDePasse')`).
     * Compatible avec les hash `$2y$` produits par `password_hash()` en PHP —
     * vérifié sur échantillon, les comptes existants se connectent sans reset.
     */
    motDePasse: { type: String, required: true, select: false },

    role: {
      type: String,
      required: true,
      enum: Object.values(ROLES),
      default: ROLES.DIRECTEUR,
      index: true,
    },

    statut: {
      type: String,
      required: true,
      enum: Object.values(STATUTS_COMPTE),
      default: STATUTS_COMPTE.EN_ATTENTE,
    },

    etablissementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement' }],

    estVerifie: { type: Boolean, default: false },
    estActif: { type: Boolean, default: true },
    configurationTerminee: { type: Boolean, default: false },

    methodeVerification: { type: String, enum: ['email', 'sms'], default: 'email' },

    essai: {
      demande: { type: Boolean, default: false },
      dateFin: { type: Date, default: null },
    },

    dateApprobation: { type: Date, default: null },
    dateRejet: { type: Date, default: null },
    dateBlocage: { type: Date, default: null },
    derniereConnexion: { type: Date, default: null },
    derniereActivite: { type: Date, default: null },
    tempsPasse: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true }
);

/** Hache le mot de passe à chaque modification — jamais stocké en clair. */
userSchema.pre('save', async function hacherMotDePasse(next) {
  if (!this.isModified('motDePasse')) return next();
  this.motDePasse = await bcrypt.hash(this.motDePasse, 12);
  return next();
});

userSchema.methods.verifierMotDePasse = function verifierMotDePasse(motDePasseClair) {
  return bcrypt.compare(motDePasseClair, this.motDePasse);
};

/** L'essai est-il arrivé à terme ? ← login.php:89-97 (auto-blocage). */
userSchema.methods.essaiExpire = function essaiExpire() {
  return Boolean(this.essai?.dateFin) && this.essai.dateFin < new Date();
};

export const User = mongoose.model('User', userSchema);
