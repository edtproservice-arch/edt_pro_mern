/**
 * Le contrat entre Node et le solveur Python, exercé pour de vrai.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * `generation.test.js` vérifie que Node construit un problème correct ; les
 * tests de `ai/` vérifient que Python résout correctement. Aucun des deux ne
 * dit que **les deux se parlent**. Or c'est précisément là que les ponts
 * cassent : un champ renommé d'un côté, une clé en camelCase oubliée, et la
 * chaîne rend « PROBLEME_INVALIDE » sans qu'aucune suite ne l'ait vu venir.
 *
 * Ces tests lancent le vrai sous-processus, avec un vrai problème construit par
 * `construireProbleme`.
 *
 * ⚠️ IGNORÉS SI PYTHON EST ABSENT, jamais en échec : un développeur front n'a
 *    pas à installer Python pour lancer la suite. Un test rouge pour une
 *    dépendance manquante finit par être ignoré, et c'est alors le vrai défaut
 *    qu'on cesse de voir.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { MOTEURS, MOTIFS_INTERDICTION, REPLIS_MOTEUR, TYPES_COURS } from 'shared/constants';

import { env } from '../../src/config/env.js';
import { construireProbleme } from '../../src/modules/generation/probleme.js';
import {
  delaiPour,
  optionsSolveur,
  resoudre,
} from '../../src/modules/generation/solveur.client.js';

const pythonDisponible = (() => {
  try {
    return spawnSync(process.env.PYTHON_BIN ?? 'python', ['--version']).status === 0;
  } catch {
    return false;
  }
})();

const decrire = pythonDisponible ? describe : describe.skip;

function semaineOuverte(jours = ['Lundi', 'Mardi', 'Mercredi']) {
  return {
    semaine: '2026-W3',
    anneeScolaire: 2026,
    jours: jours.map((jour, i) => ({
      jour,
      date: `2026-09-${String(14 + i).padStart(2, '0')}`,
      ferie: null,
      vacances: false,
      rentreesGelees: [],
      stages: [],
      formations: [],
    })),
    seances: [],
  };
}

const tache = (id, extra = {}) => ({
  id,
  formateurMatricule: '15688',
  groupeLibelle: 'GM101',
  groupes: ['GM101'],
  module: 'M1',
  type: TYPES_COURS.PRESENTIEL,
  seancesRequises: 2,
  priorite: 3,
  ...extra,
});

const construire = (taches, options = {}) =>
  construireProbleme({
    semaine: semaineOuverte(),
    taches,
    salles: ['Salle 1', 'Salle 2'],
    groupesFq: [],
    contraintes: [],
    formateurs: [{ matricule: '15688', nom: 'ABDELGHANI LAASAL' }],
    graine: 4815,
    ...options,
  });

decrire('solveur Python', () => {
  it('accepte un problème construit par construireProbleme', async () => {
    const { probleme } = construire([tache('T1')]);
    const solution = await resoudre(probleme);

    expect(solution.placements).toHaveLength(2);
    expect(solution.nonPlacees).toEqual([]);
    // Le rapport confirme que la graine a bien traversé le pont.
    expect(solution.rapport.graine).toBe(4815);
  });

  it('rend des créneaux et des salles que Node sait retraduire', async () => {
    const { probleme, creneauVersCase } = construire([tache('T1')]);
    const solution = await resoudre(probleme);

    for (const placement of solution.placements) {
      // Sans cette correspondance, le service ne pourrait pas écrire la séance.
      expect(creneauVersCase.get(placement.creneauId)).toMatchObject({
        jour: expect.any(String),
        seance: expect.stringMatching(/^S[1-4]$/),
      });
      expect(['Salle 1', 'Salle 2']).toContain(placement.salle);
    }
  });

  it('respecte les créneaux interdits calculés par Node', async () => {
    /*
     * Le stage d'un groupe, traduit en interdictions : c'est tout le principe du
     * contrat — Python ne sait pas ce qu'est un stage, il lit des identifiants.
     */
    const semaine = semaineOuverte();
    semaine.jours[0].stages = [{ groupe: 'GM101' }];

    const { probleme, creneauVersCase } = construire([tache('T1')], { semaine });
    const solution = await resoudre(probleme);

    const joursUtilises = solution.placements.map(
      (placement) => creneauVersCase.get(placement.creneauId).jour
    );
    expect(joursUtilises).not.toContain('Lundi');
  });

  it('rend une cause de non-placement que Node peut traduire', async () => {
    // Plus de séances que la semaine ne peut en contenir pour un formateur.
    const { probleme } = construire([tache('T1', { seancesRequises: 99 })]);
    const solution = await resoudre(probleme);

    expect(solution.nonPlacees).toHaveLength(1);
    expect(solution.nonPlacees[0]).toMatchObject({
      tacheId: 'T1',
      cause: expect.any(String),
      manquantes: expect.any(Number),
    });
  });

  it('REFUSE un problème mal formé, en 400 et en nommant le champ', async () => {
    /*
     * ⚠️ Le garde qui rattrape les renommages : si Node se met à envoyer une
     *    clé que Python ne connaît pas, la chaîne s'arrête ici — pas trois
     *    écrans plus loin sur une grille à moitié vide.
     */
    const { probleme } = construire([tache('T1')]);
    probleme.tachesEnTrop = [];

    await expect(resoudre(probleme)).rejects.toMatchObject({
      status: 400,
      code: 'PROBLEME_INVALIDE',
    });
  });

  it('rend la même grille pour la même graine', async () => {
    const premiere = await resoudre(construire([tache('T1'), tache('T2')]).probleme);
    const seconde = await resoudre(construire([tache('T1'), tache('T2')]).probleme);
    expect(premiere.placements).toEqual(seconde.placements);
  });
});

