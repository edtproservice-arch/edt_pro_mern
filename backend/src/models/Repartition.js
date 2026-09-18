import mongoose from 'mongoose';

/**
 * Répartition DRIF — catalogue national des filières et de leurs modules.
 * ← table `repartitions` (13 359 lignes), api/data/get_repartitions.php
 *
 * ═══ POURQUOI CETTE COLLECTION EST REPRISE ═══
 * La décision du 2026-08-15 (« démarrage sur une base VIDE ») porte sur les
 * données des établissements et sur les comptes. Celle-ci n'est ni l'un ni
 * l'autre : c'est un référentiel NATIONAL, identique pour tous, publié par la
 * DRIF. La ressaisir serait 13 359 lignes à retaper, et sans elle la carte
 * d'établissement ne peut pas être construite.
 *
 * Elle vivait avant dans deux fichiers JSON de 13 Mo et 3 Mo déposés par FTP,
 * dont le transfert échouait et que le miroir de déploiement écrasait ; d'où
 * son passage en base côté PHP, conservé ici.
 */
const repartitionSchema = new mongoose.Schema(
  {
    // Cascade de sélection : secteur → niveau → créneau → année → filière
    secteur: { type: String, required: true, trim: true, default: '' },
    niveauFormation: { type: String, trim: true, default: '' },
    typeFormation: { type: String, trim: true, default: '' },
    creneau: { type: String, trim: true, default: '' },
    codeFiliereDrif: { type: String, trim: true, default: '' },
    intituleFiliere: { type: String, trim: true, default: '' },
    codeFiliereCarte: { type: String, trim: true, default: '' },
    filiere: { type: String, trim: true, default: '' },
    anneeFormation: { type: Number, default: 1, min: 1, max: 5 },

    // Module et masses horaires officielles
    codeModule: { type: String, trim: true, default: '' },
    module: { type: String, trim: true, default: '' },
    mhpS1: { type: Number, default: 0 },
    mhsynS1: { type: Number, default: 0 },
    mhasynS1: { type: Number, default: 0 },
    mhpS2: { type: Number, default: 0 },
    mhsynS2: { type: Number, default: 0 },
    mhasynS2: { type: Number, default: 0 },
    mhpTotale: { type: Number, default: 0 },
    mhdTotale: { type: Number, default: 0 },

    /** « O » quand l'EFM du module est régional. */
    efmRegional: { type: Boolean, default: false },
    metier: { type: String, trim: true, default: '' },
  },
  { timestamps: true, strict: true }
);

/**
 * Une filière, une année, un module : une seule ligne.
 *
 * L'existant s'appuyait sur `INSERT IGNORE` et une clé composite pour ne pas
 * dupliquer à chaque réimport ; l'index unique dit la même chose, mais la base
 * la fait respecter au lieu de la supposer.
 *
 * ═══ ⚠️⚠️ L'INTITULÉ EN A ÉTÉ RETIRÉ (2026-09-02, décision du porteur) ═══
 * L'index portait `module` — le LIBELLÉ — alors que la clé de l'existant
 * (`rep_cle_ligne()`) ne connaît que (filière, année, code module). Les deux
 * divergeaient, et l'écart n'apparaissait qu'à l'import : un classeur où un
 * libellé avait été corrigé — « Anglais » devenu « Anglais technique » —
 * n'écrasait pas la ligne mais en INSÉRAIT UNE SECONDE, et le module se
 * retrouvait deux fois dans la cascade de la carte d'établissement.
 *
 * Vérifié avant migration sur la base réelle : **0 doublon** sur les 13 359
 * lignes — le risque était latent, la reprise ne perd donc rien.
 *
 * ⚠️ `syncIndexes()` (npm run init:db) SUPPRIME l'ancien index : la base suit
 * le code. Sans cette exécution, l'ancien index survit et continue d'accepter
 * les doublons.
 */
repartitionSchema.index(
  { codeFiliereDrif: 1, anneeFormation: 1, codeModule: 1 },
  { unique: true }
);

/** Cascade de l'écran : on descend secteur → niveau → créneau → année. */
repartitionSchema.index({ secteur: 1, niveauFormation: 1, creneau: 1, anneeFormation: 1 });

export const Repartition = mongoose.model('Repartition', repartitionSchema);
