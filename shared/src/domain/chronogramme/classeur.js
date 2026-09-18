import { NOMBRE_SEMAINES, PAS, PLAFOND_CELLULE } from './semaines.js';
import { TYPES } from './planning.js';

/**
 * Le classeur du chronogramme : ce qu'on écrit dedans, et ce qu'on en relit.
 * ← api/profile/export_chronogramme.php + import_chronogramme.php
 *
 * ═══ POURQUOI UNE LIGNE PAR TYPE, ET NON UN « 5|P » DANS LA CELLULE ═══
 * Une cellule de la grille porte DEUX informations : des heures et leur nature,
 * présentiel ou synchrone. Les écrire ensemble donne un TEXTE — Excel ne peut
 * alors ni le sommer, ni l'offrir dans une liste déroulante.
 *
 * Le type passe donc dans une COLONNE, et chaque module reçoit une ligne « P »
 * et, s'il en prévoit, une ligne « S ». Les cellules de semaine ne portent plus
 * qu'un NOMBRE : sommable, et contraint par une liste qui n'offre que les
 * valeurs de la grille.
 *
 * C'est fidèle au modèle — une case ne porte qu'un seul type — et la relecture
 * REFUSE qu'une même semaine soit remplie sur les deux lignes.
 *
 * ═══ LE FICHIER DOIT RESTER RÉIMPORTABLE ═══
 * Deux règles de l'existant, portées telles quelles :
 *   1. Le nom du sujet est écrit EN CLAIR en B1, pas seulement dans l'onglet :
 *      Excel interdit `: \ / ? * [ ]` dans un nom d'onglet et le tronque à 31
 *      caractères. La relecture lit B1 d'abord.
 *   2. La ligne d'en-tête est repérée par son PREMIER LIBELLÉ, jamais par son
 *      numéro : une ligne de titre ajoutée ne doit pas casser la relecture.
 */

/** Colonnes de tête, dans l'ordre de l'écran. Cinq de chaque côté, plus « Type ». */
export const ENTETES_GROUPE = ['Module', 'Intitulé', 'SEM', 'REG', 'Formateur', 'Type'];
export const ENTETES_FORMATEUR = ['Groupe', 'Module', 'Intitulé', 'SEM', 'REG', 'Type'];

/** Les cinq colonnes de masse qui ferment le tableau. */
export const ENTETES_MASSES = [
  'MH PREVU (P)',
  'MH PREVU (SYN)',
  'MH AFFEC (P)',
  'MH AFFEC (SYN)',
  'ECART',
];

/**
 * Les seules valeurs que la grille propose.
 * La liste déroulante du classeur offre exactement les mêmes : un fichier
 * retouché hors ligne ne peut donc pas produire une valeur que l'écran
 * refuserait.
 */
export const VALEURS_AUTORISEES = Array.from(
  { length: PLAFOND_CELLULE / PAS },
  (_, rang) => (rang + 1) * PAS
);

/** Feuilles produites par l'export qui ne sont pas des données. */
export const FEUILLES_TECHNIQUES = ['valeurs', 'charge groupes', 'charge formateurs'];

export const entetes = (mode) => (mode === 'formateur' ? ENTETES_FORMATEUR : ENTETES_GROUPE);

/**
 * Les lignes d'une feuille, dans l'ordre où elles s'écrivent.
 *
 * Un module donne UNE ligne « P », et une ligne « S » seulement s'il prévoit des
 * heures synchrones. En produire une systématiquement doublerait la hauteur du
 * tableau avec des lignes que rien ne peut remplir.
 *
 * @param {Array} modules  modules de la grille (chacun avec `masses`)
 * @param {object} planning  { [cléDeLigne]: { [semaine]: {heures, type} } }
 * @param {'groupe'|'formateur'} mode
 */
