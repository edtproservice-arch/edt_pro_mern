import mongoose from 'mongoose';
import { JOURS, SEANCES } from 'shared/constants';
import { PAGES_COLLABORATIVES } from 'shared/domain';

/**
 * ← table `messages` (F10).
 *
 * Un message peut porter une PROPOSITION de modification d'emploi du temps :
 * un formateur demande un déplacement, le directeur l'applique. Dans
 * l'existant, la proposition était encodée dans le corps du message et relue
 * par analyse de texte (`apply_proposition.php`, 515 lignes) — d'où un
 * sous-document explicite ici.
 *
 * ⚠️ L'application d'une proposition écrit dans `seances` : elle doit être
 * TRANSACTIONNELLE (replica set requis, cf. §5 du plan). Une proposition à
 * moitié appliquée laisserait la grille incohérente.
 */
/**
 * Une INVITATION à collaborer sur une ou plusieurs pages (Phase 5bis).
 *
 * ⚠️ UN SOUS-DOCUMENT, PAS UN CORPS À ANALYSER — la leçon de la proposition
 * ci-dessous : l'existant relisait le texte du message pour retrouver ce qu'il
 * proposait. Ici l'écran lit ce sous-document pour afficher « Accepter » et
 * « Refuser », et le serveur pour savoir ce qu'on accepte.
 *
 * ⚠️ `pages` EST UNE LISTE : une seule invitation peut ouvrir plusieurs pages —
 * c'est la sélection de pages que le directeur fera à l'étape (d).
 *
 * ⚠️ AUCUNE ROUTE PUBLIQUE NE L'ÉCRIT : le schéma d'envoi de la messagerie ne le
 * connaît pas, et Zod retire les clés non déclarées. Seul le service des
 * partages le pose. Sans cela, n'importe qui pourrait fabriquer une « invitation »
 * et la faire accepter.
 */
const invitationSchema = new mongoose.Schema(
  {
    pages: [{ type: String, enum: PAGES_COLLABORATIVES }],
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement', required: true },
    anneeScolaire: { type: Number, required: true },
    // Le PLUS HAUT droit accordé — ce que la carte annonce en une phrase.
    droit: { type: String, enum: ['consulter', 'modifier'], required: true },
    /*
     * Le droit de CHAQUE page (2026-09-13) : une invitation peut ouvrir Emploi en
     * modification et Absences en consultation. Vide sur les invitations
     * antérieures — la carte retombe alors sur `droit`.
     */
    droits: {
      type: [
        new mongoose.Schema(
          {
            page: { type: String, enum: PAGES_COLLABORATIVES, required: true },
            droit: { type: String, enum: ['consulter', 'modifier'], required: true },
          },
          { _id: false, strict: true }
        ),
      ],
      default: [],
    },
    statut: {
      type: String,
      enum: ['en_attente', 'acceptee', 'refusee', 'retiree'],
      default: 'en_attente',
    },
    reponduLe: { type: Date, default: null },
  },
  { _id: false, strict: true }
);

/**
 * Une séance d'une proposition — ou une séance SAUVEGARDÉE au moment où la
 * proposition l'a remplacée (`anciennes`), pour que « Retirer » la restaure.
 */
const seanceProposeeSchema = new mongoose.Schema(
  {
    jour: { type: String, enum: JOURS, required: true },
    seance: { type: String, enum: SEANCES, required: true },
    groupe: { type: String, trim: true, required: true },
    module: { type: String, trim: true, required: true },
    salle: { type: String, trim: true, default: '' },
  },
  { _id: false, strict: true }
);

const ETATS_JOUR = ['en_attente', 'appliquee', 'refusee'];

/**
 * La proposition d'emploi du temps d'un formateur (Phase 9 b, 2026-09-23).
 * ← `[PROPOSITION_JSON]…[/PROPOSITION_JSON]` dans le corps du message.
 *
 * ═══ LA GRILLE D'UNE SEMAINE, PAS UN DÉPLACEMENT ═══
 * La première modélisation (depuis → vers) décrivait un seul déplacement ; ce
 * que les formateurs envoient, et ce que le directeur valide jour par jour,
 * c'est leur semaine entière. Remodelée avant toute écriture — aucune donnée
 * n'existait sous l'ancienne forme.
 *
 * ⚠️ L'ÉTAT EST ENREGISTRÉ PAR JOUR, jamais recalculé. `apply_proposition.php`
 * comparait la proposition à la grille pour deviner si elle était appliquée : la
 * moindre retouche du directeur la faisait redevenir « à appliquer ».
 *
 * ⚠️ AUCUNE ROUTE DE LA MESSAGERIE NE L'ÉCRIT, comme `invitation` : seul le
 * service des propositions le pose. Le formateur et l'établissement viennent du
 * compte connecté, jamais du client.
 */