/**
 * ═══ LE CHOIX DU MOTEUR, DE BOUT EN BOUT (2026-09-22) ═══
 *
 * ⚠️ CE QUE CES TESTS VÉRIFIENT EST LA TRANSMISSION, PAS LA QUALITÉ. Que
 *    CP-SAT place plus de séances que le glouton est mesuré ailleurs — sur
 *    l'année réelle, et par les 34 tests de `ai/`. Ici, la question est celle
 *    d'un pont : ce que Node demande est-il ce que Python reçoit ? C'est la
 *    leçon du 2026-09-21, où un test d'arbitrage jugeait en fait la vitesse du
 *    solveur et changeait de verdict selon la charge de la machine.
 *
 * ⚠️ BUDGET COURT, DÉLIBÉRÉMENT. Sur trois tâches, CP-SAT conclut
 *    instantanément ; lui donner les 20 secondes de production ne prouverait
 *    rien de plus et coûterait 20 secondes à chaque lancement de la suite.
 */
const BUDGET_TEST = 2000;

decrire('choix du moteur', () => {
  it('transmet « cpsat » au solveur, qui le rapporte', async () => {
    const { probleme } = construire([tache('T1', { seancesRequises: 99 })]);

    const solution = await resoudre(probleme, {
      moteur: MOTEURS.CPSAT,
      budgetMs: BUDGET_TEST,
    });

    /*
     * ⚠️ `moteurDemande` ET NON `moteur` : le second nomme celui qui a
     *    RÉELLEMENT produit la grille, et `choix.py` garde celle du glouton
     *    quand CP-SAT ne fait pas strictement mieux. Affirmer ici
     *    `moteur === 'cpsat'` ferait un test qui tombe pour la bonne raison —
     *    un repli parfaitement légitime.
     */
    expect(solution.rapport.moteurDemande).toBe(MOTEURS.CPSAT);
  });

  it('n’ajoute RIEN à la charge quand on ne demande rien', async () => {
    /*
     * ⚠️ LE GARDE DE NON-RÉGRESSION DE CETTE ÉTAPE. Sans option, la charge doit
     *    être mot pour mot celle d'avant le pont : Python applique son propre
     *    défaut, et `non_demande` en est la preuve rendue par le solveur
     *    lui-même — pas par une relecture du code de Node.
     */
    const { probleme } = construire([tache('T1', { seancesRequises: 99 })]);
    const solution = await resoudre(probleme);

    expect(solution.rapport.moteur).toBe(MOTEURS.GLOUTON);
    expect(solution.rapport.repli).toBe(REPLIS_MOTEUR.NON_DEMANDE);
  });

  it('NE LANCE PAS de recherche quand le glouton a tout placé', async () => {
    /*
     * ⚠️ CE N'EST PAS UNE OPTIMISATION, C'EST UNE CORRECTION DE SENS : une
     *    semaine complète est optimale par définition. Sur l'année réelle, 17
     *    des 37 semaines sont dans ce cas — les y lancer coûterait six minutes
     *    par an pour ne rien trouver.
     */
    const { probleme } = construire([tache('T1')]);
    const solution = await resoudre(probleme, {
      moteur: MOTEURS.CPSAT,
      budgetMs: BUDGET_TEST,
    });

    expect(solution.nonPlacees).toEqual([]);
    expect(solution.rapport.repli).toBe(REPLIS_MOTEUR.RIEN_A_GAGNER);
  });

  it('REFUSE un moteur inconnu, en 400 — il ne se replie pas en silence', async () => {
    /*
     * ⚠️ LE DÉFAUT QUE CE TEST INTERDIT : un repli muet ferait passer une faute
     *    de frappe côté Node pour une génération normale, et le rapport
     *    annoncerait « glouton » à un directeur qui a demandé — et attendu —
     *    une recherche complète.
     */
    const { probleme } = construire([tache('T1')]);

    await expect(resoudre(probleme, { moteur: 'cp_sat' })).rejects.toMatchObject({
      status: 400,
      code: 'PROBLEME_INVALIDE',
    });
  });
});

