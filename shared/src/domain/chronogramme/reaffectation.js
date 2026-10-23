import { TYPES_COURS } from '../../constants/index.js';
import { separerFusion } from '../carte/reconstruction.js';
import { cleLigne } from './fusion.js';
import { TYPES, celluleDepuisParts, partsDeCellule } from './planning.js';

/**
 * ═══ LE MODULE RÉAFFECTÉ EN COURS D'ANNÉE (2026-10-22, demande du porteur) ═══
 * « Un module était affecté à un formateur, puis il a été réaffecté à un autre :
 * le formateur 1 a débuté le module en emploi, le formateur 2 va le compléter. »
 *
 * Le planning du chronogramme est stocké par GROUPE, MODULE et SEMAINE — sans
 * formateur : celui-ci se lit dans l'affectation ACTUELLE. Réaffecter le module
 * donnait donc au formateur 2 toutes les heures, celles que le formateur 1 avait
 * déjà faites comprises, et le formateur 1 les perdait de sa charge.
 *
 * ═══ LE PLANNING NE CHANGE PAS DE FORME ═══
 * Une SEMAINE DE BASCULE coupe le module : jusqu'à elle, les cases sont celles
 * de l'ancien formateur ; après, celles du titulaire. C'est une LECTURE du
 * planning, comme le partage par type (`partage.js`) : chaque ligne ne montre
 * et n'écrit que SES semaines.
 *
 * ═══ LA BASCULE VIENT DE L'EMPLOI DU TEMPS (décision du porteur) ═══
 * La dernière semaine où l'ancien formateur a des séances de ce module avec ce
 * groupe. Le journal (`Reaffectation`) dit QUI, QUAND et PAR QUI — et peut fixer
 * la bascule à la main quand l'emploi se trompe.
 */

export const MOTIF_REAFFECTATION = 'reaffectation';

/**
 * La semaine d'un ANCIEN titulaire : elle porte les heures qu'il a faites, lues
 * dans l'emploi du temps (2026-10-23) — elles se corrigent là-bas, pas ici.
 */
export const MOTIF_REALISE = 'realise';

/**
 * Le nombre de semaines distinctes qu'un ancien titulaire doit avoir faites.
 *
 * ⚠️ UNE SEULE SUFFIT (2026-10-23, retour du porteur) : EGTS101 de GM101, fait
 *    une semaine par LAASSAL puis réaffecté à AAJLIYE, n'était pas reconnu avec
 *    un seuil de deux. Le remplaçant reste écarté par l'autre garde (toutes ses
 *    séances AVANT la première du titulaire) ; un faux positif s'écarte à la
 *    main (`ignoree` au journal).
 */
export const SEMAINES_MIN_ANCIEN = 1;

const cle = (valeur) => String(valeur ?? '').trim().toUpperCase();

/** Le type d'une affectation (`presentiel`/`synchrone`) → celui du chronogramme (P/S). */
export const typeChronogramme = (type) =>
  type === TYPES_COURS.SYNCHRONE || type === TYPES.SYNCHRONE ? TYPES.SYNCHRONE : TYPES.PRESENTIEL;

/** La clé d'une réaffectation : un groupe (jamais une fusion), un module, un type. */
export const cleReaffectation = (groupe, module, type) =>
  `${cle(groupe)}||${cle(module)}||${typeChronogramme(type)}`;

/**
 * Les anciens titulaires de chaque (groupe, module, type), avec leur bascule.
 *
 * Deux sources, réunies :
 *   · le JOURNAL, écrit à chaque réaffectation (qui, quand, par qui) ;
 *   · l'EMPLOI DU TEMPS, pour les réaffectations faites avant le journal.
 *
 * ⚠️ UN REMPLAÇANT N'EST PAS UN ANCIEN TITULAIRE. L'emploi ne distingue pas une
 *    séance de remplacement : un collègue qui couvre une absence a, lui aussi,
 *    des séances du module. On ne retient donc, hors journal, que celui dont
 *    TOUTES les séances précèdent la première du titulaire actuel. Un
 *    remplacement au milieu de l'année tombe après la première séance du
 *    titulaire ; le cas restant (un remplaçant AVANT toute séance du titulaire)
 *    s'écarte à la main — `ignoree` au journal.
 *
 * @param {object} donnees
 * @param {Array<{formateur, groupe, module, type}>} donnees.affectations — la base
 * @param {Array<{formateur, groupe, module, type, numero}>} donnees.seances —
 *   séances CONSOLIDÉES de l'emploi (EFM, rattrapages et absences exclus par
 *   l'appelant), une par formateur et par semaine suffit
 * @param {Array<{groupe, module, type, ancien, nouveau, date, auteur, derniereSemaine, id}>} donnees.journal
 * @returns {Map<string, Array<{ancien, derniereSemaine, date, auteur, source, id}>>}
 *   clé `cleReaffectation`, anciens triés par bascule croissante
 */
