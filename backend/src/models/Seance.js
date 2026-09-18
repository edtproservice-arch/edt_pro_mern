import mongoose from 'mongoose';
import { JOURS, PERIODES, SEANCES, TYPES_COURS } from 'shared/constants';

/**
 * ★ LE CHANGEMENT STRUCTURANT DE LA MIGRATION.
 *
 * ← table `emplois_du_temps`, dont le blob `donnees_json` portait TOUTE une
 *   semaine sous la forme :
 *     { matricule → jour → séance → { groupe, module, salle, date_absence } }
 *
 * Ce blob est ici éclaté en séances unitaires. Quatre problèmes disparaissent
 * avec lui (constat §4.4 du plan) :
 *
 *  1. **Écrasement silencieux.** `save_timetable.php` réécrivait le blob entier.
 *     Deux utilisateurs sur la même semaine — directeur et gestionnaire — et
 *     l'un perdait son travail sans le savoir. Ici, deux séances différentes
 *     sont deux documents : elles ne se marchent plus dessus.
 *  2. **Aucune requête possible.** « Où est M. X mardi ? » imposait de charger
 *     toutes les grilles et de les parcourir en JavaScript. C'est désormais une
 *     requête indexée.
 *  3. **Conflits détectés côté client.** Les index ci-dessous permettent au
 *     serveur de répondre : cette salle est-elle prise, ce groupe a-t-il déjà
 *     cours à cette heure.
 *  4. **Pas d'historique fin.** `updatedBy` / `updatedAt` par séance rendent
 *     traçable qui a placé quoi.
 */
const seanceSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /** Forme canonique « 2026-W3 » — cf. `normaliserValeurSemaine()`. */
    semaine: { type: String, required: true, trim: true },
    jour: { type: String, required: true, enum: JOURS },
    seance: { type: String, required: true, enum: SEANCES },

    /** Date réelle du créneau, calculée à l'écriture : évite de la recalculer. */
    date: { type: Date, required: true },

    /**
     * Identifiant du formateur. Le MATRICULE, stable d'un import à l'autre —
     * contrairement au nom, dont l'ordre change (« NOM PRENOM » / « PRENOM NOM »).
     * `required` : une séance sans formateur serait invisible et perdue.
     */
    formateurMatricule: { type: String, required: true, trim: true },

    groupe: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    salle: { type: String, trim: true, default: '' },

    type: { type: String, enum: Object.values(TYPES_COURS), default: TYPES_COURS.PRESENTIEL },
    periode: { type: String, enum: Object.values(PERIODES), default: PERIODES.JOUR },

    /**
     * `absent` remplace la convention `salle === 'ABSENT'` de l'existant, qui
     * détournait un champ de son sens et rendait impossible de connaître la
     * salle d'une séance où le formateur était absent.
     */
    statut: {
      type: String,
      enum: ['planifie', 'absent', 'rattrape'],
      default: 'planifie',
    },

    /**
     * Surveillance d'un EFM régional.
     * ← `is_efm: true` / `type_seance: 'EFM'` du blob de `save_efm_regional.php`
     *
     * ═══ ⚠️ CE N'EST PAS UN COURS, ET C'EST TOUT L'INTÉRÊT DU CHAMP ═══
     * Le surveillant n'enseigne pas : ces heures ne doivent compter ni dans
     * l'avancement du module, ni comme des heures données. L'existant, qui
     * posait une séance ordinaire portant un drapeau dans son blob, les comptait
     * comme du cours — le module paraissait avancer pendant son propre examen.
     *
     * ⚠️ PAS UNE VALEUR DE `type` : celui-ci est DÉDUIT de la salle
     * (`typeDeSeance` — TEAMS = distanciel). Les deux notions sont
     * indépendantes : un EFM se passe en salle, et reste un EFM.
     */
    estEfm: { type: Boolean, default: false },

    /**
     * L'absence que cette séance RATTRAPE (2026-09-14) — posé seulement par
     * `POST /absences/:id/rattrapage`, jamais par la saisie ordinaire.
     *
     * ⚠️ C'EST CE LIEN, PAS LE STATUT SEUL, QUI FAIT UN RATTRAPAGE. Un statut
     * `rattrape` sans absence ne dirait pas quelles heures il compense, et la
     * date inscrite au chronogramme ne pourrait plus être reprise quand on le
     * retire.
     */
    rattrapageDe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AbsenceFormateur',
      default: null,
    },

    observation: { type: String, trim: true, default: '' },

    modifiePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true }
);

/**
 * Un formateur ne peut pas être à deux endroits au même créneau : c'est la
 * contrainte que le blob JSON garantissait par construction, et qu'il faut
 * désormais déclarer.
 */
seanceSchema.index(
  { etablissementId: 1, semaine: 1, formateurMatricule: 1, jour: 1, seance: 1, periode: 1 },
  { unique: true }
);

/** Détection de conflit de groupe, et affichage « vue groupe ». */
seanceSchema.index({ etablissementId: 1, semaine: 1, groupe: 1, jour: 1, seance: 1 });

/** Détection de conflit de salle. */
seanceSchema.index({ etablissementId: 1, semaine: 1, salle: 1, jour: 1, seance: 1 });

/** Avancement (F7) : heures réalisées par module et par groupe sur une année. */
seanceSchema.index({ etablissementId: 1, anneeScolaire: 1, module: 1, groupe: 1 });

/** Absences (F8) et consultation formateur (F14). */
seanceSchema.index({ etablissementId: 1, formateurMatricule: 1, date: 1 });

export const Seance = mongoose.model('Seance', seanceSchema);
