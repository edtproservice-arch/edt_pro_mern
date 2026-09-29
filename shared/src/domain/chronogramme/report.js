import { separerFusion } from '../carte/reconstruction.js';
import { dureeSeance } from '../emploi/grille.js';
import { typeDeSeance } from '../emploi/conflits.js';
import { TYPES_COURS } from '../../constants/index.js';

/**
 * Reporte dans le chronogramme les séances DÉJÀ POSÉES dans l'emploi du temps.
 * ← `api/profile/reporter_emploi_vers_chronogramme.php` (264 l.)
 *
 * ═══ POURQUOI CE SENS-LÀ, ALORS QUE TOUT LE RESTE VA DANS L'AUTRE ═══
 * D'ordinaire le chronogramme est la source et l'emploi du temps en découle.
 * Mais on peut avoir travaillé la grille à la main — avant de planifier, ou
 * pendant une période de dissociation. Réassocier sans rien reporter laisserait
 * **deux vérités côte à côte** : des séances placées que le chronogramme
 * ignore, donc des taux d'avancement faux et un rapport de complétude qui
 * accuse un manque là où le cours a bien lieu.
 *
 * ═══ ⚠️ RIEN N'EST JAMAIS EFFACÉ ═══
 * Seules les cellules que l'emploi du temps PORTE sont touchées. Un
 * chronogramme planifié sur 45 semaines dont l'emploi ne couvre que 4 ne doit
 * pas perdre les 41 autres — et à l'intérieur d'une semaine, un module prévu
 * mais pas encore posé garde sa prévision. C'est le rapport de complétude qui
 * montre l'écart ; ce n'est pas à ce report de trancher.
 *
 * ═══ ⚠️ REMPLACER, JAMAIS AJOUTER — C'EST CE QUI REND L'OPÉRATION REJOUABLE ═══
 * La relancer deux fois donne le même résultat. Additionner doublerait les
 * heures au second passage, sans que rien ne le signale.
 *
 * ⚠️ **CETTE FONCTION N'ÉCRIT PAS.** Elle rend les plannings à écrire et le
 *    bilan ; c'est l'appelant qui décide d'écrire ou de seulement montrer. La
 *    simulation et le report parcourent ainsi exactement le même code — deux
 *    chemins auraient fini par annoncer autre chose que ce qu'ils font.
 */

/** `2026-W9` → `9`. Tolère le zéro de remplissage de la production. */
const numeroDeSemaine = (valeur) => {
  const trouve = /^\d{4}-W0*(\d+)$/.exec(String(valeur ?? '').trim());
  return trouve ? Number(trouve[1]) : null;
};

const cleGroupe = (nom) => String(nom ?? '').trim().toUpperCase();
const cleModule = (code) => String(code ?? '').trim().toUpperCase();

/** Les cellules d'un planning, quelle que soit sa forme (`Map` ou objet nu). */
function lirePlanning(planning) {
  const entrees = planning instanceof Map ? planning.entries() : Object.entries(planning ?? {});
  const copie = new Map();
  for (const [module, cellules] of entrees) {
    copie.set(cleModule(module), [...(cellules ?? [])].map((c) => ({ ...c })));
  }
  return copie;
}

/**
 * Les heures posées, par semaine / groupe / module, séparées par nature.
 *
 * ⚠️ UNE SÉANCE ABSENTE EST REPORTÉE. Elle est PLANIFIÉE — le créneau est
 *    occupé —, elle n'a simplement pas été donnée, et son rattrapage se traite
 *    ailleurs. La retirer creuserait un trou dans le chronogramme.
 *
 * ⚠️ UNE SÉANCE FUSIONNÉE COMPTE POUR CHACUN DE SES GROUPES : donnée une fois,
 *    mais le chronogramme est tenu par groupe.
 */