export function detecterReaffectations({ affectations = [], seances = [], journal = [] } = {}) {
  const titulaires = new Map();
  for (const affectation of affectations) {
    const formateur = cle(affectation.formateur);
    if (formateur === '' || cle(affectation.module) === '') continue;
    for (const groupe of separerFusion(affectation.groupe)) {
      const k = cleReaffectation(groupe, affectation.module, affectation.type);
      if (!titulaires.has(k)) titulaires.set(k, new Set());
      titulaires.get(k).add(formateur);
    }
  }

  // Les semaines de chaque formateur, par clé — et les heures faites chacune.
  const semaines = new Map();
  for (const seance of seances) {
    const formateur = cle(seance.formateur);
    const numero = Number(seance.numero);
    if (formateur === '' || cle(seance.module) === '' || !(numero > 0)) continue;
    for (const groupe of separerFusion(seance.groupe)) {
      const k = cleReaffectation(groupe, seance.module, seance.type);
      if (!semaines.has(k)) semaines.set(k, new Map());
      const parFormateur = semaines.get(k);
      if (!parFormateur.has(formateur)) parFormateur.set(formateur, new Map());
      const heures = parFormateur.get(formateur);
      heures.set(numero, (heures.get(numero) ?? 0) + (Number(seance.heures) || 0));
    }
  }

  /*
   * ═══ LES HEURES FAITES, SEMAINE PAR SEMAINE (2026-10-23, demande du
   * porteur : « afficher le nombre d'heures qu'il a travaillé dans ce module,
   * 2,5 h en S1 par exemple ») ═══ Lues dans l'emploi, jusqu'à la bascule.
   */
  const realiseJusqua = (heures, derniere) =>
    Object.fromEntries(
      [...(heures ?? new Map())]
        .filter(([numero, total]) => numero <= derniere && total > 0)
        .map(([numero, total]) => [numero, arrondir(total)])
    );

  const resultat = new Map();
  const ajouter = (k, entree) => {
    if (!resultat.has(k)) resultat.set(k, new Map());
    resultat.get(k).set(cle(entree.ancien), entree);
  };

  for (const [k, parFormateur] of semaines) {
    const actuels = titulaires.get(k);
    if (!actuels || actuels.size === 0) continue;
    const debutTitulaire = Math.min(
      ...[...actuels].map((f) => (parFormateur.has(f) ? Math.min(...parFormateur.get(f).keys()) : Infinity))
    );
    for (const [formateur, heures] of parFormateur) {
      if (actuels.has(formateur) || heures.size < SEMAINES_MIN_ANCIEN) continue;
      const derniere = Math.max(...heures.keys());
      if (derniere >= debutTitulaire) continue;
      ajouter(k, {
        ancien: formateur,
        derniereSemaine: derniere,
        realise: realiseJusqua(heures, derniere),
        date: null,
        auteur: null,
        source: 'emploi',
        id: null,
      });
    }
  }

  /*
   * Le JOURNAL l'emporte sur la déduction : il connaît la date et l'auteur, et
   * sa bascule fixée à la main prime sur celle de l'emploi.
   */
  for (const entree of journal) {
    const ancien = cle(entree.ancien);
    if (ancien === '') continue;
    for (const groupe of separerFusion(entree.groupe)) {
      const k = cleReaffectation(groupe, entree.module, entree.type);
      /*
       * « Ce n'était pas une réaffectation » (2026-10-23) : un remplaçant que
       * l'emploi faisait passer pour l'ancien titulaire. Écarté à la main, il
       * ne coupe plus le module.
       */
      if (entree.ignoree) {
        resultat.get(k)?.delete(ancien);
        continue;
      }
      const actuels = titulaires.get(k);
      // Le module est revenu à son ancien titulaire, ou n'a plus personne : rien à couper.
      if (!actuels || actuels.size === 0 || actuels.has(ancien)) continue;
      const heures = semaines.get(k)?.get(ancien);
      const fixee = Number(entree.derniereSemaine) > 0 ? Number(entree.derniereSemaine) : null;
      const derniere = fixee ?? (heures?.size ? Math.max(...heures.keys()) : null);
      // L'ancien n'a jamais enseigné ce module : il n'a aucune heure à garder.
      if (!derniere) continue;
      ajouter(k, {
        ancien,
        derniereSemaine: derniere,
        realise: realiseJusqua(heures, derniere),
        date: entree.date ?? null,
        auteur: entree.auteur ?? null,
        source: fixee ? 'manuel' : 'journal',
        id: entree.id ?? null,
      });
    }
  }

  return new Map(
    [...resultat]
      .filter(([, anciens]) => anciens.size > 0)
      .map(([k, anciens]) => [k, [...anciens.values()].sort((a, b) => a.derniereSemaine - b.derniereSemaine)])
  );
}

