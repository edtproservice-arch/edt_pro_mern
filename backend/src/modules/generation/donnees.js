/**
 * Ce que la génération LIT — chargement et prévisualisation.
 *
 * Séparé de l'orchestration parce que ce sont deux responsabilités distinctes :
 * ici rien n'est écrit, et `previsualiser` est d'ailleurs appelée AVANT toute
 * confirmation. Les garder ensemble poussait `generation.service.js` au-delà
 * des ~300 lignes que ce projet s'impose.
 */

import { MOTIFS_IGNOREE, PERIODES } from 'shared/constants';
import { analyserSemaine, normaliserValeurSemaine } from 'shared/domain';

import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Base } from '../../models/Base.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { notFound } from '../../lib/httpError.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { chargerPieces } from '../espaces/espaces.service.js';
import { autresEtablissementsDuFormateur } from '../espaces/formateursMutualises.service.js';
import { depuisMongo } from '../chronogramme/chronogramme.service.js';
import { tachesDeLaSemaine } from './taches.js';

/**
 * Une séance que la génération ne doit JAMAIS écraser.
 *
 * ⚠️ L'ANCIEN ÉCRASAIT TOUT — il repartait d'une grille vide. Le MERN a depuis
 *    deux choses qu'il verrouille dans `poser()` : les surveillances d'EFM
 *    (une date d'examen, décidée ailleurs) et les rattrapages (rattachés à une
 *    absence précise). Les effacer détruirait un examen planifié et
 *    décrocherait une absence de son rattrapage — sans que rien ne le dise.
 */
/**
 * Les tâches d'une semaine, lues sur les données communes.
 *
 * ═══ ⚠️ UNE SEULE FAÇON D'APPELER `tachesDeLaSemaine` ═══ (2026-09-27)
 * Quatre appelants — génération, simulation des relances, prévisualisation,
 * placement des séances manquantes — lui passaient chacun leurs paramètres.
 * La simulation avait oublié `groupes` et `sallesAffectations` : elle ignorait
 * les salles déclarées par module, et comptait donc ce qu'une relance
 * rapporterait sur un problème que la génération ne pose pas. Ce qu'elle
 * promet doit être ce que la génération fera.
 */
export function tachesPour(commun, numero) {
  return tachesDeLaSemaine({
    chronogrammes: commun.chronogrammes,
    affectations: commun.base.affectations ?? [],
    groupes: commun.base.groupes ?? [],
    sallesAffectations: commun.sallesAffectations,
    numero,
  });
}

export const aPreserver = (seance) => Boolean(seance.estEfm) || Boolean(seance.rattrapageDe);

/** Le solveur ne remplit que la grille de jour ; le soir se saisit à la main. */
export const estDuJour = (seance) => (seance.periode ?? PERIODES.JOUR) === PERIODES.JOUR;

/**
 * Ce que `poser()` relit à CHAQUE séance, et qui ne change jamais (2026-09-22).
 *
 * ═══ ⚠️ MESURÉ AVANT D'ÊTRE ÉCRIT ═══
 * Une semaine réelle : 181 placements, **59,9 s** dans la boucle d'écriture —
 * 331 ms par séance, contre 460 ms pour TOUTE la résolution Python. Le calcul
 * ne pèse rien ; tout part en allers-retours vers la base (47 ms de latence
 * mesurée, 5 à 7 requêtes par `poser()`).
 *
 * ⚠️ ET LE DISPOSITIF EXISTAIT DÉJÀ : `poser()` accepte `obtenirPieces` et
 *    `obtenirAutresEtablissements` depuis toujours ; la génération ne les
 *    fournissait simplement pas. Même schéma que `creneauxAEviter` la veille —
 *    le mécanisme est construit, personne ne le branche.
 *
 * ⚠️ ON MÉMOÏSE LA PROMESSE, PAS LE RÉSULTAT : deux appels concurrents
 *    partagent alors la même requête au lieu d'en lancer deux. Le chemin est
 *    séquentiel aujourd'hui, mais c'est la forme qui reste juste s'il cesse de
 *    l'être.
 *
 * ⚠️ PARESSEUX : `previsualiser` et `simuler` n'écrivent jamais. Charger ces
 *    pièces d'office leur coûterait des requêtes pour rien.
 */
