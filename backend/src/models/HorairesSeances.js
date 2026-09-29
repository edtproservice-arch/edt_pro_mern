import mongoose from 'mongoose';

/**
 * Les horaires des séances S1 à S4 — un seul document pour tout le réseau.
 * (demande du porteur, 2026-09-20.)
 *
 * ═══ ⚠️ IL EST NATIONAL, COMME `CalendrierNational`, ET IL N'EN FAIT PAS PARTIE ═══
 * Il ne dépend pas de l'année scolaire : les heures d'un créneau sont les mêmes chaque année,
 * et c'est l'administrateur qui bascule d'un jeu à l'autre (hiver, été, ramadan). Un document
 * unique, repéré par `cle`, plutôt qu'un jeu par année à recopier.
 *
 * ⚠️ `horaires` EST STOCKÉ TEL QUE VALIDÉ par `horairesSeancesSchema`, sans schéma Mongoose
 * détaillé : la forme est définie une fois, dans `shared`, et un document ancien ou incomplet
 * se complète à la lecture (`configurationHoraires`) au lieu d'être refusé.
 */
const horairesSeancesSchema = new mongoose.Schema(
  {
    cle: { type: String, required: true, unique: true, default: 'reseau' },
    actif: { type: String, enum: ['hiver', 'ete', 'ramadan'], default: 'hiver' },
    horaires: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, strict: true, minimize: false }
);

export const HorairesSeances = mongoose.model('HorairesSeances', horairesSeancesSchema);
