import mongoose from 'mongoose';

/**
 * ← table `donnees_avancement` : le fichier e-note brut, tel qu'importé.
 *
 * C'est la source de vérité du module d'avancement (F7) : les heures RÉALISÉES
 * y sont lues, par comparaison avec les heures planifiées. On conserve donc les
 * lignes telles quelles, sans les interpréter.
 *
 * Taille observée : 353 Ko au maximum, 174 Ko en moyenne — sans rapport avec la
 * limite BSON de 16 Mo. Si un établissement dépassait un jour, les lignes
 * partiraient en GridFS ; ce n'est pas le cas aujourd'hui.
 *
 * ⚠️ L'année scolaire était déduite d'un filtrage sur `date_upload >= AAAA-09-01`
 * (§2 du plan). Elle est ici un champ à part entière, calculé une fois à
 * l'import — plus de règle implicite dispersée dans les requêtes.
 */
const enoteImportSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },
    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    nomFichier: { type: String, required: true, trim: true },

    /** Lignes brutes du fichier, sans en-tête — comme `donnees_json`. */
    lignes: { type: [[mongoose.Schema.Types.Mixed]], default: [] },

    /** En-tête, quand le fichier en portait un : permet de retrouver les colonnes par nom. */
    entete: { type: [String], default: [] },

    importePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    importeLe: { type: Date, default: Date.now },
  },
  { timestamps: true, strict: true }
);

/** Le plus récent d'abord : c'est ainsi que l'avancement lit ses données. */
enoteImportSchema.index({ etablissementId: 1, anneeScolaire: 1, importeLe: -1 });

export const EnoteImport = mongoose.model('EnoteImport', enoteImportSchema);
