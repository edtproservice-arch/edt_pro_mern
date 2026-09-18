import mongoose from 'mongoose';
import { JOURS, SEANCES, TYPES_ABSENCE } from 'shared/constants';

/**
 * ← table `absences_stagiaires`. Une absence OU un retard, sur UN créneau.
 *
 * Ces enregistrements alimentent la note de discipline (F9) —
 * `noteDiscipline` du domaine, sur la grille réglementaire. Des sanctions
 * réelles en dépendent : sa fidélité n'est pas négociable.
 *
 * ═══ ⚠️ RATTACHÉE AU CEF, PAS À `stagiaireId` ═══ (2026-09-14)
 * Réimporter la base Konosys d'une année SUPPRIME puis RECRÉE ses stagiaires
 * (`stagiaires.service.js`, `deleteMany` + `insertMany`) : leurs identifiants
 * changent. Une absence liée à `stagiaireId` perdrait son stagiaire au premier
 * réimport — et sa note de discipline repartirait à 15/15 sans que rien ne le
 * dise. Le CEF, lui, est la clé que Konosys conserve d'une année à l'autre.
 *
 * ═══ ⚠️ LA DATE EST UNE CHAÎNE « AAAA-MM-JJ » ═══ comme tout le calendrier du
 * projet : un `Date` stocké à minuit UTC et relu au Maroc rend la veille — le
 * défaut déjà corrigé sur les absences de formateurs (2026-08-26).
 */
const absenceStagiaireSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    /** Le CEF — `Stagiaire.matricule`. */
    matricule: { type: String, required: true, trim: true },
    /** Dénormalisés : la note doit rester lisible si le stagiaire quitte le groupe. */
    nomComplet: { type: String, required: true, trim: true },
    /** Le groupe DU STAGIAIRE dans cette séance (un membre, jamais une fusion). */
    groupe: { type: String, required: true, trim: true },
    filiere: { type: String, trim: true, default: '' },

    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    semaine: { type: String, required: true, trim: true },
    jour: { type: String, required: true, enum: JOURS },
    seance: { type: String, required: true, enum: SEANCES },
    periode: { type: String, enum: ['jour', 'soir'], default: 'jour' },

    /** Le cours manqué, relu dans la séance : libellé (fusion comprise), module, formateur. */
    groupeSeance: { type: String, trim: true, default: '' },
    module: { type: String, trim: true, default: '' },
    /** C'est ce qui délimite ce qu'un formateur voit du registre : SES séances. */
    formateurMatricule: { type: String, trim: true, default: '' },

    typeAbsence: {
      type: String,
      required: true,
      enum: Object.values(TYPES_ABSENCE),
      default: TYPES_ABSENCE.ABSENCE,
    },
    justifiee: { type: Boolean, default: false },
    motif: { type: String, trim: true, default: '' },
    observation: { type: String, trim: true, default: '' },

    saisiePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true }
);

/** Un seul marquage par stagiaire et par créneau — absence OU retard. */
absenceStagiaireSchema.index(
  { etablissementId: 1, anneeScolaire: 1, matricule: 1, date: 1, seance: 1, periode: 1 },
  { unique: true }
);
absenceStagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, groupe: 1, date: -1 });
absenceStagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, formateurMatricule: 1, date: -1 });

export const AbsenceStagiaire = mongoose.model('AbsenceStagiaire', absenceStagiaireSchema);
