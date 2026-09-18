import mongoose from 'mongoose';
import { JOURS, SEANCES } from 'shared/constants';

/**
 * ← table `absences` : absences de formateurs et leurs rattrapages.
 *
 * Dans l'existant, une absence était marquée en écrivant `salle = 'ABSENT'`
 * dans le blob de la grille, puis `save_timetable.php` synchronisait cette
 * table par différence. Deux sources pour un même fait, tenues cohérentes à la
 * main.
 *
 * Ici, `Seance.statut = 'absent'` porte le fait, et ce document porte ce que la
 * séance ne sait pas dire : l'observation et la date de rattrapage. Le lien est
 * explicite (`seanceId`), plus reconstruit par recoupement de chaînes.
 */
const absenceFormateurSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /** Séance concernée. Null pour les absences reprises de l'existant sans correspondance. */
    seanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seance', default: null },

    semaine: { type: String, required: true, trim: true },
    jour: { type: String, required: true, enum: JOURS },
    seance: { type: String, required: true, enum: SEANCES },

    formateurMatricule: { type: String, required: true, trim: true },
    groupe: { type: String, trim: true, default: '' },
    module: { type: String, trim: true, default: '' },

    dateAbsence: { type: Date, required: true },

    observation: { type: String, trim: true, default: '' },
    dateRattrapage: { type: Date, default: null },

    /**
     * La séance posée dans la grille pour rattraper ce créneau (2026-09-14).
     *
     * ⚠️ QUAND ELLE EXISTE, C'EST ELLE QUI DONNE LA DATE : `dateRattrapage` est
     * alors celle de son créneau, écrite dans la même transaction. Une date
     * saisie à part ne peut plus la contredire — c'est ce qui ferme le double
     * comptage des heures au chronogramme.
     */
    seanceRattrapageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seance', default: null },
  },
  { timestamps: true, strict: true }
);

absenceFormateurSchema.index({ etablissementId: 1, anneeScolaire: 1, dateAbsence: -1 });
absenceFormateurSchema.index({ etablissementId: 1, formateurMatricule: 1, dateAbsence: -1 });

/** Une seule absence par créneau et par formateur — l'existant s'en remettait à une synchro. */
absenceFormateurSchema.index(
  { etablissementId: 1, semaine: 1, jour: 1, seance: 1, formateurMatricule: 1 },
  { unique: true }
);

export const AbsenceFormateur = mongoose.model('AbsenceFormateur', absenceFormateurSchema);
