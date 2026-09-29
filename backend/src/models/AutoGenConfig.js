import mongoose from 'mongoose';
import { JOURS, SEANCES } from 'shared/constants';

/**
 * ← table `configurations_auto_gen` (F6).
 *
 * Contraintes saisies par le directeur avant de lancer la génération
 * automatique. Forme du blob d'origine :
 *   { matricule → { hours, teamsSessions, spaces[], unavailable[{jour, seance}] } }
 *
 * ⚠️ Ces contraintes sont TOUT ce que l'existant persiste du générateur : le
 * moteur lui-même vit dans le DOM de emploi.html (§4.3 du plan). Les extraire
 * ici est le préalable à un générateur exécutable côté serveur.
 */
const creneauSchema = new mongoose.Schema(
  {
    jour: { type: String, required: true, enum: JOURS },
    seance: { type: String, required: true, enum: SEANCES },
  },
  { _id: false }
);

const contrainteFormateurSchema = new mongoose.Schema(
  {
    /** Identifiant du formateur : son matricule, ou son nom s'il n'en a pas. */
    formateur: { type: String, required: true, trim: true },
    /** Volume hebdomadaire visé pour ce formateur. */
    heures: { type: Number, default: 0, min: 0 },
    /** Nombre de séances à distance imposées. */
    seancesTeams: { type: Number, default: 0, min: 0 },
    /** Salles attribuées à ce formateur. Vide = aucune salle attribuée (rien n'est pré-rempli). */
    espaces: [{ type: String, trim: true }],
    /** Créneaux à éviter (S1-S4). En saisie manuelle ils ne ferment rien. */
    indisponibilites: [creneauSchema],
  },
  { _id: false }
);

const autoGenConfigSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /*
     * Une entrée par formateur.
     *
     * ⚠️ UN TABLEAU, PLUS UNE `Map` (2026-09-17) : la clé est le matricule, ou
     * le NOM d'un formateur sans matricule — et Mongoose refuse une clé de Map
     * contenant un point. Rien n'avait encore été écrit dans ce champ, le
     * changement de forme ne demande aucune migration.
     */
    contraintes: { type: [contrainteFormateurSchema], default: [] },

    /**
     * Graine du générateur aléatoire. Absente de l'existant, où `shuffleArray()`
     * n'était pas reproductible : deux exécutions sur les mêmes données
     * donnaient des grilles différentes, impossibles à comparer. La consigner
     * rend la génération rejouable (§7, Phase 6).
     */
    graine: { type: Number, default: null },

    /**
     * ═══ L'EMPLOI DU TEMPS EST-IL LIÉ AU CHRONOGRAMME ? ═══ (2026-09-27)
     * ← table `liaison_chronogramme` + `set_liaison_chronogramme.php`
     *
     * **Lié** (défaut) : le chronogramme fixe les volumes ; la saisie manuelle
     * qui les modifierait est refusée, et la génération automatique produit la
     * grille à partir de lui.
     * **Dissocié** : l'emploi du temps est tenu à la main, librement.
     *
     * ⚠️ **L'ABSENCE DE DOCUMENT VAUT « LIÉ »**, comme l'absence de ligne dans
     *    l'ancien : aucun établissement ne change de comportement au
     *    déploiement, et un `AutoGenConfig` jamais créé ne déverrouille rien
     *    par surprise. C'est ce que `default: true` garantit ICI, mais tout
     *    lecteur doit AUSSI retomber sur `true` quand le document est absent —
     *    Mongoose n'applique pas un défaut à un document qui n'existe pas.
     *
     * ⚠️ **POURQUOI ICI ET PAS SUR `Base`** : `carte.service.js` fait
     *    `findOneAndDelete` puis `create` — la carte est REMPLACÉE EN BLOC à
     *    chaque enregistrement. Un drapeau posé là serait effacé au premier
     *    enregistrement de carte, sans que rien ne le signale.
     */
    chronogrammeLie: { type: Boolean, default: true },

    /**
     * Sel de pseudonymisation des traces de génération (F6 · d).
     *
     * ═══ ⚠️ IL NE DOIT JAMAIS QUITTER LA PRODUCTION ═══ C'est lui, et lui seul,
     * qui permettrait de remonter d'un pseudonyme à un matricule. Rangé ici
     * plutôt que dans la trace : le mettre à côté des données qu'il protège
     * reviendrait à ne rien protéger. Tiré une fois, puis jamais changé — le
     * faire tourner casserait la stabilité des pseudonymes d'une semaine à
     * l'autre, qui est précisément ce qu'un modèle de préférence doit voir.
     *
     * ⚠️ `select: false` : il ne part dans AUCUNE lecture qui ne le demande
     *    explicitement, y compris celles du service de génération.
     */
    selTraces: { type: String, default: null, select: false },
  },
  { timestamps: true, strict: true }
);

// ← `unique_etablissement` de MySQL, étendu à l'année : les contraintes
// changent d'une année à l'autre, l'existant les écrasait.
autoGenConfigSchema.index({ etablissementId: 1, anneeScolaire: 1 }, { unique: true });

export const AutoGenConfig = mongoose.model('AutoGenConfig', autoGenConfigSchema);
