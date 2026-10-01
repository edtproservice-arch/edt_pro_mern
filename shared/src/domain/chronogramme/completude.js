import { separerFusion } from '../carte/reconstruction.js';
import { dureeSeance } from '../emploi/grille.js';
import { typeDeSeance } from '../emploi/conflits.js';
import { TYPES_COURS } from '../../constants/index.js';

/**
 * Complétude de l'emploi du temps face au chronogramme.
 * ← `api/data/get_completude.php` (433 l.)
 *
 * ═══ LA QUESTION POSÉE ═══
 * Le chronogramme dit COMBIEN d'heures chaque module doit recevoir une semaine
 * donnée. L'emploi du temps dit OÙ elles sont posées. Les deux peuvent diverger
 * sans que rien ne le signale — une séance oubliée, une séance de trop, un
 * module placé une semaine qu'il ne devait pas —, et l'écart ne se découvre
 * alors qu'au calcul d'avancement, des semaines plus tard.
 *
 * ═══ ⚠️ CE MODULE NE DÉCIDE RIEN, IL MESURE ═══
 * Il ne refuse aucune saisie et ne réaligne rien. Réaligner automatiquement le
 * chronogramme sur la grille annulerait l'écart — or c'est précisément cet
 * écart que toute la section Avancement mesure.
 */

/** Deux heures sont égales à un centième près : le flottant ne l'est jamais. */
const EGAL = 0.01;

const arrondi = (h) => Math.round(h * 100) / 100;

/** `2026-W9` → `S9`, la clé du chronogramme. */
export function cleSemaineChronogramme(numero) {
  return `S${Number(numero)}`;
}

/**
 * Taux de conformité au chronogramme.
 *
 * ═══ ⚠️ LES DEUX SENS COMPTENT ═══
 * Le taux de l'ancien valait d'abord `couvert / prévu`, et un DÉPASSEMENT ne
 * pouvait donc jamais le faire bouger : une semaine affichait « 100 % » avec
 * 2,5 h hors plan. Une séance de trop n'est pourtant pas plus conforme qu'une
 * séance manquante — elle consomme des heures que le module n'a pas.
 *
 *     taux = 1 − (manquant + en_trop) / prévu
 *
 * ⚠️ `null` QUAND RIEN N'EST PRÉVU, jamais 0 : sans référence, afficher 0 %
 *    ferait passer pour un retard ce qui n'est qu'une absence de plan.
 */
export function tauxConformite(prevu, couvert, pose) {
  if (prevu <= 0) return null;
  const ecart = prevu - couvert + (pose - couvert);
  return Math.max(0, Math.round((1 - ecart / prevu) * 100));
}

/** Clé d'une ligne de comparaison : un module, dans une nature donnée. */
const cle = (groupe, module, type) =>
  `${String(groupe).trim().toUpperCase()}||${String(module).trim().toUpperCase()}||${type}`;

/**
 * Ce que le chronogramme PRÉVOIT pour une semaine.
 *
 * @param {Array<{groupe: string, planning: Map|object}>} chronogrammes
 * @param {string} semaineChrono  « S9 »
 */
export function prevuDeLaSemaine(chronogrammes = [], semaineChrono) {
  const prevu = new Map();
  const noms = new Map();

  for (const chrono of chronogrammes) {
    const groupe = String(chrono?.groupe ?? '').trim();
    if (groupe === '') continue;
    noms.set(groupe.toUpperCase(), groupe);

    const planning = chrono?.planning;
    const entrees = planning instanceof Map ? planning.entries() : Object.entries(planning ?? {});

    for (const [module, cellules] of entrees) {
      for (const cellule of cellules ?? []) {
        if (cellule?.semaine !== semaineChrono) continue;
        const heures = Number(cellule.heures) || 0;
        if (heures <= 0) continue;

        /*
         * ⚠️ LE TYPE FAIT PARTIE DE LA CLÉ, il n'est pas un simple libellé
         *    (divergence assumée avec l'ancien, voir l'en-tête de `completude`).
         */
        const type = cellule.type === 'S' ? TYPES_COURS.SYNCHRONE : TYPES_COURS.PRESENTIEL;
        const k = cle(groupe, module, type);
        prevu.set(k, (prevu.get(k) ?? 0) + heures);
      }
    }
  }

  return { prevu, noms };
}

