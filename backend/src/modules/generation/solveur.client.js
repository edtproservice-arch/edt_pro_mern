/**
 * Appel du solveur Python.
 *
 * ⚠️ EN SOUS-PROCESSUS, PAS EN HTTP — pour l'instant. Le solveur résout une
 *    semaine en ~27 ms ; le démarrage de l'interpréteur en coûte ~200. Sur une
 *    génération, c'est invisible, et cela n'ajoute RIEN à héberger : pas de
 *    port, pas de service à superviser, pas de second processus qui peut tomber
 *    sans qu'on le sache. `generateur/api.py` existe pour le jour où un modèle
 *    entraîné devra rester chargé en mémoire entre deux appels — bascule qui ne
 *    touchera que ce fichier.
 *
 * ⚠️ LE SOLVEUR N'EST PAS UNE FRONTIÈRE DE CONFIANCE, mais il reste un
 *    processus séparé : sa sortie est analysée, ses codes de retour sont
 *    distingués, et un blocage est borné dans le temps. Ce que Node ne contrôle
 *    pas, il ne le suppose pas.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOTEURS } from 'shared/constants';

import { env } from '../../config/env.js';
import { badRequest, HttpError } from '../../lib/httpError.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** backend/src/modules/generation → racine du monorepo → ai/ */
const DOSSIER_AI = path.resolve(ICI, '..', '..', '..', '..', 'ai');

/**
 * Codes de sortie de `python -m generateur`.
 * Ils ne demandent pas la même réaction : un refus est un défaut de
 * CONSTRUCTION du problème, côté Node ; une erreur interne est un défaut du
 * solveur.
 */
const SORTIE = { SUCCES: 0, PROBLEME_REFUSE: 1, ERREUR_INTERNE: 2 };

/**
 * Ce qu'on laisse au solveur EN PLUS de son budget avant de le tuer.
 *
 * ⚠️ MESURÉ : une semaine à 20 s de budget coûte 21-22 s bout en bout — soit
 *    ~2 s de démarrage d'interpréteur, de lecture du problème (35 544 variables
 *    booléennes à construire) et d'écriture de la solution. 10 s couvrent
 *    largement ce surcoût sur une machine chargée.
 *
 * ⚠️ CETTE MARGE EXISTE POUR QUE LE BUDGET NE PUISSE PLUS PASSER SOUS LE DÉLAI
 *    SANS QU'ON LE VOIE. Avant, les deux valeurs étaient indépendantes : porter
 *    le budget à 30 s sous un délai de 30 s aurait fait tuer le solveur en
 *    pleine recherche, et le message aurait dit « le solveur n'a pas répondu ».
 *    On aurait cherché la panne du côté de Python.
 */
const MARGE_MS = 10_000;

/**
 * Le délai au bout duquel on tue le solveur, pour un budget donné.
 *
 * ⚠️ EXPORTÉE POUR ÊTRE TESTÉE, et c'est la raison d'être de cette fonction :
 *    la seule autre façon de vérifier que le délai suit le budget serait
 *    d'attendre qu'il expire — donc de faire durer la suite aussi longtemps que
 *    le budget qu'on veut éprouver. Un test qu'on n'écrira jamais.
 *
 * @param {number} [budgetMs] — absent pour le glouton, qui n'en lit aucun
 */
export function delaiPour(budgetMs) {
  if (budgetMs === undefined) return env.GENERATEUR_TIMEOUT_MS;
  return Math.max(env.GENERATEUR_TIMEOUT_MS, budgetMs + MARGE_MS);
}

/**
 * Ce qu'on demande au solveur, pour un moteur donné.
 *
 * ═══ ⚠️ LE BUDGET N'EST ENVOYÉ QU'AVEC CP-SAT ═══
 * Le glouton ne le lit pas, et l'envoyer quand même ferait monter le délai
 * d'attente à 30 s pour une résolution de 30 ms : une génération BLOQUÉE
 * mettrait alors une demi-minute à le dire, au lieu d'une seconde. Sans moteur
 * demandé, la charge est mot pour mot celle d'avant l'étape (e) — c'est ce qui
 * rend cette bascule sans risque pour l'existant.
 *
 * ⚠️ UNE FONCTION PLUTÔT QU'UN TERNAIRE DANS LE SERVICE, POUR ÊTRE TESTÉE :
 *    `genererSemaine` écrit en base, et l'éprouver demanderait Mongo et une
 *    transaction pour vérifier DEUX clés d'un objet. Une mutation l'a montré le
 *    2026-09-22 — envoyer le budget au glouton ne faisait tomber aucun des 81
 *    tests de la suite.
 */
export function optionsSolveur(moteur) {
  if (moteur !== MOTEURS.CPSAT) return {};
  return { moteur: MOTEURS.CPSAT, budgetMs: env.GENERATEUR_BUDGET_CPSAT_MS };
}

function erreurSolveur(message, details) {
  return new HttpError(502, message, { code: 'SOLVEUR_INDISPONIBLE', details });
}

