import { cleEnsemble, construireEnsembles, estActif, semestreModule } from './bilanCharge.js';

/**
 * La carte d'affectations vue PAR FORMATEUR.
 * (2026-09-06, demande du porteur : « en affectation chez le directeur je veux
 * qu'il soit en vue Filières, groupes (déjà existe) et vue formateur ».)
 *
 * ═══ ⚠️ LA MÊME CARTE, PRISE PAR L'AUTRE BOUT ═══
 * La matrice existante répond à « qui enseigne ce module à ce groupe ? ». Un
 * directeur qui répartit la charge pose l'autre moitié de la question : « que
 * porte cette personne, et que puis-je encore lui confier ? ». Les deux vues
 * lisent et écrivent LA MÊME structure `groupes[]` — il n'y a pas deux états à
 * tenir en phase, seulement deux lectures.
 *
 * ═══ ⚠️⚠️ LE SYNCHRONE MUTUALISÉ NE FAIT QU'UNE LIGNE ═══ (choix du porteur.)
 * Une séance donnée à plusieurs groupes à la fois pèse UNE FOIS sur son
 * formateur. L'éclater par groupe gonflerait le total de sa fiche au-dessus de
 * sa charge réelle — l'écart exact qui a dû être corrigé sur « Suivi de
 * l'avancement » le même jour. On regroupe donc par ENSEMBLE DE GROUPES, avec
 * la même empreinte que `calculerCharges` : le total d'une fiche est alors
 * exactement la charge que le bilan lui attribue.
 */

function cle(valeur) {
  return String(valeur ?? '')
    .trim()
    .toUpperCase();
}

function heures(valeur) {
  const nombre = Number.parseFloat(valeur);
  return Number.isFinite(nombre) ? Math.round(nombre * 100) / 100 : 0;
}

/**
 * Les groupes que couvre une séance synchrone.
 *
 * ⚠️ `groupeFusion` VIDE NE VEUT PAS DIRE « INCONNU » mais « fusionné avec
 * personne » : c'est ce qu'écrit la projection pour une séance à un seul
 * groupe. On retombe alors sur le nom du groupe, qui EST l'identité de cette
 * séance — la règle déjà tenue par `empreinteSeance`.
 */
function groupesDeLaSeance(groupe, module) {
  const fusion = String(module.groupeFusion ?? '').trim();
  return fusion === '' ? [groupe.nom] : fusion.split(/\s+/).filter(Boolean);
}

/**
 * Les affectations d'un formateur, prêtes à afficher.
 *
 * @param {Array} groupes  les groupes de la carte, SYNCHRONES DÉJÀ PROJETÉS
 *   (`projeterSynchrones`) — sinon les séances proposées par défaut, que le
 *   directeur n'a pas encore touchées, n'apparaîtraient pas dans sa fiche alors
 *   qu'elles comptent déjà dans sa charge.
 * @param {string} nom  le formateur, comparé sans casse
 * @returns {Array<{cle, ensemble, module, intitule, type, groupes, s1, s2, total, estRegional}>}
 */
export function affectationsDuFormateur(groupes = [], nom) {
  const cherche = cle(nom);
  if (cherche === '') return [];

  const lignes = [];
  const seancesVues = new Set();

  for (const ensemble of construireEnsembles(groupes)) {
    for (const groupe of ensemble.groupes) {
      for (const module of groupe.modules ?? []) {
        if (!estActif(module)) continue;

        if (cle(module.formateurPresentiel) === cherche) {
          lignes.push({
            cle: `${groupe.nom}||${module.code}||presentiel`,
            ensemble: ensemble.cle,
            groupe: groupe.nom,
            module: module.code,
            intitule: module.nom ?? '',
            type: 'presentiel',
            groupes: [groupe.nom],
            s1: heures(module.mhpS1 ?? 0),
            s2: heures(module.mhpS2 ?? 0),
            total: heures((module.mhpS1 ?? 0) + (module.mhpS2 ?? 0)),
            estRegional: Boolean(module.estRegional),
            semestre: semestreModule(module),
          });
        }

        if (cle(module.formateurSynchrone) === cherche) {
          /*
           * ⚠️ MÊME EMPREINTE QUE `calculerCharges` : ensemble + module +
           * formateur + fusion. Deux lignes du même ensemble sont deux
           * écritures de LA MÊME heure de cours.
           */
          const fusion = String(module.groupeFusion ?? '').trim() || groupe.nom;
          const empreinte = `${ensemble.cle}||${module.code}||${cherche}||${fusion}`;
          if (seancesVues.has(empreinte)) continue;
          seancesVues.add(empreinte);

          lignes.push({
            cle: `${fusion}||${module.code}||synchrone`,
            ensemble: ensemble.cle,
            groupe: groupe.nom,
            module: module.code,
            intitule: module.nom ?? '',
            type: 'synchrone',
            groupes: groupesDeLaSeance(groupe, module),
            s1: heures(module.mhsynS1 ?? 0),
            s2: heures(module.mhsynS2 ?? 0),
            total: heures((module.mhsynS1 ?? 0) + (module.mhsynS2 ?? 0)),
            estRegional: Boolean(module.estRegional),
            /*
             * ═══ ⚠️ `semestreModule`, LA FONCTION DE LA MATRICE — jamais un
             * calcul sur les seules heures de CETTE ligne ═══ Une ligne ne porte
             * qu'une NATURE (présentiel ou synchrone) ; un module dont le
             * présentiel est en S1 et le synchrone en S2 est ANNUEL, et le
             * juger nature par nature l'afficherait « Semestre 1 » ici et
             * « Module annuel » dans la matrice. Le même module ne peut pas
             * porter deux badges selon la vue — c'est le §4.2 appliqué à un
             * badge d'une lettre, exactement ce qui avait fait extraire
             * `BadgeSemestre` de ses trois copies.
             */
            semestre: semestreModule(module),
          });
        }
      }
    }
  }

  return lignes.sort(
    (a, b) =>
      a.groupes[0].localeCompare(b.groupes[0], 'fr', { numeric: true }) ||
      a.module.localeCompare(b.module, 'fr', { numeric: true })
  );
}