function prechargePourPoser(etablissementId, anneeScolaire, base, etablissement, rentrees) {
  /** Les salles partagées : IDENTIQUES pour les 181 placements d'une semaine. */
  let pieces = null;
  /** Les établissements d'un formateur mutualisé : ~25 matricules, pas 181 séances. */
  const parMatricule = new Map();

  return {
    base,
    etablissement,
    rentrees,
    obtenirPieces() {
      pieces ??= chargerPieces(etablissementId);
      return pieces;
    },
    obtenirAutresEtablissements(matricule) {
      const cle = String(matricule ?? '').trim();
      if (!parMatricule.has(cle)) {
        parMatricule.set(
          cle,
          autresEtablissementsDuFormateur(etablissementId, anneeScolaire, cle, etablissement)
        );
      }
      return parMatricule.get(cle);
    },
  };
}

/**
 * Ce qui ne change pas d'une semaine à l'autre, lu une seule fois.
 *
 * ⚠️ C'EST LA MOITIÉ DU GAIN DE VITESSE. Base, établissement, contraintes,
 *    chronogrammes et calendrier national sont identiques pour les 45 semaines :
 *    les relire à chaque tour, c'était 5 requêtes × 45.
 */
export async function chargerCommun(etablissementId, anneeScolaire) {
  const [base, etablissement, config, chronogrammes, national] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire })
      .select('affectations formateurs groupes sallesAffectations')
      .lean(),
    /*
     * ⚠⚠ `espacesMutualises` EST INDISPENSABLE, PAS DECORATIF (2026-09-22).
     *    Ce document sert de PRÉCHARGE à `poser()`, et `salleAVerifier` le lit
     *    pour décider s'il faut chercher un conflit dans les autres
     *    établissements. Sans ce champ, le verdict passait à `false` et **le
     *    contrôle était purement sauté** : la génération pouvait poser un cours
     *    dans une salle partagée déjà occupée par l'autre établissement, là où
     *    la saisie manuelle l'aurait refusé.
     *
     * ⚠️ VÉRIFIÉ SUR DONNÉES RÉELLES : 1 salle sur 16 (« Atelier FM ») changeait
     *    de verdict entre le document complet et celui-ci. Le défaut était
     *    silencieux — aucune erreur, juste un contrôle qui ne s'exécutait pas.
     *
     * ⚠️ **UNE PRÉCHARGE TRONQUÉE NE FAIT PAS GAGNER DU TEMPS : ELLE CHANGE LE
     *    RÉSULTAT.** Tout champ qu'un contrôle de `poser()` consulte doit être
     *    ici, sans quoi la génération juge sur des données plus pauvres que la
     *    saisie à la main.
     */
    Etablissement.findById(etablissementId)
      .select('espaces groupesFq espacesMutualises nom nomAbrege complexe')
      .lean(),
    AutoGenConfig.findOne({ etablissementId, anneeScolaire }).select('contraintes graine').lean(),
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
    calendrierNational(anneeScolaire),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  return {
    base,
    etablissement,
    contraintes: config?.contraintes ?? [],
    graineEnregistree: config?.graine ?? null,
    /*
     * ⚠️ `depuisMongo` ATTEND LA `Map` DE MONGOOSE. Avec `.lean()`, le champ
     *    revient en objet nu : on le reconvertit, sinon la boucle
     *    `for (const [module, seances] of planning)` ne rend RIEN — et toutes
     *    les semaines ressortiraient vides, sans erreur.
     */
    chronogrammes: chronogrammes.map((chrono) => ({
      groupe: chrono.groupe,
      planning: depuisMongo(new Map(Object.entries(chrono.planning ?? {}))),
    })),
    formateurs: (base.formateurs ?? [])
      .filter((formateur) => String(formateur.matricule ?? '').trim() !== '')
      .map((formateur) => ({
        matricule: String(formateur.matricule).trim(),
        nom: formateur.nomComplet,
      })),
    /*
     * ⚠️ DÉJÀ UN OBJET NU — NE PAS LE RECONVERTIR. Sous `.lean()`, Mongoose
     *    rend un champ `Map` en objet simple : c'est précisément ce que la
     *    remarque sur `planning` dit juste au-dessus, et c'est pourquoi ce
     *    champ-ci se lit tel quel. `Object.fromEntries()` LÈVERAIT ici
     *    (« object is not iterable ») — la génération entière répondrait 500.
     *
     * ⚠️ Le présentateur de `base.service.js`, lui, reçoit un VRAI document et
     *    doit bien faire `Object.fromEntries()`. Les deux lignes se
     *    ressemblent et ne peuvent PAS être les mêmes : c'est `.lean()` qui
     *    décide, pas le schéma.
     */
    sallesAffectations: base.sallesAffectations ?? {},
    national,
    /*
     * ⚠️ CONSTRUITE ICI, DONC UNE FOIS PAR GÉNÉRATION et non par semaine :
     *    les salles partagées et les formateurs mutualisés ne changent pas
     *    d'une semaine à l'autre. La mémoïser par semaine ne sauverait que
     *    180 requêtes sur 181, au lieu de toutes sauf une par année.
     */
    prechargePoser: prechargePourPoser(
      etablissementId,
      anneeScolaire,
      base,
      etablissement,
      national.rentrees
    ),
  };
}