/**
 * @param {object} probleme — le contrat, tel que `construireProbleme` le rend
 * @param {object} [options]
 * @param {string} [options.moteur] — `MOTEURS.GLOUTON` ou `MOTEURS.CPSAT`
 * @param {number} [options.budgetMs] — temps de recherche laissé à CP-SAT
 * @returns {Promise<{placements: Array, nonPlacees: Array, rapport: object}>}
 */
export function resoudre(probleme, { moteur, budgetMs } = {}) {
  /*
   * ═══ ⚠️ LE MOTEUR N'EST PAS UNE CONTRAINTE, IL NE SORT DONC PAS DE
   *     `construireProbleme` ═══
   * Celui-ci décrit CE QU'IL FAUT RÉSOUDRE — créneaux, tâches, interdictions.
   * Le moteur et le budget disent COMMENT le résoudre : ils n'ont aucune
   * influence sur la grille attendue, seulement sur l'effort consenti pour
   * l'approcher. Les mêler au problème rendrait deux générations d'un même
   * chronogramme « différentes » aux yeux de la trace, alors qu'elles posent la
   * même question.
   *
   * ⚠️ ON N'AJOUTE QUE CE QUI A ÉTÉ DEMANDÉ. Sans option, la charge est
   *    exactement celle d'avant le 2026-09-22, et Python applique ses propres
   *    défauts (glouton). Un appelant qui ne sait rien du CP-SAT ne voit aucun
   *    changement — c'est ce qui rend cette bascule sans risque pour les six
   *    tests de contrat existants.
   */
  const demande = { ...probleme };
  if (moteur !== undefined) demande.moteur = moteur;
  if (budgetMs !== undefined) demande.budgetMs = budgetMs;

  /*
   * ⚠️ LE DÉLAI SUIT LE BUDGET, il ne le plafonne pas — voir `MARGE_MS`.
   *    `GENERATEUR_TIMEOUT_MS` reste le plancher : il borne le glouton, qui ne
   *    lit aucun budget.
   */
  const delai = delaiPour(budgetMs);

  return new Promise((resolve, reject) => {
    let enfant;
    try {
      enfant = spawn(env.PYTHON_BIN, ['-m', 'generateur'], {
        cwd: DOSSIER_AI,
        // ⚠️ Sans quoi Windows ouvre les flux en cp1252 : un nom de groupe
        //    accentué ferait échouer l'échange, et seulement pour certains
        //    établissements.
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
    } catch (cause) {
      reject(erreurSolveur(`Impossible de lancer « ${env.PYTHON_BIN} »`, [{ message: cause.message }]));
      return;
    }

    let sortie = '';
    let erreurs = '';
    let termine = false;

    const minuteur = setTimeout(() => {
      termine = true;
      enfant.kill('SIGKILL');
      reject(
        erreurSolveur(`Le solveur n'a pas répondu en ${delai} ms`, [
          { message: 'délai dépassé' },
        ])
      );
    }, delai);

    enfant.stdout.setEncoding('utf-8');
    enfant.stderr.setEncoding('utf-8');
    enfant.stdout.on('data', (morceau) => {
      sortie += morceau;
    });
    enfant.stderr.on('data', (morceau) => {
      erreurs += morceau;
    });

    enfant.on('error', (cause) => {
      if (termine) return;
      termine = true;
      clearTimeout(minuteur);
      // ENOENT : Python n'est pas installé, ou pas sous ce nom. C'est la panne
      // la plus probable sur un poste neuf — elle doit se lire telle quelle.
      const message =
        cause.code === 'ENOENT'
          ? `Python introuvable (« ${env.PYTHON_BIN} »). Installez-le, ou renseignez PYTHON_BIN.`
          : cause.message;
      reject(erreurSolveur(message));
    });

    enfant.on('close', (code) => {
      if (termine) return;
      clearTimeout(minuteur);

      let charge;
      try {
        charge = JSON.parse(sortie);
      } catch {
        /*
         * ⚠️ STDOUT NE DOIT PORTER QUE DU JSON. Si l'analyse échoue, c'est
         *    presque toujours qu'une trace s'y est glissée — un `print` de
         *    débogage dans le solveur. On rend les deux flux, sinon la cause
         *    reste invisible.
         */
        reject(
          erreurSolveur('Réponse illisible du solveur', [
            { message: (erreurs || sortie).slice(0, 500) },
          ])
        );
        return;
      }

      if (code === SORTIE.PROBLEME_REFUSE) {
        /*
         * Le solveur a refusé le problème : c'est NOTRE construction qui est
         * en cause, pas lui. 400 et non 502 — et le message nomme le champ.
         */
        reject(
          badRequest('Le problème envoyé au solveur est invalide', {
            code: 'PROBLEME_INVALIDE',
            details: [{ message: charge?.message ?? 'cause inconnue' }],
          })
        );
        return;
      }

      if (code !== SORTIE.SUCCES) {
        reject(erreurSolveur('Le solveur a échoué', [{ message: charge?.message ?? `code ${code}` }]));
        return;
      }

      resolve(charge);
    });

    enfant.stdin.on('error', () => {
      // Le processus est mort avant d'avoir tout lu : `close` porte déjà la
      // cause, inutile de rejeter deux fois.
    });
    enfant.stdin.end(JSON.stringify(demande), 'utf-8');
  });
}