export function lignesClasseur(modules, planning = {}, mode = 'groupe') {
  const lignes = [];

  for (const module of modules) {
    const cle = module.cle ?? module.code;
    const cellules = planning[cle] ?? {};

    const commun = {
      groupe: module.groupe ?? '',
      code: module.code,
      intitule: module.intitule ?? '',
      semestre: abregerSemestre(module.semestre),
      regional: module.estRegional ? 'X' : '',
      formateurs: (module.formateurs ?? []).join(' · '),
      cle,
    };

    /*
     * ⚠️ CHAQUE LIGNE PORTE LES FORMATEURS DE SON TYPE. Un module assuré à deux
     * — l'un le présentiel, l'autre le synchrone — attribuerait sinon à l'un les
     * heures de l'autre dans la feuille de charge.
     */
    lignes.push({
      ...commun,
      type: TYPES.PRESENTIEL,
      titulaires: module.formateursPresentiel ?? module.formateurs ?? [],
      // Le présentiel n'est jamais mutualisé : chaque groupe a sa séance.
      ensemble: '',
      prevu: arrondir(module.masses?.presentiel ?? 0),
      heures: heuresParSemaine(cellules, TYPES.PRESENTIEL),
    });

    if ((module.masses?.synchrone ?? 0) > 0) {
      lignes.push({
        ...commun,
        type: TYPES.SYNCHRONE,
        titulaires: module.formateursSynchrone ?? module.formateurs ?? [],
        /*
         * Étiquette de la séance mutualisée (« GM101 GM102 »). Elle est diffusée
         * à plusieurs groupes mais ne PÈSE qu'une fois sur le formateur : c'est
         * elle qui permet de ne la compter qu'une seule fois.
         */
        ensemble: String(module.fusionSynchrone ?? '').trim() || (module.groupe ?? ''),
        prevu: arrondir(module.masses.synchrone),
        heures: heuresParSemaine(cellules, TYPES.SYNCHRONE),
      });
    }
  }

  return mode === 'formateur'
    ? lignes.sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr') || a.code.localeCompare(b.code, 'fr'))
    : lignes;
}

/** Heures d'un type, semaine par semaine — les autres cases restent vides. */
function heuresParSemaine(cellules, type) {
  const par = {};

  for (const [semaine, cellule] of Object.entries(cellules ?? {})) {
    if (cellule?.type === type && Number(cellule.heures) > 0) {
      par[Number(semaine)] = Number(cellule.heures);
    }
  }

  return par;
}

/**
 * Relit UNE feuille du classeur.
 *
 * ═══ FUSION, JAMAIS REMPLACEMENT ═══
 * La feuille n'écrit que les cellules qu'elle NOMME ; ce qu'elle ne mentionne
 * pas reste intact. C'est la seule règle sûre pour une feuille de FORMATEUR,
 * qui ne porte qu'une partie des modules de chaque groupe — un remplacement y
 * effacerait tous les autres. La même règle vaut pour les feuilles de groupe,
 * pour qu'il n'y ait qu'un comportement à connaître.
 *
 * ═══ CE QUI EST REFUSÉ EST DIT ═══
 * Un en-tête qui ne correspond pas, un groupe inconnu, un module qui
 * n'appartient pas au groupe, une valeur mal formée : chacun est IGNORÉ et
 * RAPPORTÉ. Rejeter le classeur entier pour une cellule fautive obligerait à
 * tout recommencer ; l'accepter en silence laisserait croire à un import
 * complet.
 *
 * @param {{nom: string, lignes: string[][]}} feuille  l'index 0 = ligne 1 du tableur
 * @param {{groupes: Map, modulesParGroupe: Map}} referentiel
 * @returns {{etat: 'lue'|'ignoree', raison?: string, sujet?, mode?, cellules?, refus?}}
 */