/**
 * Les changements de titulaire entre deux versions des affectations — ce que le
 * journal retient à chaque enregistrement de la carte.
 *
 * ⚠️ PAR GROUPE, JAMAIS PAR FUSION : la grille d'un groupe est ce qui se coupe.
 * ⚠️ UN RETRAIT SEUL EST RETENU AUSSI (`nouveau` vide) : la carte s'enregistre
 *    toute seule pendant la saisie, et une réaffectation se fait souvent en deux
 *    temps — on efface le nom, puis on choisit le suivant. Le second temps
 *    complète l'entrée du premier (voir le service).
 *
 * @returns {Array<{groupe, module, type, ancien, nouveau}>}
 */
export function changementsDeTitulaire(avant = [], apres = []) {
  const indexer = (affectations) => {
    const table = new Map();
    for (const affectation of affectations ?? []) {
      const formateur = String(affectation.formateur ?? '').trim();
      const module = String(affectation.module ?? '').trim();
      if (formateur === '' || module === '') continue;
      for (const groupe of separerFusion(affectation.groupe)) {
        const k = cleReaffectation(groupe, module, affectation.type);
        if (!table.has(k)) table.set(k, { groupe, module, type: typeChronogramme(affectation.type), formateurs: new Map() });
        table.get(k).formateurs.set(cle(formateur), formateur);
      }
    }
    return table;
  };

  const anciens = indexer(avant);
  const nouveaux = indexer(apres);
  const changements = [];

  for (const k of new Set([...anciens.keys(), ...nouveaux.keys()])) {
    const a = anciens.get(k);
    const n = nouveaux.get(k);
    const partis = [...(a?.formateurs ?? new Map())].filter(([f]) => !n?.formateurs.has(f)).map(([, v]) => v);
    const arrives = [...(n?.formateurs ?? new Map())].filter(([f]) => !a?.formateurs.has(f)).map(([, v]) => v);
    const { groupe, module, type } = a ?? n;
    for (const ancien of partis) {
      changements.push({ groupe, module, type, ancien, nouveau: arrives.join(' · ') });
    }
    // Une arrivée sans départ : peut-être le second temps d'une réaffectation.
    if (partis.length === 0) {
      for (const nouveau of arrives) changements.push({ groupe, module, type, ancien: '', nouveau });
    }
  }

  return changements;
}

/* ─────────────────────────── La lecture par plage ─────────────────────────── */

/** Une semaine est-elle dans la plage `{de, a}` (bornes incluses, absentes = ouvertes) ? */
export const dansLaPlage = (numero, plage) =>
  !plage ||
  ((plage.de == null || Number(numero) >= plage.de) && (plage.a == null || Number(numero) <= plage.a));