/**
 * ═══ LA CAUSE EXACTE, DE NODE À PYTHON ET RETOUR (2026-09-22) ═══
 *
 * ⚠️ CE QUI EST VÉRIFIÉ ICI EST QUE L'ORIGINE SURVIT AU VOYAGE. `probleme.js`
 *    a toujours SU pourquoi il fermait un créneau ; il n'en envoyait que le
 *    numéro, et Python ne pouvait répondre que `creneau_interdit` — la cause
 *    n°1 mesurée sur l'année réelle (163 séances sur 341), et celle qui envoie
 *    chercher dans quatre directions à la fois.
 */
decrire('cause exacte du non-placement', () => {
  it('dit STAGE là où il disait « créneau interdit »', async () => {
    /*
     * ⚠️ LE GROUPE EST EN STAGE TOUTE LA SEMAINE, et c'est délibéré : la cause
     *    rendue est la DOMINANTE. Ne fermer qu'un jour laisserait le formateur
     *    remplir les deux autres, et `formateur_occupe` l'emporterait — à
     *    juste titre, mais on ne testerait plus ce qu'on croit tester.
     */
    const semaine = semaineOuverte();
    for (const jour of semaine.jours) jour.stages = [{ groupe: 'GM101' }];

    const { probleme } = construire([tache('T1')], { semaine });
    const solution = await resoudre(probleme);

    expect(solution.placements).toEqual([]);
    expect(solution.nonPlacees[0].cause).toBe(MOTIFS_INTERDICTION.STAGE);
  });

  it('nomme la RENTRÉE plutôt que le stage quand les deux ferment le jour', async () => {
    /*
     * ⚠️ LE PLUS STRUCTUREL GAGNE, et ce test fige ce choix. Sans lui, le
     *    diagnostic dépendrait de l'ordre des tests dans `probleme.js` : on
     *    enverrait corriger les dates d'un stage alors que le groupe n'a même
     *    pas commencé son année.
     */
    const semaine = semaineOuverte();
    for (const jour of semaine.jours) {
      jour.stages = [{ groupe: 'GM101' }];
      jour.rentreesGelees = [{ anneeFormation: 1 }];
    }

    const { probleme } = construire([tache('T1')], { semaine });
    const solution = await resoudre(probleme);

    expect(solution.nonPlacees[0].cause).toBe(MOTIFS_INTERDICTION.RENTREE);
  });

  it('REFUSE un motif qui désigne un créneau non interdit', async () => {
    /*
     * ⚠️ LA DÉSYNCHRONISATION SILENCIEUSE QUE CE GARDE INTERDIT : un motif
     *    portant sur un créneau libre ferait rapporter une cause pour un
     *    créneau où la séance aurait parfaitement pu aller. Le directeur
     *    corrigerait un stage qui n'a jamais rien bloqué.
     */
    const { probleme } = construire([tache('T1')]);
    probleme.taches[0].motifsInterdiction = { stage: [0] };
    probleme.taches[0].creneauxInterdits = [];

    await expect(resoudre(probleme)).rejects.toMatchObject({
      status: 400,
      code: 'PROBLEME_INVALIDE',
    });
  });
});