export function lireFeuilleChronogramme(feuille, referentiel) {
  const lignes = feuille.lignes ?? [];
  const cellule = (rang, colonne) => String(lignes[rang]?.[colonne] ?? '').trim();

  if (FEUILLES_TECHNIQUES.includes(String(feuille.nom ?? '').toLowerCase())) {
    return { etat: 'technique' };
  }

  /*
   * ⚠️ LE GARDE-FOU EST ICI, pas dans le nom de la feuille. A1 doit annoncer
   * « Groupe » ou « Formateur » : une feuille de bilan renommée continue donc
   * d'être écartée, et une feuille étrangère au classeur ne peut pas se faire
   * passer pour des données.
   */
  const etiquette = cellule(0, 0).toLowerCase();
  const mode = etiquette.startsWith('formateur')
    ? 'formateur'
    : etiquette.startsWith('groupe')
      ? 'groupe'
      : null;

  if (mode === null) {
    return {
      etat: 'ignoree',
      raison: 'en-tête absent : la cellule A1 doit contenir « Groupe » ou « Formateur »',
    };
  }

  // B1 d'abord, le nom d'onglet en repli : Excel tronque celui-ci à 31
  // caractères et en retire les caractères interdits.
  const sujet = cellule(0, 1) || String(feuille.nom ?? '').trim();

  // ⚠️ La ligne d'en-tête se CHERCHE, elle n'est jamais supposée.
  const attendu = mode === 'groupe' ? 'module' : 'groupe';
  const hautMax = Math.min(20, lignes.length);
  let rangEntete = -1;
  for (let rang = 0; rang < hautMax; rang += 1) {
    if (cellule(rang, 0).toLowerCase() === attendu) {
      rangEntete = rang;
      break;
    }
  }

  if (rangEntete === -1) {
    return {
      etat: 'ignoree',
      raison: `colonne « ${attendu[0].toUpperCase()}${attendu.slice(1)} » introuvable`,
    };
  }

  // Colonnes de semaine, d'après l'en-tête : l'ORDRE DU FICHIER fait foi. Une
  // colonne déplacée à la main reste donc lue au bon endroit.
  const colonnesSemaine = new Map();
  let colonneType = null;

  for (let colonne = 0; colonne < (lignes[rangEntete]?.length ?? 0); colonne += 1) {
    const libelle = cellule(rangEntete, colonne);
    const trouve = /^S(\d{1,2})$/i.exec(libelle);

    if (trouve) {
      const numero = Number(trouve[1]);
      if (numero >= 1 && numero <= NOMBRE_SEMAINES) colonnesSemaine.set(colonne, numero);
    } else if (libelle.toLowerCase() === 'type') {
      colonneType = colonne;
    }
  }

  if (colonnesSemaine.size === 0) {
    return { etat: 'ignoree', raison: `aucune colonne de semaine (S1…S${NOMBRE_SEMAINES})` };
  }

  const groupes = referentiel.groupes ?? new Map();
  const modulesParGroupe = referentiel.modulesParGroupe ?? new Map();

  if (mode === 'groupe' && !groupes.has(sujet.toUpperCase())) {
    return { etat: 'ignoree', raison: `groupe « ${sujet} » inconnu dans la base de cette année` };
  }

  const refus = [];
  /*
   * On RASSEMBLE avant d'écrire. Le format courant étale un module sur deux
   * lignes : une semaine ne peut être remplie que sur l'une des deux, et il faut
   * les avoir vues toutes les deux pour refuser le conflit — sinon la dernière
   * ligne lue l'emporterait en silence.
   */
  const parCellule = new Map();

  for (let rang = rangEntete + 1; rang < lignes.length; rang += 1) {
    const c1 = cellule(rang, 0);
    const c2 = cellule(rang, 1);
    const numeroLigne = rang + 1;

    if (c1.toUpperCase() === 'TOTAL') continue; // ligne de totaux, pas une donnée
    if (c1 === '' && c2 === '') continue;

    const groupeBrut = mode === 'groupe' ? sujet : c1;
    const moduleBrut = mode === 'groupe' ? c1 : c2;
    if (moduleBrut === '') continue;

    const cleGroupe = groupeBrut.toUpperCase();
    if (!groupes.has(cleGroupe)) {
      refus.push(`ligne ${numeroLigne} : groupe « ${groupeBrut} » inconnu`);
      continue;
    }

    const cleModule = moduleBrut.toUpperCase();
    if (!modulesParGroupe.get(cleGroupe)?.has(cleModule)) {
      refus.push(
        `ligne ${numeroLigne} : le module « ${moduleBrut} » n’appartient pas à ${groupes.get(cleGroupe)}`
      );
      continue;
    }

    let typeLigne = TYPES.PRESENTIEL;
    if (colonneType !== null) {
      const brut = cellule(rang, colonneType).toUpperCase();
      if (brut !== TYPES.PRESENTIEL && brut !== TYPES.SYNCHRONE) {
        refus.push(`ligne ${numeroLigne} : type « ${brut} » non reconnu (attendu P ou S)`);
        continue;
      }
      typeLigne = brut;
    }

    const groupe = groupes.get(cleGroupe);
    const code = modulesParGroupe.get(cleGroupe).get(cleModule);

    for (const [colonne, semaine] of colonnesSemaine) {
      const brut = cellule(rang, colonne);
      const cle = `${groupe}||${code}||${semaine}`;
      const existant = parCellule.get(cle);

      if (brut === '') {
        /*
         * Une cellule VIDE EFFACE la semaine — contrepartie naturelle de
         * l'export, où une semaine sans séance est vide. Mais elle n'écrase
         * JAMAIS une valeur déjà lue sur l'autre ligne du même module : c'est
         * précisément le cas normal, le type non employé étant vide partout.
         */
        if (!existant) parCellule.set(cle, { groupe, code, semaine, heures: null, lignes: [numeroLigne] });
        continue;
      }

      const lue = lireValeur(brut, colonneType !== null, typeLigne);
      if (lue.erreur) {
        refus.push(`ligne ${numeroLigne}, S${semaine} : ${lue.erreur}`);
        continue;
      }
      if (lue.heures === 0) continue; // un zéro explicite ne pose rien

      if (
        existant &&
        existant.heures !== null &&
        (existant.heures !== lue.heures || existant.type !== lue.type)
      ) {
        refus.push(
          `S${semaine}, module ${code} : rempli sur les lignes ${[...existant.lignes, numeroLigne].join(' et ')}` +
            ' — une semaine ne peut porter qu’un seul type'
        );
        continue;
      }

      parCellule.set(cle, {
        groupe,
        code,
        semaine,
        heures: lue.heures,
        type: lue.type,
        lignes: [numeroLigne],
      });
    }
  }

  return {
    etat: 'lue',
    sujet,
    mode,
    cellules: [...parCellule.values()].map(({ lignes: _, ...reste }) => reste),
    refus,
  };
}

