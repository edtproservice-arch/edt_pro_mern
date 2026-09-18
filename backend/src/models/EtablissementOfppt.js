import mongoose from 'mongoose';
import { REGIONS_OFPPT } from 'shared/constants';

/**
 * Le réseau OFPPT — la liste officielle des établissements du pays.
 * ← public/data/etablissements.json, de forme
 *   `{ région: { complexe: [établissements] } }`
 *
 * ═══ ⚠️⚠️ À NE PAS CONFONDRE AVEC `Etablissement` ═══
 * Celui-là est le LOCATAIRE du SaaS : la carte d'un directeur, avec ses espaces,
 * son calendrier, son année scolaire, ses stages. Celui-ci est un RÉFÉRENTIEL :
 * il ne contient que des noms, il n'appartient à personne, et il sert à
 * l'inscription — c'est dans cette liste qu'un directeur désigne son
 * établissement. Deux notions différentes, un seul mot en français : d'où le
 * suffixe, qui n'est pas décoratif.
 *
 * ═══ POURQUOI UN DOCUMENT PAR ÉTABLISSEMENT ═══
 * Le JSON était imbriqué (région → complexes → noms). Le CRUD, lui, porte sur
 * l'ÉTABLISSEMENT : on en ajoute un, on le renomme, on le retire. Un document
 * par établissement rend chaque geste unitaire, et l'index unique fait le reste.
 * La cascade se sert par `distinct`, comme celle de la répartition DRIF.
 */
const etablissementOfpptSchema = new mongoose.Schema(
  {
    /*
     * ⚠️ `enum` SUR LA RÉGION : elles sont figées (décision du 2026-09-02), et
     * la base doit refuser une région inventée plutôt que de la laisser entrer
     * et disparaître de la cascade — un établissement rangé sous « Fes » ne
     * serait proposé nulle part.
     */
    region: { type: String, required: true, trim: true, enum: REGIONS_OFPPT },
    complexe: { type: String, required: true, trim: true },
    nom: { type: String, required: true, trim: true },
  },
  { timestamps: true, strict: true }
);

/**
 * Un établissement, une seule fois dans son complexe.
 *
 * ⚠️ LA RÉGION FAIT PARTIE DE LA CLÉ : deux régions peuvent porter un complexe
 * de même nom — « CF Bâtiment » existe un peu partout — et deux établissements
 * homonymes dans deux villes différentes sont deux établissements.
 */
etablissementOfpptSchema.index({ region: 1, complexe: 1, nom: 1 }, { unique: true });

/** La cascade de l'inscription : région → complexe → établissement. */
etablissementOfpptSchema.index({ region: 1, complexe: 1 });

export const EtablissementOfppt = mongoose.model(
  'EtablissementOfppt',
  etablissementOfpptSchema
);
