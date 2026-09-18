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

const propositionSchema = new mongoose.Schema(
  {
    statut: {
      type: String,
      enum: ['en_attente', 'acceptee', 'refusee'],
      default: 'en_attente',
    },

    /** Séance d'origine et créneau souhaité. */
    seanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seance', default: null },
    semaine: { type: String, trim: true, default: '' },

    depuis: {
      jour: { type: String, enum: [...JOURS, ''], default: '' },
      seance: { type: String, enum: [...SEANCES, ''], default: '' },
    },
    vers: {
      jour: { type: String, enum: [...JOURS, ''], default: '' },
      seance: { type: String, enum: [...SEANCES, ''], default: '' },
      salle: { type: String, trim: true, default: '' },
    },

    motif: { type: String, trim: true, default: '' },

    traiteePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    traiteeLe: { type: Date, default: null },
  },
  { _id: false }
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
  },
  { timestamps: true, strict: true }
);

/** Boîte de réception, et compteur de non-lus. */
messageSchema.index({ destinataireId: 1, lu: 1, createdAt: -1 });
messageSchema.index({ expediteurId: 1, createdAt: -1 });

/** Les brouillons d'une personne. */
messageSchema.index({ expediteurId: 1, brouillon: 1, updatedAt: -1 });

/** Propositions en attente, pour le directeur. */
messageSchema.index({ 'proposition.statut': 1, destinataireId: 1 });

export const Message = mongoose.model('Message', messageSchema);