/**
 * Ce que la grille PORTE réellement.
 *
 * ⚠️ UNE SÉANCE ABSENTE RESTE POSÉE. Le formateur marqué absent occupe bien le
 *    créneau : la séance EST placée, elle n'a simplement pas été donnée, et son
 *    rattrapage se traite ailleurs. La retirer ferait apparaître un manque là
 *    où rien ne manque.
 *
 * ⚠️ UNE SÉANCE FUSIONNÉE COMPTE POUR CHAQUE GROUPE. « GM101 GM102 » est donnée
 *    une fois mais couvre les deux, et le chronogramme est tenu par groupe.
 */
export function poseDeLaSemaine(seances = []) {
  const pose = new Map();
  const absences = new Map();
  const porteurs = new Map();
  const positions = new Map();
  const noms = new Map();
  let comptees = 0;

  for (const seance of seances) {
    const module = String(seance?.module ?? '').trim();
    const libelle = String(seance?.groupe ?? '').trim();
    if (module === '' || libelle === '') continue;

    comptees += 1;
    const type = typeDeSeance(seance);
    /*
     * ⚠️ `dureeSeance`, JAMAIS UNE CONSTANTE PLATE. L'ancien `get_completude.php`
     *    comptait 2,5 h partout, S5 compris — son propre voisin
     *    `reporter_emploi_vers_chronogramme.php` qualifie cela de « défaut
     *    préexistant ». Le soir dure 2 h.
     */
    const heures = dureeSeance(seance.seance);
    const absent = seance?.statut === 'absent';

    for (const groupe of separerFusion(libelle)) {
      noms.set(groupe.toUpperCase(), groupe);
      const k = cle(groupe, module, type);
      pose.set(k, (pose.get(k) ?? 0) + heures);
      if (absent) absences.set(k, (absences.get(k) ?? 0) + heures);

      /*
       * Qui porte réellement cette séance ? Pour un écart « en trop », c'est
       * chez LUI qu'il faut aller la retirer — pas chez le formateur affecté,
       * qui peut être un autre.
       */
      if (!porteurs.has(k)) porteurs.set(k, new Set());
      porteurs.get(k).add(String(seance?.formateurMatricule ?? '').trim());

      /*
       * OÙ elle est posée (2026-09-27) : une séance hors chronogramme ou en
       * trop se SUPPRIME, et l'écran mène à sa case. Le libellé porté par la
       * grille (fusionné le cas échéant) est gardé : c'est lui que la case
       * affiche en vue par groupe.
       */
      if (!positions.has(k)) positions.set(k, []);
      positions.get(k).push({
        jour: seance?.jour ?? null,
        seance: seance?.seance ?? null,
        periode: seance?.periode ?? 'jour',
        formateurMatricule: String(seance?.formateurMatricule ?? '').trim(),
        groupe: libelle,
      });
    }
  }

  return { pose, absences, porteurs, positions, noms, comptees };
}

/**
 * Retirer cette séance RAPPROCHE-T-IL la grille du chronogramme ?
 *
 * ═══ ⚠️ LA SEULE SUPPRESSION PERMISE SOUS VERROU (2026-10-01, demande du
 * porteur) ═══ Le verrou protège l'allocation du chronogramme ; retirer une
 * séance EN TROP ou HORS CHRONOGRAMME la RÉTABLIT au lieu de la rompre.
 * Permis seulement si le retrait ne crée AUCUN manque : un dépassement d'une
 * heure ne justifie pas de retirer une séance de 2,5 h.
 *
 * ⚠️ UNE SÉANCE FUSIONNÉE COUVRE CHAQUE GROUPE : le retrait doit être permis
 *    pour TOUS, sans quoi on comblerait le trop de l'un en creusant l'autre.
 */
function retraitPermis(prevu, pose, { groupe, module, type, heures }) {
  const groupes = separerFusion(String(groupe ?? '').trim());
  if (groupes.length === 0 || String(module ?? '').trim() === '') return false;
  return groupes.every((g) => {
    const k = cle(g, module, type);
    return (pose.get(k) ?? 0) - heures >= (prevu.get(k) ?? 0) - EGAL;
  });
}

