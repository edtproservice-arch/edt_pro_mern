import { z } from 'zod';
/*
 * ⚠️ IMPORTÉ, JAMAIS RÉEXPORTÉ D'ICI : `shared` réexporte à la fois le domaine
 * et les schémas, et un nom exporté par les deux serait ABANDONNÉ en silence
 * (`export *` écarte les noms ambigus). La liste vit dans le domaine.
 */
import { PAGES_COLLABORATIVES } from '../domain/partage/pages.js';

/**
 * Protocole de la collaboration en temps réel (Phase 5bis).
 *
 * ⚠️ UN MESSAGE WEBSOCKET EST UNE FRONTIÈRE, au même titre qu'un corps de
 * requête HTTP (§5bis règle 1) : le serveur valide chaque message reçu avec ce
 * schéma et REFUSE le reste. Le navigateur n'est pas une source de confiance —
 * n'importe qui peut ouvrir une socket et y écrire ce qu'il veut.
 *
 * ⚠️ LES ÉCRITURES NE PASSENT PAS PAR ICI. Poser, vider, importer une séance
 * reste une requête HTTP, où toute la validation vit déjà (conflits, quotas,
 * rentrée). La socket ne transporte que ce qui n'a pas besoin d'être arbitré :
 * qui est présent, sur quelle vue — et, dans l'autre sens, l'annonce qu'une
 * écriture a eu lieu.
 */

/*
 * Les pages qui ont une salle : celles du registre `PAGES_PARTAGEABLES`. La
 * salle `emploi` est partagée par l'écran de saisie (« Emploi ») et par l'écran
 * de lecture (« Édition ») : ils montrent les mêmes séances.
 */

/** Les écrans d'où l'on peut se trouver dans une salle. */
export const ECRANS_COLLABORATIFS = ['emploi', 'edition'];

/**
 * Ce que la personne regarde DANS la page. Il ne décide de rien côté serveur :
 * il sert aux autres à savoir si elle est sur la même semaine qu'eux.
 */
export const vueTempsReelSchema = z
  .object({
    ecran: z.enum(ECRANS_COLLABORATIFS).optional(),
    // « 2026-W3 » — la forme stockée, avec ou sans zéro de remplissage.
    semaine: z
      .string()
      .trim()
      .regex(/^\d{4}-W\d{1,3}$/i)
      .nullable()
      .optional(),
    periode: z.enum(['jour', 'soir']).optional(),
  })
  .strict();

const page = z.enum(PAGES_COLLABORATIVES);

