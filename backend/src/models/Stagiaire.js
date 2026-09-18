import mongoose from 'mongoose';

/**
 * ← table `stagiaires`.
 *
 * ⚠️ PIÈGE D'ENCODAGE À SURVEILLER PENDANT L'ETL (§6 du plan)
 * La table MySQL est déclarée en `utf8 / utf8_general_ci`, alors que ses deux
 * colonnes arabes — `Nom_Arabe`, `Prenom_arabe` — sont en `utf8mb4_unicode_ci`.
 * Les noms arabes doivent donc être vérifiés caractère par caractère après
 * reprise : un mauvais jeu de caractères les transformerait en points
 * d'interrogation, et ils figurent sur les cartes de stagiaire imprimées.
 *
 * Les noms de champs de l'existant étaient en CamelCase mêlé
 * (`MatriculeEtudiant`, `EmailStagiaire`, `niveau`) : ils sont normalisés ici.
 */
const stagiaireSchema = new mongoose.Schema(
  {
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Etablissement',
      required: true,
    },

    /** ← MatriculeEtudiant, le CEF. Sert aussi d'identifiant de connexion. */
    matricule: { type: String, required: true, trim: true },

    nom: { type: String, trim: true, default: '' },
    prenom: { type: String, trim: true, default: '' },

    /** ← Nom_Arabe / Prenom_arabe — imprimés sur les cartes de stagiaire. */
    nomArabe: { type: String, trim: true, default: '' },
    prenomArabe: { type: String, trim: true, default: '' },

    email: { type: String, trim: true, lowercase: true, default: '' },
    cin: { type: String, trim: true, default: '' },
    /** Conservée en chaîne : l'existant y stocke des formats hétérogènes. */
    dateNaissance: { type: String, trim: true, default: '' },

    /*
     * ═══ TOUS SES GROUPES, ET NON UN SEUL ═══ (décision du 2026-08-19)
     *
     * Konosys rend une ligne par INSCRIPTION : un stagiaire suivant un tronc
     * diplômant et un module FQ y figure deux fois, avec deux `CodeDiplome`.
     * MySQL gardait ces lignes séparées — 1 671 pour ~995 personnes — et chaque
     * lecture devait deviner laquelle faisait foi.
     *
     * Ici un stagiaire est UN document par année : l'index unique
     * `(établissement, année, matricule)` tient, ce qui garantit un seul compte
     * par personne, et rien
     * n'est perdu puisque la liste porte toutes ses inscriptions. L'effectif
     * d'un groupe FQ reste donc juste.
     */
    groupes: [{ type: String, trim: true }],

    /**
     * Groupe DIPLÔMANT — celui qui porte le niveau, l'année et la filière
     * ci-dessous, et qui figure sur les documents imprimés.
     *
     * Vide quand le stagiaire n'a que des inscriptions FQ : le signaler vaut
     * mieux que de promouvoir une ligne FQ en douce.
     */
    groupePrincipal: { type: String, trim: true, default: '' },

    filiere: { type: String, trim: true, default: '' },
    niveau: { type: String, trim: true, default: '' },
    annee: { type: String, trim: true, default: '' },
    site: { type: String, trim: true, default: '' },

    /*
     * ═══ UNE BASE KONOSYS PAR ANNÉE SCOLAIRE ═══ (décision du porteur,
     * 2026-09-14) — elle datait l'import, elle RANGE désormais la base. Importer
     * 2027-2028 ne touche plus aux stagiaires de 2026-2027 ; réimporter la même
     * année remplace sa base, et elle seule.
     */
    anneeScolaire: { type: Number, min: 2000, max: 2100, required: true },
  },
  { timestamps: true, strict: true }
);

/*
 * ⚠️ L'ANNÉE ENTRE DANS LA CLÉ : un même stagiaire figure dans la base de
 * chacune de ses années (1re puis 2e année). Sans elle, la base de l'année
 * suivante heurterait la précédente sur la clé unique.
 */
stagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, matricule: 1 }, { unique: true });
/** Index MULTICLÉ : Mongo indexe chaque valeur du tableau. */
stagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, groupes: 1 });
stagiaireSchema.index({ etablissementId: 1, anneeScolaire: 1, nom: 1, prenom: 1 });
/** Retrouver la base la plus récente où figure un stagiaire (sa session). */
stagiaireSchema.index({ etablissementId: 1, matricule: 1, anneeScolaire: -1 });

export const Stagiaire = mongoose.model('Stagiaire', stagiaireSchema);
