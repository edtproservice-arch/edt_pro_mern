import mongoose from 'mongoose';

/**
 * ← tables `etablissements` + `espaces` + `calendrier` + `stages` + `formations`
 *   + `fq_group_mappings`, regroupées en sous-documents (plan §6).
 *
 * Justification du regroupement : ces cinq tables sont toujours lues ensemble
 * (get_profile_data.php les charge toutes), leurs volumes sont faibles
 * (389 espaces et 71 stages pour 10 établissements), et aucune n'est
 * interrogeable seule de façon utile.
 *
 * `anneeScolaire` est un NOMBRE — l'année de septembre. Elle remplace les trois
 * représentations qui coexistaient : `etablissements.annee_scolaire` en VARCHAR
 * « 2025-2026 », `donnees_de_base.annee_scolaire` en INT, et un filtrage sur
 * `date_upload >= AAAA-09-01` pour `donnees_avancement` (plan §2).
 */
/**
 * Les dates de calendrier sont des CHAÎNES « AAAA-MM-JJ », pas des `Date`.
 *
 * Même raison que dans `shared/src/domain/planning/calendrier.js` : un `Date`
 * est stocké à minuit UTC, et relu au Maroc (UTC+1) il rend la veille. Un jour
 * férié qui glisse d'un jour rend disponible une journée qui ne l'est pas.
 * L'existant stockait déjà des chaînes, pour ce motif écrit noir sur blanc dans
 * emploi.html.
 */
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jour = { type: String, required: true, match: JOUR };

const periodeSchema = new mongoose.Schema(
  {
    libelle: { type: String, trim: true },
    debut: jour,
    fin: jour,
  },
  { _id: false }
);

/**
 * Correction apportée par l'établissement à une fête religieuse.
 *
 * Ce sont des ESTIMATIONS lunaires, confirmées tardivement par les autorités.
 * On ne stocke donc PAS la liste des jours fériés — elle serait figée sur une
 * estimation — mais seulement l'écart voulu par l'établissement, qui survit au
 * prochain rafraîchissement de l'API (cf. `fusionnerJoursFeries`).
 *
 * `date` absente + `supprime` faux n'a pas de sens : c'est refusé à la saisie.
 */
const ajustementFerieSchema = new mongoose.Schema(
  {
    libelle: { type: String, required: true, trim: true },
    date: { type: String, match: JOUR, default: null },
    supprime: { type: Boolean, default: false },
  },
  { _id: false }
);

const etablissementSchema = new mongoose.Schema(
  {
    proprietaireId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    region: { type: String, required: true, trim: true },
    complexe: { type: String, required: true, trim: true },
    nom: { type: String, required: true, trim: true },
    nomAbrege: { type: String, trim: true, default: null },

    anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },

    espaces: [{ type: String, trim: true }],

    calendrier: {
      ajustementsFeries: [ajustementFerieSchema],
      vacances: [periodeSchema],
      /*
       * ═══ ⚠️ LES PÉRIODES NATIONALES QUE CET ÉTABLISSEMENT ÉCARTE ═══
       * (2026-09-02.) Les vacances du réseau s'appliquent par DÉFAUT ; celui qui
       * n'est pas concerné par l'une d'elles la met de côté par son NOM — la
       * seule clé qui survive à un décalage de dates, exactement comme pour les
       * jours fériés. Sans cela, « par défaut » vaudrait « imposé ».
       */
      vacancesEcartees: [{ type: String, trim: true }],
    },

    /** Périodes de stage par groupe. ← table `stages` */
    stages: [
      {
        _id: false,
        groupe: { type: String, required: true, trim: true },
        debut: jour,
        fin: jour,
      },
    ],

    /** Formations suivies par un formateur (il est alors indisponible). ← table `formations` */
    formations: [
      {
        _id: false,
        matriculeFormateur: { type: String, required: true, trim: true },
        nomFormateur: { type: String, trim: true },
        debut: jour,
        fin: jour,
      },
    ],

    /** ← table `fq_group_mappings` : un groupe FQ regroupe plusieurs groupes réels. */
    groupesFq: [
      {
        _id: false,
        groupeFq: { type: String, required: true, trim: true },
        groupeConstituant: { type: String, required: true, trim: true },
      },
    ],

    /**
     * Version optimiste de chaque liste remplacée en bloc (Phase 5bis, étape d3).
     *
     * ⚠️ UN COMPTEUR PAR LISTE, PAS UN POUR TOUT L'ÉTABLISSEMENT : un collègue qui
     * enregistre ses stages ne doit pas faire refuser les espaces qu'on saisit à
     * côté — ce ne sont pas les mêmes données, rien ne se perdrait.
     * Voir `lib/versionOptimiste.js`.
     */
    versions: {
      espaces: { type: Number, default: 0, min: 0 },
      stages: { type: Number, default: 0, min: 0 },
      formations: { type: Number, default: 0, min: 0 },
      groupesFq: { type: Number, default: 0, min: 0 },
      calendrier: { type: Number, default: 0, min: 0 },
    },

    /**
     * La semaine d'emploi du temps qui FAIT FOI, une par année scolaire.
     * ← `etablissements.semaine_publiee` + `date_publication`
     *
     * ═══ ⚠️ UNE ENTRÉE PAR ANNÉE, LÀ OÙ L'EXISTANT N'AVAIT QU'UN CHAMP ═══
     * MySQL portait une seule colonne pour tout l'établissement : basculer
     * d'année écrasait la publication de l'autre, sans que rien ne le dise.
     *
     * ═══ ⚠️⚠️ ET `emplois_du_temps.est_publie` N'A PAS D'ÉQUIVALENT ICI ═══
     * L'existant portait le fait DEUX FOIS — un drapeau par ligne hebdomadaire
     * ET la colonne ci-dessus — qu'une transaction devait tenir en phase. Le
     * doublon disparaît par construction : les séances sont unitaires, il n'y a
     * plus de ligne de semaine à marquer. Une seule vérité, celle-ci.
     */
    publications: [
      {
        _id: false,
        anneeScolaire: { type: Number, required: true, min: 2000, max: 2100 },
        /** « 2026-W12 », NORMALISÉE à l'écriture — l'existant a payé deux
            correctifs pour avoir laissé cohabiter « 2026-W39 » et « 2026-W039 ». */
        semaine: { type: String, required: true, trim: true },
        publieeLe: { type: Date, required: true },
        publieePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true, strict: true }
);

etablissementSchema.index({ proprietaireId: 1, anneeScolaire: 1 });

export const Etablissement = mongoose.model('Etablissement', etablissementSchema);
