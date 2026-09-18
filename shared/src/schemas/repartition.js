import { z } from 'zod';

/**
 * Référentiel DRIF — écriture (F15, administrateur seul).
 * ← api/admin/upload_repartition.php, database/supprimer_filiere_repartition.php
 *
 * ⚠️ LES MÊMES SCHÉMAS VALIDENT LES ROUTES EXPRESS ET LES FORMULAIRES REACT
 * (§5bis règle 1) : une borne écrite deux fois finit par diverger, et c'est
 * l'écran qui laisse alors passer ce que le serveur refuse.
 */

const texte = (max) => z.string().trim().max(max);

/**
 * ⚠️ UNE MASSE HORAIRE EST POSITIVE ET BORNÉE : une valeur négative ferait
 * reculer un taux d'avancement, et un zéro de trop dans la saisie
 * (« 3000 » pour « 300 ») rendrait la filière ininscriptible sans qu'aucun
 * écran ne l'explique. 2 000 h dépasse largement une année de formation.
 */
const masse = z.coerce.number().min(0).max(2000);

/** Les champs d'une ligne de répartition, tels que le modèle les porte. */
export const ligneRepartitionSchema = z.object({
  secteur: texte(150).min(1, 'Le secteur est obligatoire'),
  niveauFormation: texte(30).default(''),
  typeFormation: texte(60).default(''),
  creneau: texte(10).default(''),
  codeFiliereDrif: texte(80).min(1, 'Le code de filière est obligatoire'),
  intituleFiliere: texte(250).default(''),
  codeFiliereCarte: texte(80).default(''),
  filiere: texte(250).default(''),
  anneeFormation: z.coerce.number().int().min(1).max(5),
  codeModule: texte(40).min(1, 'Le code du module est obligatoire'),
  module: texte(250).min(1, 'L’intitulé du module est obligatoire'),
  mhpS1: masse.default(0),
  mhsynS1: masse.default(0),
  mhasynS1: masse.default(0),
  mhpS2: masse.default(0),
  mhsynS2: masse.default(0),
  mhasynS2: masse.default(0),
  mhpTotale: masse.default(0),
  mhdTotale: masse.default(0),
  efmRegional: z.coerce.boolean().default(false),
  metier: texte(150).default(''),
});

/**
 * ⚠️ LA MODIFICATION EST PARTIELLE, MAIS L'IDENTITÉ NE SE MODIFIE PAS ICI :
 * changer la filière, l'année ou le code d'un module en ferait un AUTRE module,
 * qui pourrait entrer en collision avec une ligne existante. Ces trois champs
 * restent modifiables — l'index unique tranchera — mais le service le dit
 * explicitement plutôt que de laisser la base rendre une erreur brute.
 */
export const modificationRepartitionSchema = ligneRepartitionSchema.partial();

export const filtreRepartitionSchema = z.object({
  secteur: texte(150).optional(),
  niveau: texte(30).optional(),
  creneau: texte(10).optional(),
  filiere: texte(80).optional(),
  /*
   * ⚠️ 250 CARACTÈRES, ET CE N'EST PAS DU CONFORT : les métiers DRIF montent à
   * plus de quatre-vingts caractères (« Développement /Infrastructure Digitale
   * /Design Digital/ Web Marketing/ Bureautique »), et certains portent des
   * retours à la ligne hérités de l'export. Une borne courte rejetterait un
   * métier réel, et le filtre paraîtrait cassé sur ces seules valeurs.
   */
  metier: texte(250).optional(),
  annee: z.coerce.number().int().min(1).max(5).optional(),
  recherche: texte(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  parPage: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Suppression par filière, éventuellement bornée à une année.
 * ← `database/supprimer_filiere_repartition.php <CODE> [--annee=N]`
 */
export const suppressionFiliereSchema = z.object({
  annee: z.coerce.number().int().min(1).max(5).optional(),
});

/**
 * ⚠️ DEUX TEMPS, COMME L'EXISTANT : « analyse » n'écrit RIEN et annonce ce que
 * le fichier ferait ; « appliquer » exécute. Un import de 13 000 lignes qui
 * s'exécute au premier clic ne laisse aucune chance de se raviser.
 *
 * ⚠️ ET LES CORRECTIONS SE DEMANDENT EXPLICITEMENT : `upload_repartition.php`
 * était strictement additif, et une masse horaire corrigée par la DRIF passait
 * inaperçue. On peut désormais les appliquer — mais jamais sans l'avoir dit.
 */
export const importRepartitionSchema = z.object({
  /*
   * ⚠️ « REMPLACER » EST UN TROISIÈME MODE, AJOUTÉ SUR DEMANDE EXPLICITE
   * (2026-09-02). Il VIDE le référentiel avant d'écrire le fichier : un classeur
   * partiel — un secteur, une filière — laisserait donc quelques dizaines de
   * lignes à la place de 13 359. C'est le risque que l'existant avait
   * volontairement retiré ; il revient, mais CHIFFRÉ à l'analyse et écrit dans
   * une transaction.
   */
  mode: z.enum(['analyse', 'appliquer', 'remplacer']).default('analyse'),
  corrections: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((valeur) => valeur === true || valeur === 'true')
    .default(false),
});