/** Le libellé court d'une plage : « S1–S7 », « depuis S8 ». */
export function libellePlage(plage) {
  if (!plage) return '';
  if (plage.a == null) return `depuis S${plage.de}`;
  return `S${plage.de ?? 1}–S${plage.a}`;
}

/**
 * Les cellules d'une ligne : la part de SON type (`typeSeul`), dans SA plage.
 * Une case mixte n'y laisse que la part de ce type.
 */
export function cellulesDeLaLigne(cellules = {}, ligne = {}) {
  const resultat = {};
  for (const [numero, cellule] of Object.entries(cellules ?? {})) {
    if (!dansLaPlage(numero, ligne.plage)) continue;
    if (!ligne.typeSeul) {
      resultat[numero] = cellule;
      continue;
    }
    const heures = partsDeCellule(cellule)[ligne.typeSeul];
    if (heures > 0) resultat[numero] = { heures, type: ligne.typeSeul };
  }
  return resultat;
}

/**
 * Le retour : les saisies d'une ligne réinjectées dans les cellules du module.
 *
 * ⚠️ HORS DE SA PLAGE, RIEN NE BOUGE : ce sont les semaines de l'autre
 *    formateur, qu'aucune saisie sur cette ligne ne doit effacer. Dans la plage,
 *    seule la part de son type change si la ligne est `typeSeul`.
 */
export function fusionnerLigne(origine = {}, saisies = {}, ligne = {}) {
  const cellules = {};
  for (const numero of new Set([...Object.keys(origine ?? {}), ...Object.keys(saisies ?? {})])) {
    let cellule = origine?.[numero];
    if (dansLaPlage(numero, ligne.plage)) {
      if (ligne.typeSeul) {
        const autre = ligne.typeSeul === TYPES.SYNCHRONE ? TYPES.PRESENTIEL : TYPES.SYNCHRONE;
        cellule = celluleDepuisParts({
          [autre]: partsDeCellule(origine?.[numero])[autre],
          [ligne.typeSeul]: partsDeCellule(saisies?.[numero])[ligne.typeSeul],
        });
      } else {
        cellule = saisies?.[numero];
      }
    }
    if (cellule) cellules[numero] = cellule;
  }
  return cellules;
}

/**
 * Les semaines d'une ligne : fermées hors de sa plage, avec leur motif.
 *
 * `realise` : la ligne d'un ancien titulaire montre ce qu'il a FAIT, lu dans
 * l'emploi — ses semaines sont fermées à la saisie aussi (motif `realise`).
 */
export function fermerHorsPlage(semaines = [], plage, { realise = false } = {}) {
  if (!plage) return semaines;
  return semaines.map((semaine) => {
    if (!semaine.disponible) return semaine;
    const dedans = dansLaPlage(semaine.numero, plage);
    if (dedans && !realise) return semaine;
    return {
      ...semaine,
      disponible: false,
      joursDisponibles: 0,
      motif: dedans ? MOTIF_REALISE : MOTIF_REAFFECTATION,
    };
  });
}

/**
 * Les heures faites, en cellules du chronogramme : `{P: {numero: h}, S: {...}}`
 * → `{numero: cellule}` — mixte si les deux types ont des heures la même semaine.
 */
export function cellulesRealisees(realiseParType = {}) {
  const numeros = new Set(Object.values(realiseParType).flatMap((heures) => Object.keys(heures ?? {})));
  const cellules = {};
  for (const numero of numeros) {
    const cellule = celluleDepuisParts({
      [TYPES.PRESENTIEL]: realiseParType[TYPES.PRESENTIEL]?.[numero] ?? 0,
      [TYPES.SYNCHRONE]: realiseParType[TYPES.SYNCHRONE]?.[numero] ?? 0,
    });
    if (cellule) cellules[numero] = cellule;
  }
  return cellules;
}