const propositionSchema = new mongoose.Schema(
  {
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement', required: true },
    anneeScolaire: { type: Number, required: true },
    semaine: { type: String, trim: true, required: true },

    /** Le MATRICULE — jamais le nom (constat §4.2, « formateurs qui disparaissent »). */
    formateurMatricule: { type: String, trim: true, required: true },

    seances: { type: [seanceProposeeSchema], default: [] },
    motif: { type: String, trim: true, default: '' },

    /*
     * `partielle` : au moins un jour appliqué. `remplacee` : le formateur en a
     * renvoyé une autre pour la même semaine avant qu'elle soit traitée.
     */
    statut: {
      type: String,
      enum: ['en_attente', 'partielle', 'appliquee', 'refusee', 'remplacee'],
      default: 'en_attente',
    },
    jours: {
      type: new mongoose.Schema(
        Object.fromEntries(JOURS.map((jour) => [jour, { type: String, enum: ETATS_JOUR, default: 'en_attente' }])),
        { _id: false, strict: true }
      ),
      default: () => ({}),
    },

    /** Ce que l'application a remplacé, jour par jour — la cible de « Retirer ». */
    anciennes: { type: [seanceProposeeSchema], default: [] },

    traiteePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    traiteeLe: { type: Date, default: null },
  },
  { _id: false, strict: true }
);