export function heuresPoseesParSemaine(seances = []) {
  const parSemaine = new Map();
  const noms = new Map();
  const semaines = new Set();
  let comptees = 0;

  for (const seance of seances) {
    const numero = numeroDeSemaine(seance?.semaine);
    if (numero === null) continue;
    semaines.add(numero);

    const module = cleModule(seance?.module);
    const libelle = String(seance?.groupe ?? '').trim();
    if (module === '' || libelle === '') continue;

    comptees += 1;
    /*
     * ⚠️ `dureeSeance`, JAMAIS UNE CONSTANTE PLATE : le créneau du soir dure
     *    2 h, pas 2,5. C'est déjà la règle de ce report dans l'ancien, qui
     *    qualifiait au passage `get_completude.php` de « défaut préexistant ».
     */
    const heures = dureeSeance(seance.seance);
    const nature = typeDeSeance(seance) === TYPES_COURS.SYNCHRONE ? 'S' : 'P';

    for (const groupe of separerFusion(libelle)) {
      const cg = cleGroupe(groupe);
      noms.set(cg, groupe);

      if (!parSemaine.has(numero)) parSemaine.set(numero, new Map());
      const parGroupe = parSemaine.get(numero);
      if (!parGroupe.has(cg)) parGroupe.set(cg, new Map());
      const parModule = parGroupe.get(cg);
      if (!parModule.has(module)) parModule.set(module, { P: 0, S: 0 });

      parModule.get(module)[nature] += heures;
    }
  }

  return { parSemaine, noms, semainesLues: semaines.size, seancesLues: comptees };
}

const arrondi = (h) => Math.round(h * 100) / 100;

/**
 * Le report, calculé sans rien écrire.
 *
 * @param {object} entrees
 * @param {Array}  entrees.seances        toutes les séances de l'année
 * @param {Array}  entrees.chronogrammes  lignes `{groupe, planning}`
 * @param {Map}    [entrees.masses]       `GROUPE||MODULE` → `{presentiel, synchrone}`
 *   (`fichesModules`) — la masse horaire que le report ne doit pas dépasser
 * @returns {{aEcrire: Array, bilan: object}}
 */