/**
 * Ce que porte chaque ensemble de la carte : ce qui est libre, ce qui est déjà
 * à lui, et ce qu'un autre tient.
 *
 * ═══ ⚠️ « LIBRE » SE JUGE PAR NATURE D'HEURES ═══ Un module dont le présentiel
 * est pris peut très bien attendre son synchrone, et inversement : ce sont deux
 * affectations distinctes. Une seule notion d'« occupé » aurait masqué la
 * moitié des places disponibles.
 *
 * ═══ ⚠️⚠️ ON REND TOUTES LES FILIÈRES, PAS SEULEMENT CELLES QUI ONT DE LA PLACE
 * ═══ (2026-09-06, demande du porteur : « il faut qu'il s'affiche toutes les
 * filières de la carte ».) La version d'origine écartait un ensemble dès que
 * tout y était pourvu : la liste déroulante en montrait alors une poignée sur
 * dix, et rien ne disait où étaient passées les autres — on cherche le défaut
 * dans le sélecteur plutôt que dans la carte. C'est la règle « FIGÉ, PAS
 * MASQUÉ » déjà tenue par les listes de la grille d'emploi du temps : ce qui
 * est pris reste VISIBLE et NOMME son titulaire, ce qui dit à la fois que la
 * place existe et pourquoi elle n'est pas prenable.
 *
 * ⚠️ CE QUI RESTE ÉCARTÉ, ET POURQUOI CE N'EST PAS LA MÊME CHOSE : un module
 * DÉSACTIVÉ, et un module à 0 h dans les deux natures. Ni l'un ni l'autre ne
 * peut porter d'affectation — les proposer mènerait à un cul-de-sac, ce que le
 * porteur ne demande pas. Un ensemble dont plus aucun module n'est affectable
 * disparaît donc, lui, pour la même raison.
 *
 * @param {Array} groupes  synchrones projetés, comme ci-dessus
 * @param {string} nom     pour ne pas présenter comme « pris » ce qui est à lui
 * @returns {Array<{cle, modules: Array<{code, intitule, presentiel, synchrone}>}>}
 *   où chaque nature porte `{heures, libres[], miens[], pris[{groupe, formateur}]}`
 */
export function placesDisponibles(groupes = [], nom) {
  const cherche = cle(nom);

  return construireEnsembles(groupes)
    .map((ensemble) => {
      const parModule = new Map();

      for (const groupe of ensemble.groupes) {
        for (const module of groupe.modules ?? []) {
          if (!estActif(module)) continue;

          if (!parModule.has(module.code)) {
            parModule.set(module.code, {
              code: module.code,
              intitule: module.nom ?? '',
              estRegional: Boolean(module.estRegional),
              presentiel: { heures: 0, libres: [], miens: [], pris: [] },
              synchrone: { heures: 0, libres: [], miens: [], pris: [] },
            });
          }
          const fiche = parModule.get(module.code);

          /*
           * ⚠️ TROIS SORTS, PAS DEUX : libre, à lui, ou À QUELQU'UN D'AUTRE —
           * et ce dernier porte le NOM de son titulaire. Sans lui, une place
           * prise serait indiscernable d'une place inexistante, et on irait
           * chercher le module manquant dans la matrice.
           */
          const classer = (nature, titulaireBrut) => {
            const titulaire = cle(titulaireBrut);
            if (titulaire === '') nature.libres.push(groupe.nom);
            else if (titulaire === cherche) nature.miens.push(groupe.nom);
            else nature.pris.push({ groupe: groupe.nom, formateur: titulaireBrut });
          };

          const hp = heures((module.mhpS1 ?? 0) + (module.mhpS2 ?? 0));
          if (hp > 0) {
            fiche.presentiel.heures = hp;
            classer(fiche.presentiel, module.formateurPresentiel);
          }

          const hs = heures((module.mhsynS1 ?? 0) + (module.mhsynS2 ?? 0));
          if (hs > 0) {
            fiche.synchrone.heures = hs;
            classer(fiche.synchrone, module.formateurSynchrone);
          }
        }
      }

      return {
        cle: ensemble.cle,
        /* Les MÊMES champs que l'en-tête de la matrice : les deux vues doivent
           nommer un ensemble de la même façon. */
        intituleFiliere: ensemble.intituleFiliere,
        codeFiliere: ensemble.codeFiliere,
        anneeFormation: ensemble.anneeFormation,
        mode: ensemble.mode,
        groupes: ensemble.groupes.map((groupe) => groupe.nom),
        /* Un module qui ne porte AUCUNE heure ne peut recevoir aucune
           affectation, quelle que soit la nature : le proposer serait un
           cul-de-sac. C'est le seul motif d'exclusion restant. */
        modules: [...parModule.values()].filter(
          (fiche) => fiche.presentiel.heures > 0 || fiche.synchrone.heures > 0
        ),
      };
    })
    .filter((ensemble) => ensemble.modules.length > 0);
}

export { cleEnsemble };