/** Ce que les anciens ont FAIT, par type — à retirer de la masse du titulaire. */
export function dejaFaitPar(anciens = [], types = [TYPES.PRESENTIEL, TYPES.SYNCHRONE]) {
  const fait = { presentiel: 0, synchrone: 0 };
  for (const ancien of anciens) {
    for (const type of types) {
      const champ = type === TYPES.SYNCHRONE ? 'synchrone' : 'presentiel';
      const heures = ancien.realiseParType?.[type] ?? (ancien.type === type ? ancien.realise : null) ?? {};
      fait[champ] = arrondir(fait[champ] + Object.values(heures).reduce((somme, h) => somme + Number(h || 0), 0));
    }
  }
  return fait;
}

const heuresDuType = (cellules, type, filtre) =>
  Object.entries(cellules ?? {})
    .filter(([numero]) => filtre(Number(numero)))
    .reduce((somme, [, cellule]) => somme + partsDeCellule(cellule)[type], 0);

const arrondir = (valeur) => Math.round(valeur * 100) / 100;

/**
 * La masse d'une ligne bornée.
 *
 *   · celle d'un ANCIEN titulaire (`termine`) : ce qu'il a fait — les heures
 *     lues dans l'emploi (`realise`), à défaut celles de sa plage au
 *     chronogramme ; son écart est nul ;
 *   · celle du TITULAIRE : la masse du module MOINS ce que les anciens ont
 *     fait (`dejaFait`), à défaut posé avant lui. Son « reste à planifier »
 *     est ainsi le vrai reste.
 */
export function massesDeLaLigne(ligne, cellules) {
  const totales = ligne.massesTotales ?? ligne.masses ?? { presentiel: 0, synchrone: 0 };
  const types = ligne.typeSeul ? [ligne.typeSeul] : [TYPES.PRESENTIEL, TYPES.SYNCHRONE];
  const masses = { presentiel: 0, synchrone: 0 };
  for (const type of types) {
    const champ = type === TYPES.SYNCHRONE ? 'synchrone' : 'presentiel';
    if (ligne.termine) {
      masses[champ] = ligne.realise
        ? heuresDuType(ligne.realise, type, () => true)
        : heuresDuType(cellules, type, (n) => dansLaPlage(n, ligne.plage));
    } else {
      const avant = ligne.dejaFait
        ? Number(ligne.dejaFait[champ] ?? 0)
        : heuresDuType(cellules, type, (n) => ligne.plage?.de != null && n < ligne.plage.de);
      masses[champ] = Math.max(0, Number(totales[champ] ?? 0) - avant);
    }
    masses[champ] = arrondir(masses[champ]);
  }
  return masses;
}

const signature = (liste = []) => liste.map((r) => `${cle(r.ancien)}@${r.derniereSemaine}`).join('|');

/**
 * Les lignes d'une réaffectation : une par ancien titulaire, puis celle du
 * titulaire — chacune bornée à ses semaines.
 *
 * @param {object} ligne — la ligne du module (porte `reaffectations: {P, S}`)
 * @param {Array} anciens — les anciens de SES types, triés par bascule
 * @param {object} cellules — les cellules du module (planning source)
 * @param {Array} semaines — les semaines par défaut de la grille
 */
function lignesBornees(ligne, anciens, cellules, semaines) {
  const source = ligne.cleSource ?? cleLigne(ligne);
  const base = ligne.semaines ?? semaines;
  const types = ligne.typeSeul ? [ligne.typeSeul] : [TYPES.PRESENTIEL, TYPES.SYNCHRONE];
  const lignes = [];
  let precedente = 0;

  anciens.forEach((ancien, rang) => {
    const plage = { de: precedente + 1, a: ancien.derniereSemaine };
    precedente = ancien.derniereSemaine;
    const nom = ancien.nom ?? ancien.ancien;
    // Les heures FAITES, lues dans l'emploi — `null` si la source n'en dit rien.
    const realise = ancien.realiseParType
      ? cellulesDeLaLigne(cellulesRealisees(ancien.realiseParType), { plage })
      : null;
    const terminee = {
      ...ligne,
      cle: `${cleLigne(ligne)}#R${rang}`,
      cleSource: source,
      plage,
      termine: true,
      reaffectation: ancien,
      realise,
      formateurs: [nom],
      formateursPresentiel: types.includes(TYPES.PRESENTIEL) ? [nom] : [],
      formateursSynchrone: types.includes(TYPES.SYNCHRONE) ? [nom] : [],
      noteFormateur: `${libellePlage(plage)}, terminé`,
      semaines: fermerHorsPlage(base, plage, { realise: Boolean(realise) }),
    };
    lignes.push({ ...terminee, masses: massesDeLaLigne(terminee, cellules) });
  });

  const plage = { de: precedente + 1, a: null };
  const titulaire = {
    ...ligne,
    cleSource: source,
    plage,
    massesTotales: ligne.massesTotales ?? ligne.masses,
    reprisDe: anciens,
    // Ce que les anciens ont fait, d'après l'emploi — sinon, le planning le dira.
    dejaFait: anciens.every((ancien) => ancien.realiseParType) ? dejaFaitPar(anciens, types) : null,
    noteFormateur: libellePlage(plage),
    semaines: fermerHorsPlage(base, plage),
  };
  lignes.push({ ...titulaire, masses: massesDeLaLigne(titulaire, cellules) });
  return lignes;
}

