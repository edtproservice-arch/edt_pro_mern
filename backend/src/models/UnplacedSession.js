import mongoose from 'mongoose';

/**
 * ← table `unplaced_sessions` (F6).
 *
 * Séances que la génération automatique n'a pas réussi à placer : il manque
 * `manquantes` heures sur les `total` attendues pour ce couple groupe/module.
 * C'est le rapport d'échec que le directeur consulte après une génération.
 *
 * Ces lignes se périment d'elles-mêmes : `save_timetable.php` les supprimait
 * dès qu'une séance correspondante était placée à la main.
 */
const unplacedSessionSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    semaine: { type: String, required: true, trim: true },

    formateurMatricule: { type: String, trim: true, default: '' },
    groupe: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },

    manquantes: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, strict: true }
);

unplacedSessionSchema.index({ etablissementId: 1, semaine: 1 });

/** Clé de nettoyage : c'est par (semaine, groupe, module) que l'existant purge. */
unplacedSessionSchema.index(
  { etablissementId: 1, semaine: 1, groupe: 1, module: 1 },
  { unique: true }
);

export const UnplacedSession = mongoose.model('UnplacedSession', unplacedSessionSchema);