/**
 * Ce qu'une génération remplacerait, sans rien écrire.
 *
 * ⚠️ APPELÉE AVANT LA CONFIRMATION. La génération ÉCRASE les séances ordinaires
 *    de la semaine — comportement de l'ancien, conservé. Mais l'ancien ne le
 *    disait nulle part : une grille tenue à la main disparaissait sans qu'on
 *    ait rien cliqué d'autre que « Lancer ». Ici l'écran peut chiffrer la perte
 *    avant de demander.
 */
export async function previsualiser(etablissementId, anneeScolaire, { semaines }) {
  const valeurs = semaines.map((valeur) => normaliserValeurSemaine(valeur)).filter(Boolean);

  const [existantes, commun] = await Promise.all([
    Seance.find({
      etablissementId,
      anneeScolaire,
      semaine: { $in: valeurs },
    })
      .select('semaine periode estEfm rattrapageDe')
      .lean(),
    /*
     * ═══ ⚠️ CE QUE LA CARTE VA PERDRE, DIT AVANT DE GÉNÉRER ═══ (2026-09-22)
     * Un module que le chronogramme planifie mais qu'aucune affectation ne
     * porte ne devient JAMAIS une tâche : ses heures disparaissent de la
     * semaine sans apparaître dans les « non placées », puisqu'on n'a jamais
     * essayé de les poser. Mesuré sur l'année réelle : **39 couples groupe ×
     * module** dans ce cas. Le rapport les signalait déjà — mais APRÈS coup.
     *
     * ⚠️ **C'EST LA CARTE QU'IL FAUT CORRIGER, PAS LE GÉNÉRATEUR**, et le
     *    savoir avant évite de relancer trois fois en cherchant un réglage.
     */
    chargerCommun(etablissementId, anneeScolaire),
  ]);

  /*
   * ⚠️ MESURÉ AVANT D'ÊTRE AJOUTÉ : +346 ms sur les 470 ms de cette
   *    prévisualisation, pour les 45 semaines d'une année. `tachesDeLaSemaine`
   *    est PURE ; tout le coût est la lecture unique de `chargerCommun`.
   *
   * ⚠️ ET C'EST POURQUOI LA SEMAINE FERMÉE N'EST PAS ICI : la détecter
   *    demanderait le calendrier de CHAQUE semaine, soit `lireSemaine` × 45 —
   *    **12,7 s mesurées**, vingt-sept fois le coût actuel, sur un écran qui se
   *    rafraîchit à chaque case cochée. Le rapport de génération la nomme déjà,
   *    et générer une semaine fermée n'écrit plus rien.
   */
  const modulesSansAffectation = new Set();
  /*
   * ⚠️ SÉPARÉ, PARCE QUE LA CORRECTION EST L'INVERSE (2026-09-22) : un groupe
   *    absent de la carte demande de retirer ou renommer son CHRONOGRAMME ;
   *    un module non affecté demande d'ajouter une AFFECTATION. Les réunir
   *    envoyait chercher au mauvais endroit — et sur l'année réelle, les 39
   *    cas étaient tous du premier type.
   */
  const groupesAbsents = new Set();

  const parSemaine = valeurs.map((valeur) => {
    const deLaSemaine = existantes.filter(
      (seance) => seance.semaine === valeur && estDuJour(seance)
    );

    let demandees = 0;
    const analyse = analyserSemaine(valeur);
    if (analyse) {
      const { taches, ignorees } = tachesPour(commun, analyse.numero);
      demandees = taches.reduce((total, tache) => total + tache.seancesRequises, 0);
      for (const entree of ignorees) {
        if (entree.motif === MOTIFS_IGNOREE.GROUPE_ABSENT) groupesAbsents.add(entree.groupe);
        else modulesSansAffectation.add(`${entree.groupe} · ${entree.module}`);
      }
    }

    return {
      semaine: valeur,
      remplacees: deLaSemaine.filter((seance) => !aPreserver(seance)).length,
      preservees: deLaSemaine.filter(aPreserver).length,
      /** Ce que le chronogramme réclame — pour comparer à ce qui est déjà posé. */
      demandees,
    };
  });

  return {
    semaines: parSemaine,
    modulesSansAffectation: [...modulesSansAffectation],
    /** Les groupes dont le chronogramme a survécu à la carte. */
    groupesAbsents: [...groupesAbsents],
  };
}