describe('délai d’attente du sous-processus', () => {
  it('reste celui du glouton quand aucun budget n’est demandé', () => {
    expect(delaiPour(undefined)).toBe(env.GENERATEUR_TIMEOUT_MS);
  });

  it('SUIT le budget au lieu de le plafonner', () => {
    /*
     * ═══ ⚠️ LE DÉFAUT QUE CE TEST EXISTE POUR INTERDIRE ═══
     * Avant le 2026-09-22, budget et délai étaient deux réglages indépendants :
     * porter le budget à 30 s sous un délai de 30 s aurait fait TUER le solveur
     * en pleine recherche, et le message aurait dit « le solveur n'a pas
     * répondu ». On aurait cherché la panne du côté de Python.
     */
    const budget = env.GENERATEUR_TIMEOUT_MS * 2;
    expect(delaiPour(budget)).toBeGreaterThan(budget);
  });

  it('ne descend jamais sous le délai du glouton', () => {
    // Un budget minuscule ne doit pas raccourcir l'attente : le démarrage de
    // l'interpréteur coûte déjà ~200 ms, indépendamment de la recherche.
    expect(delaiPour(1)).toBe(env.GENERATEUR_TIMEOUT_MS);
  });
});

describe('ce que le service demande au solveur', () => {
  it('n’envoie AUCUN budget au glouton', () => {
    /*
     * ═══ ⚠️ CE TEST EXISTE PARCE QU'UNE MUTATION A MONTRÉ QU'IL MANQUAIT ═══
     * Le 2026-09-22, envoyer le budget CP-SAT au glouton ne faisait tomber
     * aucun des 81 tests de la suite. Le défaut aurait été silencieux et
     * durable : le glouton résout en 30 ms et ignore le budget, mais le délai
     * d'attente suivant désormais celui-ci, une génération BLOQUÉE aurait mis
     * une demi-minute à le dire au lieu d'une seconde.
     */
    expect(optionsSolveur(MOTEURS.GLOUTON)).toEqual({});
    expect(optionsSolveur(undefined)).toEqual({});
  });

  it('envoie le moteur ET le budget mesuré quand CP-SAT est demandé', () => {
    /*
     * ⚠️ LE BUDGET N'EST PAS FACULTATIF POUR CP-SAT : à 5 s — la valeur retenue
     *    d'abord — il ne rend RIEN sur l'année réelle, `UNKNOWN` sur les 37
     *    semaines. L'oublier reviendrait à laisser le solveur tourner sur le
     *    défaut de Python sans que Node sache lequel.
     */
    expect(optionsSolveur(MOTEURS.CPSAT)).toEqual({
      moteur: MOTEURS.CPSAT,
      budgetMs: env.GENERATEUR_BUDGET_CPSAT_MS,
    });
  });
});

decrire('les consignes tenues ou non, séance par séance', () => {
  it('MARQUE la séance posée sur un créneau que le formateur évitait', async () => {
    /*
     * ═══ ⚠️ SANS CE DRAPEAU, PERSONNE NE LE SAIT ═══ (2026-09-22)
     * Depuis que ces créneaux sont des consignes et non des interdictions, le
     * solveur s'y résout plutôt que de laisser une séance non placée — 164 fois
     * sur l'année réelle. Le formateur découvrirait son cours là où il avait
     * demandé à ne pas en avoir, sans explication, et croirait à un défaut.
     *
     * Ici TOUS les créneaux sont déconseillés : la séance est donc posée, et
     * elle doit l'être en le disant.
     */
    const { probleme } = construire([tache('T1')]);
    probleme.taches[0].creneauxAEviter = probleme.creneaux.map((creneau) => creneau.id);

    const solution = await resoudre(probleme);

    expect(solution.placements).not.toEqual([]);
    expect(solution.placements.every((p) => p.deconseille)).toBe(true);
  });

  it('ne le marque PAS quand la consigne a pu être tenue', async () => {
    // ⚠️ L'autre moitié : un drapeau toujours vrai ne dirait rien non plus.
    const { probleme } = construire([tache('T1')]);

    const solution = await resoudre(probleme);

    expect(solution.placements).not.toEqual([]);
    expect(solution.placements.some((p) => p.deconseille)).toBe(false);
  });
});
