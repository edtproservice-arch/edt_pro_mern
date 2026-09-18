import mongoose from 'mongoose';

/**
 * Calendrier national de l'année scolaire : vacances et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ IL EST NATIONAL, COMME `JoursFeriesNationaux` ═══
 * Ce n'est pas une donnée d'établissement : les vacances du réseau et les dates
 * de rentrée sont décidées une fois pour tous. Les corrections propres à un
 * établissement vivent dans `Etablissement.calendrier` — ses vacances à lui, et
 * la liste des périodes nationales qu'il ÉCARTE.
 *
 * ⚠️ À NE PAS CONFONDRE AVEC `Etablissement.calendrier.vacances` : celui-là
 * porte ce que le directeur saisit chez lui, celui-ci ce qui lui est proposé par
 * défaut. `fusionnerVacances()` combine les deux à la lecture.
 */
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

const periodeSchema = new mongoose.Schema(
  {
    /*
     * ⚠️ LE NOM EST LA CLÉ D'APPARIEMENT : c'est par lui qu'un établissement
     * écarte une période, et c'est la seule qui survive à un décalage de dates.
     * Deux périodes de même nom rendraient l'écartement ambigu — le service les
     * refuse.
     */
    nom: { type: String, required: true, trim: true },
    debut: { type: String, required: true, match: JOUR },
    fin: { type: String, required: true, match: JOUR },
  },
  { _id: false }
);

const rentreeSchema = new mongoose.Schema(
  {
    /*
     * L'année de FORMATION — 1ʳᵉ, 2ᵉ, 3ᵉ — à ne pas confondre avec l'année
     * SCOLAIRE, qui est celle du document.
     */
    /*
     * ⚠️ 1 à 3, comme la répartition DRIF (correction du porteur, 2026-09-03).
     * L'année d'un groupe se lit dans son numéro — « DEVOWFS201 » → 2 — et
     * aucun nom n'en porte de 4 : une rentrée au-delà ne gèlerait jamais rien.
     */
    anneeFormation: { type: Number, required: true, min: 1, max: 3 },
    date: { type: String, required: true, match: JOUR },
  },
  { _id: false }
);

const calendrierNationalSchema = new mongoose.Schema(
  {
    /** L'année de septembre : 2026 pour « 2026-2027 ». */
    anneeScolaire: { type: Number, required: true, unique: true, min: 2000, max: 2100 },
    vacances: [periodeSchema],
    rentrees: [rentreeSchema],
  },
  { timestamps: true, strict: true }
);

export const CalendrierNational = mongoose.model(
  'CalendrierNational',
  calendrierNationalSchema
);
