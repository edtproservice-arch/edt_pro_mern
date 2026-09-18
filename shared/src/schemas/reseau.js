import { z } from 'zod';
import { REGIONS_OFPPT } from '../constants/index.js';

/**
 * Réseau OFPPT — le référentiel région → complexe → établissement.
 * ← public/data/etablissements.json
 *
 * ⚠️ LA RÉGION EST UNE ÉNUMÉRATION FERMÉE : elles sont figées (décision du
 * 2026-09-02), et une valeur inattendue doit être REFUSÉE plutôt qu'acceptée
 * puis introuvable dans la cascade. Le modèle Mongoose porte le même `enum` —
 * les deux disent la même chose, à deux frontières différentes.
 */
const region = z.enum(REGIONS_OFPPT);

/*
 * ⚠️ 200 CARACTÈRES : les noms officiels sont longs — « INSTITUT SPECIALISE DE
 * TECHNOLOGIE APPLIQUEE INDUSTRIEL BEN M'SIK CASABLANCA » en fait 78, et
 * certains libellés de complexe davantage. Une borne courte rejetterait un
 * établissement réel.
 */
const nom = z.string().trim().min(2, 'Deux caractères au minimum').max(200);

export const etablissementOfpptSchema = z.object({
  region,
  complexe: nom,
  nom,
});

export const modificationEtablissementOfpptSchema = etablissementOfpptSchema.partial();

export const filtreReseauSchema = z.object({
  region: region.optional(),
  complexe: z.string().trim().max(200).optional(),
  recherche: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  parPage: z.coerce.number().int().min(1).max(200).default(50),
});

/** Renommage groupé d'un complexe — tous ses établissements suivent. */
export const renommageComplexeSchema = z.object({
  region,
  ancien: nom,
  nouveau: nom,
});

export const suppressionComplexeSchema = z.object({
  region,
  complexe: nom,
});