/**
 * Vue par GROUPE : chaque module réaffecté devient une ligne par ancien
 * titulaire, puis celle du titulaire actuel (choix du porteur : « deux lignes »).
 *
 * ⚠️ UN SEUL TYPE RÉAFFECTÉ : le module se scinde d'abord par type (le
 *    présentiel est passé à un autre, le synchrone est resté) — sinon une même
 *    ligne aurait deux bascules.
 * ⚠️ LES AUTRES MODULES SONT RENDUS TELS QUELS (même objet), pour ne pas défaire
 *    la mémoïsation des cellules.
 *
 * @param {Array} lignes — après `scinderParType`
 * @param {object} planning — le planning du groupe (clés source)
 * @param {Array} semaines — les semaines de la grille
 */
export function scinderParReaffectation(lignes = [], planning = {}, semaines = []) {
  return lignes.flatMap((ligne) => {
    const reaffectations = ligne?.reaffectations;
    if (!reaffectations) return [ligne];

    const types = ligne.typeSeul
      ? [ligne.typeSeul]
      : [TYPES.PRESENTIEL, TYPES.SYNCHRONE].filter(
          (type) => Number(ligne.masses?.[type === TYPES.SYNCHRONE ? 'synchrone' : 'presentiel'] ?? 0) > 0
        );
    const parType = types.map((type) => reaffectations[type] ?? []);
    if (parType.every((anciens) => anciens.length === 0)) return [ligne];

    const cellules = planning?.[ligne.cleSource ?? cleLigne(ligne)] ?? {};

    if (types.length > 1 && signature(parType[0]) !== signature(parType[1])) {
      return types.flatMap((type, rang) => {
        const estS = type === TYPES.SYNCHRONE;
        const seule = {
          ...ligne,
          cle: `${cleLigne(ligne)}#${type}`,
          cleSource: ligne.cleSource ?? cleLigne(ligne),
          typeSeul: type,
          formateurs: estS ? ligne.formateursSynchrone : ligne.formateursPresentiel,
          formateursPresentiel: estS ? [] : ligne.formateursPresentiel,
          formateursSynchrone: estS ? ligne.formateursSynchrone : [],
          masses: {
            presentiel: estS ? 0 : ligne.masses.presentiel,
            synchrone: estS ? ligne.masses.synchrone : 0,
          },
        };
        const anciens = parType[rang].map((ancien) => ({
          ...ancien,
          realiseParType: ancien.realise ? { [type]: ancien.realise } : undefined,
        }));
        return anciens.length === 0 ? [seule] : lignesBornees(seule, anciens, cellules, semaines);
      });
    }

    /*
     * Les deux types repris ensemble (même ancien, même bascule) : la ligne de
     * l'ancien porte les heures faites des DEUX, en cases mixtes au besoin.
     */
    const reference = parType.find((anciens) => anciens.length > 0);
    const anciens = reference.map((ancien, rang) => ({
      ...ancien,
      realiseParType: types.every((type, t) => parType[t][rang]?.realise)
        ? Object.fromEntries(types.map((type, t) => [type, parType[t][rang].realise]))
        : undefined,
    }));
    return lignesBornees(ligne, anciens, cellules, semaines);
  });
}
