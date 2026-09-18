import { z } from 'zod';

/**
 * Calendrier national : vacances du réseau et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 *
 * ⚠️ LES MÊMES SCHÉMAS VALIDENT LA ROUTE EXPRESS ET LE FORMULAIRE REACT
 * (§5bis règle 1) : une borne écrite deux fois finit par diverger, et c'est
 * l'écran qui laisse alors passer ce que le serveur refuse.
 */
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

/**
 * ⚠️ UNE PÉRIODE À L'ENVERS EST REFUSÉE, pas remise dans l'ordre en silence :
 * sur les stages, le service les réordonnait — utile pour une saisie, mais ici
 * la période est nationale, et une inversion signale une erreur de saisie qu'il
 * vaut mieux montrer que corriger.
 */
/**
 * ═══ ⚠️⚠️ LE CHAMP S'APPELLE `intitule` SUR LE FIL, PAS `nom` ═══
 * (corrigé le 2026-09-03, signalé par le porteur : la page répondait 400.)
 *
 * `EtapeCalendrier` — le calendrier PARTAGÉ entre l'assistant, les Paramètres et
 * l'administration — émet `{ intitule, debut, fin }`, et c'est déjà le
 * vocabulaire du calendrier d'un établissement. Ce schéma exigeait `nom` : toute
 * période saisie depuis l'écran d'administration était donc REFUSÉE, et le seul
 * signe en était un 400 dans la console.
 *
 * ⚠️ MES TESTS NE POUVAIENT PAS LE VOIR : ils envoyaient `nom`, c'est-à-dire ce
 * que le schéma attendait, au lieu de ce que le CLIENT produit. Une fixture
 * écrite à la main décrit ce qu'on croit que la donnée contient.
 *
 * Le MODÈLE garde `nom` — le renommer imposerait une migration pour rien. C'est
 * le service qui traduit, dans les deux sens, une seule fois.
 */
export const periodeVacancesSchema = z
  .object({
    intitule: z.string().trim().min(2, 'Deux caractères au minimum').max(120),
    debut: jour,
    fin: jour,
  })
  .refine((p) => p.debut <= p.fin, {
    message: 'La fin ne peut pas précéder le début',
    path: ['fin'],
  });

/**
 * ⚠️ TROIS ANNÉES DE FORMATION, PAS CINQ (correction du porteur, 2026-09-03).
 * La répartition DRIF ne connaît que `anneeFormation` 1 à 3, et l'année d'un
 * groupe se lit dans son numéro (« DEVOWFS201 » → 2) : une rentrée déclarée en
 * 4ᵉ année ne gèlerait jamais rien, et la borne le dit plutôt que de laisser
 * l'admin saisir une valeur sans effet.
 */
export const ANNEES_FORMATION = [1, 2, 3];

export const rentreeSchema = z.object({
  anneeFormation: z.coerce.number().int().min(1).max(3),
  date: jour,
});

export const calendrierNationalSchema = z.object({
  vacances: z.array(periodeVacancesSchema).max(40).default([]),
  rentrees: z.array(rentreeSchema).max(3).default([]),
});

export const anneeCalendrierSchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
});