/**
 * La même question pour UNE séance, depuis les données brutes de la semaine —
 * c'est ce que le serveur pose avant de vider une case sous verrou.
 *
 * @param {object} seance  la séance à retirer (`groupe`, `module`, `seance`, `salle`…)
 * @param {object} entrees `{ chronogrammes, seances, semaineChrono }`
 */
export function retraitRapprocheDuPlan(seance, { chronogrammes = [], seances = [], semaineChrono } = {}) {
  const { prevu } = prevuDeLaSemaine(chronogrammes, semaineChrono);
  const { pose } = poseDeLaSemaine(seances);
  return retraitPermis(prevu, pose, {
    groupe: seance?.groupe,
    module: seance?.module,
    type: typeDeSeance(seance),
    heures: dureeSeance(seance?.seance),
  });
}

/** Nature d'un écart — trois, parce qu'elles n'appellent pas la même suite. */
function natureDeLEcart(prevu, pose) {
  if (prevu === 0) return 'hors_chronogramme';
  return pose < prevu ? 'manquante' : 'en_trop';
}

/**
 * Confronte le prévu et le posé.
 *
 * @param {object} entrees
 * @param {Array}  entrees.chronogrammes  lignes `{groupe, planning}`
 * @param {Array}  entrees.seances        les séances de LA semaine
 * @param {string} entrees.semaineChrono  « S9 »
 * @param {Set}    entrees.groupesConnus  noms en MAJUSCULES présents dans la carte
 * @param {Map}    entrees.formateurParModule  `GROUPE||MODULE||type` → nom affecté
 * @param {Map}    entrees.nomsFormateurs      matricule → nom
 */
