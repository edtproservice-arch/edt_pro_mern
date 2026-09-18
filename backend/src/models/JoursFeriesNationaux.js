import mongoose from 'mongoose';

/**
 * Cache des jours fériés marocains, par année scolaire.
 * ← le cache fichier de `api/data/morocco_holidays.php:35-60`
 *
 * NATIONAL, donc partagé par tous les établissements — comme le cache fichier
 * d'origine. Ce n'est pas une donnée d'établissement : les corrections propres
 * à un établissement vivent dans `Etablissement.calendrier.ajustementsFeries`.
 *
 * Pourquoi persister plutôt que garder en mémoire : la constitution d'une année
 * demande 24 appels à api.aladhan.com. Sans persistance, chaque redémarrage du
 * serveur les refait — c'est précisément ce qui rendait `profile.html` lente,
 * le cache PHP étant bien écrit mais jamais relu.
 *
 * Le document périmé N'EST PAS supprimé : si l'API tombe, il vaut mieux servir
 * une estimation d'il y a deux mois qu'un calendrier amputé de toutes les fêtes
 * religieuses (même arbitrage qu'en PHP, ligne 180).
 */
const joursFeriesNationauxSchema = new mongoose.Schema(
  {
    anneeScolaire: { type: Number, required: true, unique: true, min: 2000, max: 2100 },

    jours: [
      {
        _id: false,
        date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        libelle: { type: String, required: true, trim: true },
        /** Intitulé officiel en arabe, quand la source le fournit. */
        libelleAr: { type: String, trim: true, default: '' },
        type: { type: String, enum: ['national', 'religieux', 'amazigh'], default: 'national' },
        /*
         * VRAI uniquement pour les fêtes du calendrier lunaire, confirmées
         * après observation de la lune. L'écran marquait « (estimé) » sur
         * toutes les dates, Nouvel An compris, ce qui privait la mention de son
         * sens et décourageait de corriger celles qui en ont besoin.
         */
        estime: { type: Boolean, default: false },
      },
    ],

    /** `false` quand l'API n'a rien renvoyé et que seuls les fériés civils sont là. */
    complet: { type: Boolean, default: true },

    /*
     * Version de la RÈGLE qui a produit ces jours.
     *
     * Sans elle, un cache reste servi 30 jours quoi qu'il arrive au code : le
     * jour où le filtre est passé de « deux années civiles » à « l'année
     * scolaire », les documents déjà écrits ont continué de rendre 34 dates au
     * lieu de 17, et les correctifs suivants — intitulés arabes, drapeau
     * d'estimation — ne les atteignaient pas davantage. Incrémenter ce nombre
     * périme tous les caches d'un coup.
     */
    version: { type: Number, default: 0 },

    recupereLe: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, strict: true }
);

export const JoursFeriesNationaux = mongoose.model(
  'JoursFeriesNationaux',
  joursFeriesNationauxSchema
);