const messageSchema = new mongoose.Schema(
  {
    expediteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /*
     * ⚠️ PAS DE DESTINATAIRE SUR UN BROUILLON, et c'est la raison d'être de ce
     * `required` conditionnel : on commence souvent à écrire avant de savoir à
     * qui. L'exiger obligerait à choisir quelqu'un pour pouvoir enregistrer.
     */
    destinataireId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required() {
        return !this.brouillon;
      },
      default: null,
    },

    /*
     * ⚠️ NI SUJET NI CORPS SUR UN BROUILLON — même raison que le destinataire.
     * Et `required: true` sur une chaîne REJETTE LA CHAÎNE VIDE : sans ce
     * conditionnel, un brouillon commencé par son seul sujet était refusé, et
     * l'écran ne pouvait plus rien enregistrer avant que tout soit écrit.
     */
    sujet: {
      type: String,
      trim: true,
      required() {
        return !this.brouillon;
      },
      default: '',
    },
    corps: {
      type: String,
      required() {
        return !this.brouillon;
      },
      default: '',
    },

    lu: { type: Boolean, default: false },

    /**
     * Brouillon : un message commencé, jamais parti.
     *
     * ⚠️ IL N'APPARTIENT QU'À SON AUTEUR. Il n'a pas de destinataire unique mais
     * une LISTE en attente (`brouillonDestinataires`) : l'envoi éclatera ensuite
     * en un document par personne, comme tout envoi multiple.
     */
    brouillon: { type: Boolean, default: false },
    brouillonDestinataires: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    /**
     * Archive, par côté — comme la suppression.
     *
     * ⚠️ ARCHIVER N'EST PAS SUPPRIMER : le message quitte la boîte de réception
     * mais reste consultable. C'est ce qui permet de vider sa boîte sans rien
     * perdre, et c'est pour cela que les deux dossiers coexistent.
     */
    archiveParExpediteur: { type: Boolean, default: false },
    archiveParDestinataire: { type: Boolean, default: false },

    /** Fil de discussion. */
    reponseA: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

    /**
     * Suppression par chacune des deux parties, comme dans l'existant : le
     * message ne disparaît que lorsque les deux l'ont retiré.
     */
    supprimeParExpediteur: { type: Boolean, default: false },
    supprimeParDestinataire: { type: Boolean, default: false },

    proposition: { type: propositionSchema, default: null },

    invitation: { type: invitationSchema, default: null },

    /**
     * Le chronogramme d'UN FORMATEUR, quand un message le renvoie pour validation
     * (2026-09-22, demande du porteur : « après le formateur rempli le chronogramme, il renvoie
     * au directeur pour valider » — « en message envoyé s'affiche le chronogramme »).
     *
     * ⚠️ UN INSTANTANÉ, PAS UN LIEN. Il porte exactement ce que rend
     * `chronogramme.service.js#obtenirParFormateur` au moment de l'envoi : lignes, semaines,
     * plannings. Le message reste donc lisible même si le chronogramme change ensuite — c'est
     * la preuve de ce qui a été soumis CE JOUR-LÀ, pas une fenêtre sur l'état courant.
     *
     * ⚠️ `Mixed`, COMME LES AUTRES INSTANTANÉS DE CE PROJET (`HorairesSeances.horaires`) : sa
     * forme est celle, déjà stable et testée, du domaine du chronogramme — la dupliquer en
     * sous-schéma Mongoose serait une seconde définition à tenir à jour.
     *
     * ⚠️ AUCUNE ROUTE PUBLIQUE NE L'ÉCRIT, comme `invitation` : le schéma d'envoi de la
     * messagerie ne le déclare pas, Zod le retire. Seul le service du chronogramme le pose.
     */
    chronogrammeFormateur: { type: mongoose.Schema.Types.Mixed, default: null },

    /**
     * L'état d'écart de saisie e-note d'un formateur, quand le message en porte un (2026-10-01,
     * demande du porteur : « en message, le même style d'affichage que le panneau »). C'est lui
     * qui fait afficher les cartes par module dans le fil — le corps ne garde qu'une phrase.
     * Instantané `{semaine, debut, fin, enote, edt, ecart, lignes}` du détail calculé à l'envoi.
     *
     * ⚠️ `Mixed` et AUCUNE ROUTE PUBLIQUE NE L'ÉCRIT, comme `chronogrammeFormateur` : seul le
     * service de l'avancement le pose.
     */
    ecartSaisie: { type: mongoose.Schema.Types.Mixed, default: null },

    /**
     * L'AVIS DE PÉRIODE — stage d'un groupe ou formation d'un formateur — posé
     * automatiquement une semaine avant son début (2026-10-10, demande du porteur).
     * `{type: 'stage'|'formation', cle, sujet, debut, fin}`. `cle` sert de garde
     * anti-doublon : un même avis n'est jamais remis deux fois à la même personne.
     *
     * ⚠️ AUCUNE ROUTE PUBLIQUE NE L'ÉCRIT : seul `avisPeriodes.service.js` le pose.
     * C'est aussi lui qui ouvre l'exception à la matrice de la messagerie (un
     * directeur n'écrit pas aux stagiaires) — d'où ce marqueur, qui interdit en
     * retour d'y RÉPONDRE.
     */
    avisPeriode: { type: mongoose.Schema.Types.Mixed, default: null },

    /**
     * La copie en messagerie d'une ANNONCE du bandeau (2026-10-10) : `{id, importance}`.
     * ⚠️ Posée seulement par `annonces.service.js` — la route ne la connaît pas.
     */
    annonce: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  /*
   * ⚠️ `minimize: false` (2026-09-22) : par défaut, Mongoose SUPPRIME un objet imbriqué vide à
   * l'écriture. `chronogrammeFormateur.plannings` est vide dès qu'aucune heure n'est encore
   * posée — un chronogramme tout juste rempli à la main, sans écriture en base par groupe,
   * n'est pas un cas rare. Sans ce réglage, la carte du message perdrait silencieusement cette
   * clé, comme rencontré sur `HorairesSeances.horaires`.
   */
  { timestamps: true, strict: true, minimize: false }
);

/** Boîte de réception, et compteur de non-lus. */
messageSchema.index({ destinataireId: 1, lu: 1, createdAt: -1 });
messageSchema.index({ expediteurId: 1, createdAt: -1 });

/** Les brouillons d'une personne. */
messageSchema.index({ expediteurId: 1, brouillon: 1, updatedAt: -1 });

/** Propositions en attente, pour le directeur. */
messageSchema.index({ 'proposition.statut': 1, destinataireId: 1 });

/** Les propositions d'une semaine : cases « RÉSERVÉ » des collègues, remplacement. */
messageSchema.index(
  { 'proposition.etablissementId': 1, 'proposition.semaine': 1, 'proposition.statut': 1 },
  { partialFilterExpression: { proposition: { $type: 'object' } } }
);

export const Message = mongoose.model('Message', messageSchema);