export const messageTempsReelSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('rejoindre'),
      page,
      /*
       * ⚠️ L'ANNÉE ET L'ÉTABLISSEMENT SONT DEMANDÉS, JAMAIS CRUS : le serveur les
       * passe par la même résolution que `resolveTenant`. Un établissement qui
       * n'appartient pas à l'utilisateur est refusé.
       */
      anneeScolaire: z.number().int().min(2000).max(2100).nullable().optional(),
      etablissementId: z.string().trim().length(24).optional(),
      vue: vueTempsReelSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('vue'), page, vue: vueTempsReelSchema }).strict(),
  z.object({ type: z.literal('quitter'), page }).strict(),
  /*
   * ═══ LE CURSEUR D'UNE PERSONNE (étape b) ═══
   * ⚠️ PAS EN PIXELS : deux écrans n'ont ni la même largeur ni le même zoom. La
   * position est RELATIVE À UNE CASE — sa clé, et la fraction (0-1) de sa largeur
   * et de sa hauteur — et chaque écran la reprojette sur SA grille. La clé d'une
   * case dépend de l'axe (matricule ou groupe) : l'axe, la semaine et la période
   * voyagent avec, et l'écran n'affiche que les curseurs de la même vue que lui.
   * `null` = la souris a quitté la grille.
   */
  /*
   * ⚠️ SEMAINE, PÉRIODE ET AXE SONT FACULTATIFS (2026-09-13, curseurs du
   * chronogramme). Ils ne servent qu'à l'emploi du temps, dont la même case
   * change de clé selon la semaine et l'axe affichés. Le chronogramme n'en a pas
   * besoin : sa clé (`groupe||module||semaine`) désigne la même cellule dans la
   * vue par groupe comme dans la vue par formateur.
   */
  z
    .object({
      type: z.literal('curseur'),
      page,
      position: z
        .object({
          semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i).optional(),
          periode: z.enum(['jour', 'soir']).optional(),
          axe: z.enum(['formateur', 'groupe']).optional(),
          cle: z.string().trim().min(1).max(200),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  /*
   * La case qu'une personne a OUVERTE pour la saisir — dessinée chez les autres
   * dans sa couleur, avec son nom : c'est ce qui évite que deux personnes
   * remplissent la même case en même temps sans le savoir.
   */
  z
    .object({
      type: z.literal('focus'),
      page,
      focus: z
        .object({
          semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i).optional(),
          periode: z.enum(['jour', 'soir']).optional(),
          axe: z.enum(['formateur', 'groupe']).optional(),
          cle: z.string().trim().min(1).max(200),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  /*
   * ═══ LE GUIDAGE (2026-10-03, demande du porteur) ═══ « Quand l'admin bascule
   * entre les pages, le directeur bascule aussi, et il voit mon curseur — pour
   * les démonstrations et la formation à distance. » Seul un administrateur EN
   * COLLABORATION l'émet (contrôlé par le serveur) ; seuls les directeurs de
   * l'établissement le reçoivent. Rien n'y écrit : le directeur VOIT, il n'est
   * piloté que dans sa navigation, et peut cesser de suivre à tout moment.
   */
  z.object({ type: z.literal('guide'), actif: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('guide-nav'),
      // Une adresse de l'application, jamais une URL : pas d'autre origine.
      chemin: z
        .string()
        .max(500)
        .regex(/^\/app(?:[/?#][^\s]*)?$/),
    })
    .strict(),
  /*
   * ⚠️ PAS EN PIXELS, pour la même raison que `curseur`. ═══ ACCROCHÉ À
   * L'ÉLÉMENT SURVOLÉ (2026-10-04) ═══ : son chemin depuis une racine commune
   * (rang de chaque enfant), et la fraction (0-1) de SA largeur et de SA
   * hauteur. Une fraction de toute la zone décalait le curseur sur un écran
   * plus petit. `null` = hors de toute racine.
   */
  z
    .object({
      type: z.literal('guide-curseur'),
      position: z
        .object({
          portee: z.enum(['contenu', 'barre', 'entete', 'panneau', 'dialogue', 'menu']),
          chemin: z.array(z.number().int().min(0).max(100_000)).max(60),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          clic: z.boolean().optional(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ type: z.literal('guide-defilement'), y: z.number().min(0).max(1) }).strict(),
  /*
   * ═══ LES GESTES (2026-10-04) ═══ « Chaque action que je fais s'affiche chez
   * le directeur. » Un élément est décrit par ce que l'écran MONTRE — sa
   * portée, son rôle, son libellé, son rang parmi ses semblables — et rejoué
   * chez le directeur. `etat` est l'état VOULU d'une bascule (« true »,
   * « expanded ») : le directeur ne clique que si le sien diffère. `fenetres`
   * et `barre` réalignent ce qu'un clic ailleurs a fermé ou replié.
   *
   * ⚠️ UN CLIC QUI ÉCRIT N'ARRIVE JAMAIS ICI : l'émetteur l'écarte (voir
   * `useGuidageEmetteur`) — rejoué, il écrirait deux fois.
   */
  z
    .object({
      type: z.literal('guide-geste'),
      geste: z
        .object({
          action: z.enum(['clic', 'double', 'saisie']),
          // Les touches tenues pendant le clic — Ctrl, Maj, Alt, Méta (2026-10-04).
          modifs: z.string().regex(/^[csam]{0,4}$/).optional(),
          portee: z.enum(['document', 'contenu', 'barre', 'panneau', 'dialogue', 'menu']),
          genre: z.string().max(40),
          texte: z.string().max(120),
          rang: z.number().int().min(0).max(10_000),
          etat: z.string().max(20).nullable().optional(),
          valeur: z.string().max(500).optional(),
          // Le bouton qui ouvre la liste d'une option (2026-10-04) — pour l'ouvrir d'abord s'il le faut.
          declencheur: z
            .object({
              portee: z.enum(['document', 'contenu', 'barre', 'panneau', 'dialogue', 'menu']),
              genre: z.string().max(40),
              texte: z.string().max(120),
              rang: z.number().int().min(0).max(10_000),
            })
            .strict()
            .optional(),
        })
        .strict()
        .nullable(),
      fenetres: z.number().int().min(0).max(20),
      // Une écriture vient de se faire chez l'émetteur : relire ses données (2026-10-04).
      ecriture: z.boolean().optional(),
      barre: z.enum(['expanded', 'collapsed']).nullable().optional(),
    })
    .strict(),
  /*
   * ═══ L'ÉTAT D'UNE PAGE (2026-10-04) ═══ Ce qu'aucun clic ne porte — la
   * sélection de cases, la séance en cours de glissement — publié par la page
   * sous une clé (`emploi.selection`). ⚠️ Des valeurs PLATES et bornées : des
   * chaînes, une liste de chaînes, un objet de chaînes — jamais un document
   * arbitraire.
   */
  z
    .object({
      type: z.literal('guide-etat'),
      cle: z.string().regex(/^[a-z][a-zA-Z0-9.]{0,59}$/),
      valeur: z.union([
        z.null(),
        z.string().max(200),
        z.array(z.string().max(200)).max(1500),
        // Clés de case (« 9863|lundi|1|jour ») et messages de refus : plus longs qu'un identifiant.
        // Une valeur peut être une LISTE de chaînes : les filtres de l'Avancement (2026-10-04).
        z.record(
          z.string().max(200),
          z.union([z.string().max(500), z.number(), z.boolean(), z.null(), z.array(z.string().max(200)).max(500)])
        ),
      ]),
    })
    .strict(),
  /*
   * ═══ LES MESSAGES (2026-10-04, demande du porteur : « n'importe quel message
   * qui s'affiche chez moi s'affiche chez lui ») ═══ Une notification (toast)
   * apparue chez l'un est reproduite chez l'autre — en TEXTE seulement.
   */
  /*
   * ═══ LES RACCOURCIS CLAVIER (2026-10-04) ═══ Hors d'un champ : Ctrl+C dans une
   * grille, une flèche, Suppr… L'émetteur n'envoie pas ceux qui ont écrit.
   */
  z
    .object({
      type: z.literal('guide-touche'),
      touche: z
        .object({
          key: z.string().min(1).max(30),
          code: z.string().max(30),
          modifs: z.string().regex(/^[csam]{0,4}$/).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('guide-message'),
      genre: z.enum(['success', 'error', 'info', 'warning', 'default']),
      titre: z.string().max(300),
      description: z.string().max(1000).optional(),
    })
    .strict(),
]);

/**
 * Codes de fermeture de la socket. Le navigateur ne voit PAS le statut HTTP
 * d'une poignée de main refusée — seulement un code de fermeture. D'où ces
 * codes applicatifs (plage 4000-4999, réservée aux applications).
 */
export const FERMETURES_TEMPS_REEL = {
  /** Jeton absent ou expiré : rafraîchir la session, puis se reconnecter. */
  REAUTHENTIFIER: 4001,
  /** Compte désactivé, bloqué ou supprimé : ne pas se reconnecter. */
  COMPTE_REFUSE: 4003,
  /** Trop de messages : le client est défaillant, inutile d'insister. */
  TROP_DE_MESSAGES: 4008,
};