/**
 * Valeur d'une cellule de semaine.
 *
 * ⚠️ DEUX FORMATS SONT ACCEPTÉS, comme dans l'existant. Le format COURANT met un
 * nombre dans la cellule et le type dans sa colonne ; l'ANCIEN écrivait « 5|P »
 * directement. Un classeur exporté avant ce changement, et déjà retouché, ne
 * doit pas devenir illisible d'un coup.
 */
function lireValeur(brut, avecColonneType, typeLigne) {
  if (avecColonneType) {
    // La virgule décimale est acceptée : c'est le séparateur d'un Excel français.
    const normalise = brut.replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(normalise)) {
      return { erreur: `« ${brut} » n’est pas un nombre d’heures` };
    }
    return { heures: arrondir(Number(normalise)), type: typeLigne };
  }

  const trouve = /^(\d+(?:[.,]\d+)?)\|([PS])$/i.exec(brut);
  if (!trouve) return { erreur: `« ${brut} » non reconnue (attendu 5|P ou 2.5|S)` };

  return { heures: arrondir(Number(trouve[1].replace(',', '.'))), type: trouve[2].toUpperCase() };
}

/**
 * Applique des cellules relues à des plannings existants.
 *
 * ⚠️ FUSION : seules les cellules NOMMÉES bougent. Reconstruire le planning à
 * partir de la seule feuille effacerait tout ce qu'elle ne porte pas — et une
 * feuille de formateur n'en porte qu'une fraction.
 *
 * @returns {{plannings: object, ecrites: number, effacees: number, groupes: string[]}}
 */
export function fusionnerCellules(plannings, cellules) {
  const suivants = structuredClone(plannings ?? {});
  const touches = new Set();
  let ecrites = 0;
  let effacees = 0;

  for (const { groupe, code, semaine, heures, type } of cellules) {
    const planning = (suivants[groupe] ??= {});
    const module = (planning[code] ??= {});

    if (heures === null || heures === 0) {
      if (module[semaine] !== undefined) {
        delete module[semaine];
        effacees += 1;
        touches.add(groupe);
      }
      continue;
    }

    const avant = module[semaine];
    if (avant?.heures === heures && avant?.type === type) continue;

    module[semaine] = { heures, type };
    ecrites += 1;
    touches.add(groupe);
  }

  // Un module vidé de toutes ses semaines ne doit pas rester comme clé morte.
  for (const planning of Object.values(suivants)) {
    for (const [code, semaines] of Object.entries(planning)) {
      if (Object.keys(semaines).length === 0) delete planning[code];
    }
  }

  return { plannings: suivants, ecrites, effacees, groupes: [...touches].sort() };
}

/** « S1 » / « S2 » / « annuel » → « 1 » / « 2 » / « A », comme les badges. */
function abregerSemestre(semestre) {
  if (semestre === 'S1') return '1';
  if (semestre === 'S2') return '2';
  return 'A';
}

const arrondir = (valeur) => Math.round(Number(valeur ?? 0) * 100) / 100;
