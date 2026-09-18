import { z } from 'zod';
import { DROITS_ACCORDABLES, PORTEES_GENERALES } from '../domain/partage/droits.js';
import { PAGES_COLLABORATIVES } from '../domain/partage/pages.js';

/**
 * Partage d'une page collaborative — la boîte « Partager » de Notion
 * (Phase 5bis, étape c).
 *
 * ⚠️ LE DIRECTEUR ACCORDE « CONSULTER » OU « MODIFIER », JAMAIS LA PROPRIÉTÉ :
 * publier, importer, réinitialiser et partager restent à lui (décision du
 * 2026-09-12). Un schéma qui accepterait `proprietaire` ouvrirait ces gestes à
 * n'importe quel invité par une simple requête.
 */
const identifiant = z.string().trim().length(24);
const droit = z.enum(DROITS_ACCORDABLES);
const page = z.enum(PAGES_COLLABORATIVES);

export const pagePartageSchema = z.object({ page });

/*
 * ═══ UN DROIT PAR PAGE (2026-09-13, demande du porteur : « pour chaque invité,
 * le directeur sélectionne les pages qu'il peut consulter, avec leur permission
 * pour chaque page ») ═══
 * `{ emploi: 'modifier', absences: 'consulter' }`. ⚠️ En Zod 3, une clé
 * d'énumération est VÉRIFIÉE à l'exécution : une page inconnue est refusée, pas
 * ignorée. Le service borne encore chaque droit au `droitMax` de sa page.
 */
const droitsParPage = z.record(page, droit);

export const invitationSchema = z
  .object({
    // Une invitation vise souvent plusieurs personnes à la fois ; 50 bornent
    // l'abus sans gêner un établissement de 40 formateurs.
    utilisateurIds: z.array(identifiant).min(1, 'Choisissez au moins une personne').max(50),
    droit: droit.default('modifier'),
    /*
     * Les AUTRES pages à ouvrir d'un coup (étape d) — la page de la route en
     * fait toujours partie. Le service refuse une page qui n'est pas prête.
     */
    pages: z.array(page).max(PAGES_COLLABORATIVES.length).optional(),
    /*
     * Le droit PAGE PAR PAGE — il l'emporte sur `droit` pour les pages qu'il
     * nomme, et chacune de ses pages entre dans l'invitation. `droit` reste celui
     * des pages qu'il ne nomme pas (la page de la route, `pages`).
     */
    droits: droitsParPage.optional(),
  })
  .strict();

export const droitMembreSchema = z.object({ droit }).strict();

/**
 * Les pages d'UN invité, réglées d'un coup depuis sa ligne de la boîte
 * « Partager ». `null` = plus aucun accès par invitation sur cette page. Une
 * page non nommée n'est pas touchée.
 */
export const pagesMembreSchema = z
  .object({
    droits: z
      .record(page, droit.nullable())
      .refine((droits) => Object.keys(droits).length > 0, 'Aucune page à régler'),
  })
  .strict();

export const accesGeneralSchema = z
  .object({
    portee: z.enum(Object.values(PORTEES_GENERALES)),
    droit: droit.default('consulter'),
  })
  .strict();