export function completudeSemaine({
  chronogrammes = [],
  seances = [],
  semaineChrono,
  groupesConnus = new Set(),
  formateurParModule = new Map(),
  nomsFormateurs = new Map(),
} = {}) {
  const { prevu, noms: nomsPrevus } = prevuDeLaSemaine(chronogrammes, semaineChrono);
  const { pose, absences, porteurs, positions, noms: nomsPoses, comptees } =
    poseDeLaSemaine(seances);

  const nomGroupe = new Map([...nomsPrevus, ...nomsPoses]);

  /* Toutes les clés rencontrées d'un côté comme de l'autre, groupées par groupe. */
  const parGroupe = new Map();
  for (const k of new Set([...prevu.keys(), ...pose.keys()])) {
    const [groupeMaj] = k.split('||');
    if (!parGroupe.has(groupeMaj)) parGroupe.set(groupeMaj, []);
    parGroupe.get(groupeMaj).push(k);
  }

  const groupes = [];
  const ecarts = [];
  const inconnus = [];
  let totalPrevu = 0;
  let totalPose = 0;
  let totalCouvert = 0;

  for (const [groupeMaj, cles] of parGroupe) {
    const nom = nomGroupe.get(groupeMaj) ?? groupeMaj;

    /*
     * ⚠️ UN GROUPE ABSENT DE LA CARTE EST NOMMÉ, PAS COMPTÉ. Le taire laisserait
     *    un chronogramme fantôme vivre indéfiniment ; le compter donnerait un
     *    manque que rien ne peut combler — le groupe n'a plus d'affectation.
     */
    if (!groupesConnus.has(groupeMaj)) {
      let h = 0;
      let r = 0;
      for (const k of cles) {
        h += prevu.get(k) ?? 0;
        r += pose.get(k) ?? 0;
      }
      inconnus.push({ groupe: nom, prevu: arrondi(h), pose: arrondi(r) });
      continue;
    }

    let gPrevu = 0;
    let gPose = 0;
    let gCouvert = 0;
    let gAbsent = 0;
    const lignes = [];

    for (const k of cles) {
      const [, moduleMaj, type] = k.split('||');
      const p = arrondi(prevu.get(k) ?? 0);
      const r = arrondi(pose.get(k) ?? 0);
      const a = arrondi(absences.get(k) ?? 0);

      gPrevu += p;
      gPose += r;
      gAbsent += a;
      gCouvert += Math.min(p, r);

      if (Math.abs(p - r) < EGAL) continue;

      const nature = natureDeLEcart(p, r);
      lignes.push({
        module: moduleMaj,
        type,
        formateur: qui(nature, k, type, { formateurParModule, porteurs, nomsFormateurs }),
        prevu: p,
        pose: r,
        ecart: arrondi(r - p),
        absent: a,
        nature,
        /*
         * ⚠️ DIVISÉ PAR LA DURÉE DU JOUR, et c'est une APPROXIMATION assumée :
         *    on ne sait pas à quel créneau la séance manquante ira. Le nombre
         *    sert à dire l'ordre de grandeur (« 2 séances »), jamais à écrire.
         */
        seances: arrondi(Math.abs(r - p) / dureeSeance(null)),
        /*
         * ⚠️ SEULEMENT POUR CE QUI EST POSÉ : une séance manquante n'a pas de
         *    case. Pour « en trop » comme « hors chronogramme », les cases
         *    concernées — c'est l'écran qui choisit laquelle retirer.
         */
        /*
         * ⚠️ `retirable` (2026-10-01) : la même règle que le serveur applique
         *    sous verrou — l'écran n'offre la suppression que là où elle passe.
         */
        positions:
          nature === 'manquante'
            ? []
            : (positions.get(k) ?? []).map((position) => ({
                ...position,
                retirable: retraitPermis(prevu, pose, {
                  groupe: position.groupe,
                  module: moduleMaj,
                  type,
                  heures: dureeSeance(position.seance),
                }),
              })),
      });
    }

    totalPrevu += gPrevu;
    totalPose += gPose;
    totalCouvert += gCouvert;

    lignes.sort((x, y) => Math.abs(y.ecart) - Math.abs(x.ecart) || x.module.localeCompare(y.module));

    groupes.push({
      groupe: nom,
      prevu: arrondi(gPrevu),
      pose: arrondi(gPose),
      couvert: arrondi(gCouvert),
      absent: arrondi(gAbsent),
      ecart: arrondi(gPose - gPrevu),
      manquant: arrondi(gPrevu - gCouvert),
      enTrop: arrondi(gPose - gCouvert),
      taux: tauxConformite(gPrevu, gCouvert, gPose),
      conforme: lignes.length === 0,
      ecarts: lignes,
    });

    for (const ligne of lignes) ecarts.push({ groupe: nom, ...ligne });
  }

  /*
   * Les groupes les moins conformes en tête : c'est là que le travail reste.
   * ⚠️ Un groupe SANS référence (`taux: null`, rien de prévu mais des séances
   *    posées) passe AVANT les conformes — c'est une anomalie, pas un succès.
   */
  groupes.sort((a, b) => (a.taux ?? -1) - (b.taux ?? -1) || a.groupe.localeCompare(b.groupe));
  ecarts.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart) || a.groupe.localeCompare(b.groupe));

  return {
    total: {
      prevu: arrondi(totalPrevu),
      pose: arrondi(totalPose),
      couvert: arrondi(totalCouvert),
      manquant: arrondi(totalPrevu - totalCouvert),
      enTrop: arrondi(totalPose - totalCouvert),
      taux: tauxConformite(totalPrevu, totalCouvert, totalPose),
      /*
       * Part du prévu réellement posée, dépassement compris : elle PEUT passer
       * 100 %. Le taux, lui, ne le peut pas — les deux répondent à des
       * questions différentes, et les confondre ferait lire un dépassement
       * comme une réussite.
       */
      realisation: totalPrevu > 0 ? Math.round((totalPose / totalPrevu) * 100) : null,
      seancesGrille: comptees,
    },
    groupes,
    ecarts,
    inconnus,
  };
}

/**
 * Qui est concerné par un écart ?
 *
 * ⚠️ PAS LA MÊME PERSONNE SELON LA NATURE. Pour une séance MANQUANTE, le
 *    formateur AFFECTÉ au module — c'est lui qui devra la donner. Pour une
 *    séance EN TROP, celui qui la PORTE dans la grille, car c'est chez lui
 *    qu'il faut aller la retirer. Donner le mauvais nom enverrait chercher la
 *    séance au mauvais endroit.
 */
function qui(nature, k, type, { formateurParModule, porteurs, nomsFormateurs }) {
  if (nature !== 'manquante') {
    const matricules = [...(porteurs.get(k) ?? [])].filter(Boolean);
    if (matricules.length > 0) {
      return [...new Set(matricules.map((m) => nomsFormateurs.get(m) ?? m))].sort().join(' · ');
    }
  }
  return formateurParModule.get(k) ?? '';
}