export function reporterVersChronogramme({ seances = [], chronogrammes = [], masses = null } = {}) {
  const { parSemaine, noms, semainesLues, seancesLues } = heuresPoseesParSemaine(seances);

  /* L'état de départ, recopié : la fonction ne modifie jamais ses entrées. */
  const plannings = new Map();
  for (const chrono of chronogrammes) {
    const cg = cleGroupe(chrono?.groupe);
    if (cg === '') continue;
    plannings.set(cg, { groupe: String(chrono.groupe).trim(), planning: lirePlanning(chrono.planning) });
  }

  const touches = new Set();
  const groupesCrees = [];
  const mixtes = [];
  const depassements = [];
  let cellulesEcrites = 0;
  let cellulesInchangees = 0;
  let heuresReportees = 0;

  /* ⚠️ Semaines dans l'ORDRE : deux exécutions doivent rendre le même bilan. */
  for (const numero of [...parSemaine.keys()].sort((a, b) => a - b)) {
    const semaine = `S${numero}`;

    for (const [cg, parModule] of [...parSemaine.get(numero).entries()].sort()) {
      if (!plannings.has(cg)) {
        /*
         * ⚠️ UN GROUPE SANS CHRONOGRAMME EN REÇOIT UN. L'ignorer ferait
         *    disparaître ses séances du report sans un mot — alors que ce sont
         *    justement celles qu'on vient chercher.
         */
        const nom = noms.get(cg) ?? cg;
        plannings.set(cg, { groupe: nom, planning: new Map() });
        groupesCrees.push(nom);
      }

      const cible = plannings.get(cg);

      for (const [module, heures] of [...parModule.entries()].sort()) {
        const total = arrondi(heures.P + heures.S);
        if (total <= 0) continue;

        /*
         * ═══ ⚠️ UNE CELLULE NE PORTE QU'UN SEUL TYPE ═══
         * Un module qui, la même semaine, a du présentiel ET du distanciel ne
         * peut pas dire les deux. On garde le VOLUME TOTAL — le perdre
         * fausserait l'avancement, qui se lit sur des heures — avec le type
         * DOMINANT, et le cas est NOMMÉ dans le bilan pour qu'il soit corrigé
         * à la main plutôt que découvert plus tard.
         */
        const type = heures.S > heures.P ? 'S' : 'P';
        if (heures.P > 0 && heures.S > 0) {
          mixtes.push({
            groupe: cible.groupe,
            module,
            semaine,
            presentiel: arrondi(heures.P),
            distanciel: arrondi(heures.S),
            retenu: type,
          });
        }

        if (!cible.planning.has(module)) cible.planning.set(module, []);
        const cellules = cible.planning.get(module);
        const rang = cellules.findIndex((c) => c?.semaine === semaine);
        const avant = rang >= 0 ? cellules[rang] : null;

        if (avant && arrondi(Number(avant.heures) || 0) === total && avant.type === type) {
          cellulesInchangees += 1;
          continue;
        }

        /*
         * ═══ ⚠️ LA MASSE HORAIRE N'EST JAMAIS DÉPASSÉE ═══ (2026-09-27,
         * demande du porteur ; choix « reporter jusqu'à la masse »)
         * Le report n'efface rien ailleurs : les heures déjà planifiées sur les
         * AUTRES semaines restent, et c'est leur somme avec les heures posées
         * qui pouvait passer la masse affectée au module. La cellule qui la
         * ferait dépasser n'est PAS reportée — la précédente reste en place —,
         * et elle est NOMMÉE : ses séances ressortent alors en écart dans la
         * fenêtre de conformité, d'où elles se suppriment.
         *
         * ⚠️ SEMAINES DANS L'ORDRE : les premières sont reportées d'abord, ce
         *    sont celles qui ont déjà eu lieu.
         * ⚠️ PAR TYPE, comme la saisie (`verifierCellule`) : une heure à
         *    distance ne consomme pas la masse présentielle.
         * ⚠️ MASSE NULLE OU INCONNUE = PAS DE CONTRÔLE, comme à la saisie : un
         *    groupe sans affectation n'a pas de masse à respecter.
         */
        const fiche = masses?.get(`${cg}||${module}`);
        const masse = arrondi(
          type === 'S' ? (fiche?.[TYPES_COURS.SYNCHRONE] ?? 0) : (fiche?.[TYPES_COURS.PRESENTIEL] ?? 0)
        );
        if (masse > 0) {
          const ailleurs = arrondi(
            cellules
              .filter((c) => c?.semaine !== semaine && (c?.type === 'S' ? 'S' : 'P') === type)
              .reduce((somme, c) => somme + (Number(c?.heures) || 0), 0)
          );
          if (arrondi(ailleurs + total) > masse) {
            depassements.push({
              groupe: cible.groupe,
              module,
              semaine,
              type,
              heures: total,
              dejaPlanifie: ailleurs,
              masse,
            });
            continue;
          }
        }

        const cellule = { semaine, heures: total, type };
        if (rang >= 0) cellules[rang] = cellule;
        else cellules.push(cellule);

        cellulesEcrites += 1;
        heuresReportees += total;
        touches.add(cg);
      }
    }
  }

  /*
   * ⚠️ ON NE REND QUE LES GROUPES RÉELLEMENT TOUCHÉS. Réécrire les autres à
   *    l'identique ne ferait que remuer leur horodatage — et, ici, avancer
   *    leur `version`, ce qui ferait échouer l'enregistrement d'un collègue
   *    dont l'écran tenait la précédente.
   */
  const aEcrire = [...touches].sort().map((cg) => plannings.get(cg));

  return {
    aEcrire,
    bilan: {
      semainesLues,
      seancesLues,
      cellulesEcrites,
      cellulesInchangees,
      heures: arrondi(heuresReportees),
      groupes: aEcrire.map((p) => p.groupe),
      // ⚠️ Un groupe dont TOUTES les cellules dépassaient n'est pas créé.
      groupesCrees: [...new Set(groupesCrees)].filter((nom) => touches.has(cleGroupe(nom))).sort(),
      mixtes,
      /** Cellules NON reportées : elles auraient fait dépasser la masse horaire. */
      depassements,
    },
  };
}
