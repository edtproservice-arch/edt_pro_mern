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
    /** Salles attribuées à ce formateur. Vide = aucune restriction. */
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
  },
  { timestamps: true, strict: true }
);

// ← `unique_etablissement` de MySQL, étendu à l'année : les contraintes
// changent d'une année à l'autre, l'existant les écrasait.
autoGenConfigSchema.index({ etablissementId: 1, anneeScolaire: 1 }, { unique: true });

export const AutoGenConfig = mongoose.model('AutoGenConfig', autoGenConfigSchema);
