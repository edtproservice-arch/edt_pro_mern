import { JOURS, PERIODES } from '../../constants/index.js';
import { SEANCES_JOUR, SEANCE_SOIR, dureeSeance } from './grille.js';
import { groupesSeCroisent } from './conflits.js';
import { enJour } from '../planning/jour.js';

/**
 * Lecture d'une semaine sous trois angles — formateur, groupe, SALLE.
 * ← `public/edition.html` : `displayGlobalSchedule()`, `findGroupData()`,
 *   `findSalleData()`, `displayTeacherSchedule()`
 *
 * ═══ ⚠️ CE N'EST PAS L'ASSEMBLAGE DE LA GRILLE D'ÉDITION ═══
 * `assemblerGrille` range une séance sur la ligne de son sujet EXACT : c'est ce
 * qu'il faut pour ÉCRIRE — on pose une séance là où on la déclare. Pour LIRE,
 * c'est faux :
 *
 *   - une FUSION « GM101 GM102 » n'apparaîtrait sur aucune des deux lignes,
 *     alors que les deux groupes ont bien cours ;
 *   - une SALLE n'est le sujet d'aucun index, alors qu'on veut savoir qui
 *     l'occupe ;
 *   - un même créneau peut porter PLUSIEURS séances pour un même sujet — deux
 *     surveillants d'un EFM partagent la salle et le groupe.
 *
 * D'où une seconde assemblée, qui rend une LISTE par case. C'est exactement ce
 * que faisaient `findGroupData` et `findSalleData` de l'existant, qui
 * parcouraient toutes les séances et joignaient les résultats par « / ».
 */

/** Les trois axes de lecture, et ce que chaque ligne d'une case y montre. */
export const AXES_CONSULTATION = {
  formateur: { libelle: 'Formateur', lignes: ['Groupe', 'Module', 'Salle'] },
  groupe: { libelle: 'Groupe', lignes: ['Formateur', 'Module', 'Salle'] },
  salle: { libelle: 'Espace', lignes: ['Formateur', 'Module', 'Groupe'] },
};

const normaliser = (valeur) => String(valeur ?? '').trim().toUpperCase();

/**
 * Cette séance concerne-t-elle ce sujet, sur cet axe ?
 *
 * ⚠️ SUR L'AXE GROUPE, L'APPARIEMENT EST PAR MEMBRE. `groupesCompares` connaît
 * déjà les deux règles : découper une fusion, et rapprocher « GE102 (GC) » de
 * « GE102 ». Les réécrire ici en ferait une seconde définition.
 *
 * ⚠️ MAIS SANS ÉLARGISSEMENT AUX GROUPES FQ, contrairement à la détection de
 * conflits. Un cours du FQ n'est pas un cours DE ses constituants : l'afficher
 * sur leur ligne compterait ses heures deux fois, et ferait lire un module que
 * le groupe ne suit pas sous ce nom-là.
 */
function concerne(seance, sujet, axe) {
  if (axe === 'formateur') return normaliser(seance.formateurMatricule) === normaliser(sujet);
  if (axe === 'salle') return normaliser(seance.salle) === normaliser(sujet);
  // Sans composition FQ : voir ci-dessus.
  return groupesSeCroisent(seance.groupe, sujet);
}

/**
 * La semaine de chaque sujet demandé.
 *
 * @param {object} parametres
 * @param {string[]} parametres.sujets   matricules, groupes ou salles
 * @param {Array} parametres.seances     les séances de la semaine
 * @param {string} parametres.axe        `formateur` | `groupe` | `salle`
 * @param {string} parametres.periode    `jour` | `soir`
 * @returns {Array<{sujet, heures, cases: Array<{jour, seance, seances: []}>}>}
 */
export function assemblerConsultation({
  sujets = [],
  seances = [],
  axe = 'formateur',
  periode = PERIODES.JOUR,
}) {
  const creneaux = periode === PERIODES.SOIR ? [SEANCE_SOIR] : SEANCES_JOUR;
  const retenues = seances.filter((seance) => (seance.periode ?? PERIODES.JOUR) === periode);

  return sujets.map((sujet) => {
    const siennes = retenues.filter((seance) => concerne(seance, sujet, axe));

    return {
      sujet,
      heures: arrondir(
        siennes
          .filter((seance) => seance.statut !== 'absent')
          .reduce((total, seance) => total + dureeSeance(seance.seance), 0)
      ),
      cases: JOURS.flatMap((jour) =>
        creneaux.map((creneau) => ({
          jour,
          seance: creneau,
          seances: siennes.filter((s) => s.jour === jour && s.seance === creneau),
        }))
      ),
    };
  });
}

/**
 * Ce qu'affiche une ligne d'une case, pour un axe donné.
 *
 * ⚠️ PLUSIEURS SÉANCES SE JOIGNENT PAR « / », comme dans l'existant : deux
 * surveillants d'un EFM partagent la salle, et n'en montrer qu'un ferait croire
 * la salle libre pour l'autre. Les doublons sont écartés — un même groupe
 * répété trois fois n'apprend rien.
 *
 * @param {Array} seances   les séances de la case
 * @param {string} ligne    `Groupe` | `Module` | `Salle` | `Formateur`
 * @param {Map} nomsFormateurs  matricule → nom, pour la ligne « Formateur »
 */
export function contenuLigne(seances = [], ligne, nomsFormateurs) {
  const valeurs = seances.map((seance) => {
    if (ligne === 'Formateur') {
      const matricule = String(seance.formateurMatricule ?? '').trim();
      return nomsFormateurs?.get(matricule) ?? matricule;
    }
    if (ligne === 'Groupe') return seance.groupe;
    if (ligne === 'Module') return seance.module;
    return seance.salle;
  });

  return [...new Set(valeurs.map((valeur) => String(valeur ?? '').trim()).filter(Boolean))].join(
    ' / '
  );
}

/**
 * Les sujets qui ont au moins une séance sur les jours ET les créneaux demandés.
 * ← le besoin exprimé par le porteur (2026-08-26) : « qui a des emplois lundi,
 *   ou bien mardi et jeudi… et le créneau aussi ».
 *
 * ═══ ⚠️ « OU » DANS UNE FACETTE, « ET » ENTRE LES DEUX ═══
 * Cocher lundi ET mardi demande « qui travaille l'un OU l'autre » — c'est ce
 * qu'on attend d'une liste à cocher, et l'inverse (les deux à la fois) ne
 * laisserait presque personne. En revanche, jour et créneau se COMBINENT : une
 * même séance doit tomber sur un jour retenu ET sur un créneau retenu, sinon
 * « lundi » + « S1 » rendrait ceux qui travaillent lundi... à n'importe quelle
 * heure.
 *
 * ⚠️ UNE FACETTE VIDE NE FILTRE RIEN, elle ne vide pas la liste : « aucun jour
 * coché » veut dire « tous les jours », jamais « aucun ».
 *
 * ⚠️ ET LES SÉANCES ABSENTES COMPTENT : la question est « a-t-il cours ce
 * jour-là ? », pas « l'a-t-il assuré ? ». Une absence est bien un créneau
 * occupé au planning.
 */
export function filtrerSujets(sujets = [], seances = [], axe = 'formateur', filtre = {}) {
  const jours = new Set(filtre.jours ?? []);
  const creneaux = new Set(filtre.creneaux ?? []);

  if (jours.size === 0 && creneaux.size === 0) return [...sujets];

  return sujets.filter((sujet) =>
    seances.some(
      (seance) =>
        (jours.size === 0 || jours.has(seance.jour)) &&
        (creneaux.size === 0 || creneaux.has(seance.seance)) &&
        concerne(seance, sujet, axe)
    )
  );
}

/**
 * Les groupes qui répondent aux trois facettes de la CARTE : filière, niveau
 * (T, TS, Q…) et année de formation.
 * ← demande du porteur, 2026-08-26.
 *
 * ═══ ⚠️ CES TROIS-LÀ NE SE LISENT PAS DANS LES SÉANCES ═══
 * `filtrerSujets` interroge le PLANNING — « qui a cours le lundi ». Celles-ci
 * interrogent l'IDENTITÉ du groupe, qui vit dans la carte d'établissement : le
 * code filière porté par ses affectations, le niveau que la répartition DRIF
 * attache à ce code, l'année lue dans le numéro du groupe. Un groupe SANS aucune
 * séance de la semaine reste donc filtrable — c'est même le cas qu'on cherche
 * quand on se demande si une promotion a été oubliée.
 *
 * ⚠️ MÊME GRAMMAIRE QUE `filtrerSujets` : « OU » à l'intérieur d'une facette,
 * « ET » entre les facettes, et une facette vide ne filtre RIEN. Deux règles
 * différentes sur la même rangée de filtres seraient impossibles à deviner.
 *
 * ⚠️ UN GROUPE DONT L'ATTRIBUT EST INCONNU est écarté dès que la facette
 * correspondante est cochée — jamais gardé « au cas où ». Le laisser passer sous
 * « TS » alors qu'on ignore son niveau ferait lire une liste fausse ; absent, on
 * voit tout de suite qu'il manque et on va corriger sa carte.
 *
 * @param {string[]} groupes
 * @param {Map<string, {filiere?: string, niveau?: string, annee?: number}>|object} identites
 * @param {{filieres?: string[], niveaux?: string[], annees?: Array<number|string>}} facettes
 */
export function filtrerGroupes(groupes = [], identites = new Map(), facettes = {}) {
  const jeu = (valeurs) => new Set((valeurs ?? []).map((v) => String(v).trim()).filter(Boolean));
  const filieres = jeu(facettes.filieres);
  const niveaux = jeu(facettes.niveaux);
  const annees = jeu(facettes.annees);

  if (filieres.size === 0 && niveaux.size === 0 && annees.size === 0) return [...groupes];

  const lire = (groupe) =>
    identites instanceof Map ? identites.get(groupe) : identites?.[groupe];

  return groupes.filter((groupe) => {
    const identite = lire(groupe) ?? {};
    const valeur = (champ) => String(identite[champ] ?? '').trim();

    return (
      (filieres.size === 0 || filieres.has(valeur('filiere'))) &&
      (niveaux.size === 0 || niveaux.has(valeur('niveau'))) &&
      (annees.size === 0 || annees.has(valeur('annee')))
    );
  });
}

/**
 * Les valeurs réellement présentes, pour ne proposer que des cases utiles.
 *
 * ⚠️ ON NE PROPOSE PAS LES SEPT NIVEAUX DU RÉFÉRENTIEL. Un établissement n'en
 * porte que deux ou trois : offrir « BP » et « PC » à qui n'en a aucun donne des
 * cases qui ne rendent jamais rien, et fait douter du filtre plutôt que des
 * données.
 *
 * ⚠️ LES FILIÈRES SONT TRIÉES PAR LIBELLÉ, pas par code : c'est le libellé qu'on
 * lit. Les niveaux suivent l'ordre du référentiel, du plus court au plus long
 * cursus — un ordre alphabétique mettrait « Q » entre « PC » et « S », ce qui ne
 * veut rien dire.
 */
export function facettesDesGroupes(groupes = [], identites = new Map()) {
  const lire = (groupe) =>
    (identites instanceof Map ? identites.get(groupe) : identites?.[groupe]) ?? {};

  const filieres = new Map();
  const niveaux = new Set();
  const annees = new Set();

  for (const groupe of groupes) {
    const identite = lire(groupe);
    const filiere = String(identite.filiere ?? '').trim();
    const niveau = String(identite.niveau ?? '').trim();
    const annee = String(identite.annee ?? '').trim();

    if (filiere !== '') {
      filieres.set(filiere, String(identite.filiereLibelle ?? '').trim() || filiere);
    }
    if (niveau !== '') niveaux.add(niveau);
    if (annee !== '') annees.add(annee);
  }

  return {
    filieres: [...filieres]
      .map(([valeur, libelle]) => ({ valeur, libelle }))
      .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')),
    niveaux: ORDRE_NIVEAUX.filter((niveau) => niveaux.has(niveau)).concat(
      [...niveaux].filter((niveau) => !ORDRE_NIVEAUX.includes(niveau)).sort()
    ),
    annees: [...annees].sort((a, b) => Number(a) - Number(b)),
  };
}

/**
 * L'ordre des niveaux de la répartition DRIF, du cursus le plus court au plus
 * long. Relevé sur le référentiel réel : sept valeurs.
 */
export const ORDRE_NIVEAUX = ['FQ', 'S', 'Q', 'PC', 'BP', 'T', 'TS'];

/** Ce qu'un sigle de niveau veut dire — il n'est parlant que pour l'habitué. */
export const LIBELLES_NIVEAUX = {
  FQ: 'Formation qualifiante',
  S: 'Spécialisation',
  Q: 'Qualification',
  PC: 'Préparation aux concours',
  BP: 'Brevet professionnel',
  T: 'Technicien',
  TS: 'Technicien spécialisé',
};

/**
 * Les salles réellement occupées dans une semaine, plus celles de
 * l'établissement.
 *
 * ⚠️ UNE SALLE PEUT AVOIR DISPARU DES ESPACES et porter encore des séances :
 * l'omettre ferait disparaître ces heures de toute lecture. On réunit donc les
 * deux sources.
 *
 * ⚠️ « TEAMS » ET « ABSENT » N'EN SONT PAS. Le premier désigne une séance à
 * distance, le second n'a jamais été une salle : les lister ferait une ligne
 * « occupation » pour un local qui n'existe pas.
 */
export function sallesDeLaSemaine(espaces = [], seances = []) {
  const exclues = new Set(['TEAMS', 'ABSENT', '']);

  const toutes = new Set(
    [...espaces, ...seances.map((seance) => seance.salle)]
      .map((salle) => String(salle ?? '').trim())
      .filter((salle) => !exclues.has(salle.toUpperCase()))
  );

  return [...toutes].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
}

/**
 * L'emploi du temps d'UN sujet, groupé en BLOCS — pour une vue « agenda »,
 * un jour après l'autre, plutôt qu'un tableau.
 * ← `mergeConsecutiveSessions()` de `public/emploiStagiaire.html`, ADAPTÉE
 *   (2026-09-04, demande du porteur : « ajouter un autre mode de vue comme
 *   celui dans l'ancien edtpro »).
 *
 * ═══ ⚠️ LA FUSION SE FAIT SUR LA CONTIGUÏTÉ DES CRÉNEAUX, PAS DE L'HORLOGE ═══
 * L'existant fusionnait deux séances dont `heure_fin` de l'une égalait
 * `heure_debut` de l'autre — ce projet ne modélise AUCUNE heure d'horloge,
 * seulement des créneaux numérotés (S1..S5, cf. §6 du plan) : la contiguïté se
 * lit donc dans `SEANCES_JOUR`, pas dans une chaîne « 11:00 ». Deux créneaux
 * voisins qui portent EXACTEMENT le même contenu (module, salle, et l'autre
 * sujet — groupe ou formateur) forment un seul bloc ; sinon, chacun reste le
 * sien. C'est le même critère que l'existant (même groupe, temps contigu),
 * transposé au seul vocabulaire que ce projet connaît.
 *
 * ⚠️ JAMAIS À TRAVERS LE SOIR : S4 et S5 (`SEANCE_SOIR`) ne sont pas contigus —
 * ce sont deux services distincts, matin/après-midi contre soir.
 *
 * ═══ ⚠️⚠️ REVIENT SUR « AUCUNE HEURE D'HORLOGE » (2026-09-04, demande
 * explicite du porteur, capture de l'ancien produit à l'appui) ═══
 * `debut`/`fin`/`pauses` reprennent EXACTEMENT `get_formateur_timetable.php`
 * et `get_stagiaire_timetable.php` — les DEUX seuls endroits de l'ancien
 * produit qui savaient traduire un créneau en heure d'horloge, vérifiés
 * identiques entre eux. Ce ne sont pas des heures inventées : elles sont
 * lues dans le code de production dont ce projet migre le comportement.
 * ⚠️ LE VENDREDI PORTE UN HORAIRE À PART — la pause de la prière de midi
 * décale S3 et S4, et raccourcit S1/S2. Les autres jours (Lundi, Mardi,
 * Mercredi, Jeudi, Samedi) partagent le même horaire standard.
 *
 * ⚠️ `heures` EST LE MÊME TOTAL QUE LA BANDE DE `GrilleDetaillee` — celui que
 * rend déjà `assemblerConsultation` pour ce sujet, sur toute la semaine. Deux
 * calculs auraient pu diverger d'une heure d'absence oubliée ; celui-ci est
 * juste RENDU, pas refait (demande du porteur, 2026-09-04 : « je veux que
 * cette bande en agenda affiche le nb d'heure de la semaine … comme celui
 * dans vue tableau »).
 *
 * @param {object} parametres
 * @param {string} parametres.sujet
 * @param {Array} parametres.seances
 * @param {string} parametres.axe  `formateur` | `groupe`
 * @param {Map} [parametres.nomsFormateurs]
 * @returns {{heures: number, jours: Array<{jour: string, blocs: Array}>}}
 */
export function agendaDuSujet({ sujet, seances = [], axe = 'formateur', nomsFormateurs }) {
  const [jour] = assemblerConsultation({ sujets: [sujet], seances, axe, periode: PERIODES.JOUR });
  const [soir] = assemblerConsultation({ sujets: [sujet], seances, axe, periode: PERIODES.SOIR });
  const aDuSoir = soir.cases.some((c) => c.seances.length > 0);
  const toutesLesCases = aDuSoir ? [...jour.cases, ...soir.cases] : jour.cases;

  // ⚠️ L'AUTRE SUJET, PAS LE SIEN : sur l'axe formateur on lit le GROUPE de la
  // case, sur l'axe groupe on lit son FORMATEUR — jamais le sujet qu'on affiche
  // déjà en tête de bloc.
  const ligneAutreSujet = axe === 'groupe' ? 'Formateur' : 'Groupe';

  const jours = JOURS.map((leJour) => {
    const casesDuJour = toutesLesCases.filter((c) => c.jour === leJour && c.seances.length > 0);

    const blocs = [];
    for (const c of casesDuJour) {
      const signature = [
        contenuLigne(c.seances, 'Module'),
        contenuLigne(c.seances, ligneAutreSujet, nomsFormateurs),
        contenuLigne(c.seances, 'Salle'),
        // ⚠️ Un RATTRAPAGE ne fusionne pas avec le cours ordinaire qui le suit
        // (2026-09-14) : le bloc porterait sinon la marque ↺ sur des heures qui
        // ne rattrapent rien.
        c.seances.some((s) => s.statut === 'rattrape') ? 'rattrapage' : '',
      ].join('||');

      const precedent = blocs.at(-1);
      const dernierCreneau = precedent?.creneaux.at(-1);
      const contigu =
        precedent &&
        dernierCreneau !== SEANCE_SOIR &&
        c.seance !== SEANCE_SOIR &&
        SEANCES_JOUR.indexOf(c.seance) === SEANCES_JOUR.indexOf(dernierCreneau) + 1;

      if (precedent && contigu && precedent.signature === signature) {
        precedent.creneaux.push(c.seance);
        precedent.seances.push(...c.seances);
      } else {
        blocs.push({ creneaux: [c.seance], seances: [...c.seances], signature });
      }
    }

    return {
      jour: leJour,
      blocs: blocs.map(({ creneaux, seances: seancesDuBloc }) => {
        // Une séance ABSENTE ne compte pas comme assurée : le cours n'a pas eu
        // lieu. Même règle que la cellule du tableau — et donc aucune heure
        // à créditer pour un bloc entièrement absent.
        const absente = seancesDuBloc.every((s) => s.statut === 'absent');

        return {
          creneaux,
          debut: horaireCreneau(leJour, creneaux[0]).debut,
          fin: horaireCreneau(leJour, creneaux.at(-1)).fin,
          // L'horaire de CHAQUE créneau du bloc (2026-09-12, « style en cours »)
          // : `debut`/`fin` bornent le bloc, mais seul le détail dit QUEL
          // créneau se déroule maintenant — et, le Vendredi, qu'on est dans
          // l'écart réel de la prière plutôt que dans un cours.
          horaires: creneaux.map((creneau) => horaireCreneau(leJour, creneau)),
          // ⚠️ UNE PAUSE PAR FRONTIÈRE INTERNE, PAS UNE VRAIE MESURE : dans
          // l'horaire officiel, S1 s'arrête exactement quand S2 commence (zéro
          // écart). L'ancien produit affichait pourtant une pause « décorative »
          // entre deux créneaux fusionnés — c'est elle qu'on reproduit,
          // `libellePause` porte la même règle, y compris le cas spécial de la
          // pause déjeuner (S3 à 13:30 → « 30 min », pas 15).
          pauses: creneaux.slice(1).map((creneau) => libellePause(leJour, creneau)),
          heures: absente
            ? 0
            : arrondir(creneaux.reduce((total, creneau) => total + dureeSeance(creneau), 0)),
          module: contenuLigne(seancesDuBloc, 'Module'),
          autreSujet: contenuLigne(seancesDuBloc, ligneAutreSujet, nomsFormateurs),
          salle: contenuLigne(seancesDuBloc, 'Salle'),
          absente,
          // Le bloc rattrape une absence (2026-09-14) — l'agenda le marque ↺.
          rattrapage: seancesDuBloc.some((s) => s.statut === 'rattrape'),
          aDistance: String(seancesDuBloc[0]?.salle ?? '').toUpperCase() === 'TEAMS',
          efm: Boolean(seancesDuBloc[0]?.estEfm),
          /*
           * Ce qui désigne la SÉANCE auprès du serveur — l'appel des stagiaires
           * depuis la carte (F9, 2026-09-14) : son libellé de groupe TEL QU'ÉCRIT
           * (« GM101 GM102 » pour une fusion) et sa période. Le critère de
           * fusion garantit qu'ils sont les mêmes sur tout le bloc, et un bloc
           * ne traverse jamais le soir.
           */
          groupeSeance: String(seancesDuBloc[0]?.groupe ?? ''),
          periode: seancesDuBloc[0]?.periode ?? PERIODES.JOUR,
        };
      }),
    };
  });

  return { heures: arrondir(jour.heures + soir.heures), jours };
}

/**
 * Créneau → heure d'horloge, « HH:MM ».
 * ← `get_formateur_timetable.php:189-208` et `get_stagiaire_timetable.php:84-86`
 *   (les deux tables sont identiques, vérifié).
 */
const HORAIRES_STANDARD = {
  S1: ['08:30', '11:00'],
  S2: ['11:00', '13:30'],
  S3: ['13:30', '16:00'],
  S4: ['16:00', '18:30'],
  S5: ['19:00', '21:00'],
};

/**
 * Vendredi : la prière de midi décale S3/S4 et raccourcit S1/S2.
 *
 * ⚠️ S3 REPRISE À 14:30 (2026-09-05, confirmé par le porteur après une
 * première correction à 14:20, elle-même corrigée dans la foulée) — c'est
 * exactement la valeur de `get_formateur_timetable.php:193`, et elle donne
 * un écart de midi de deux heures PILE (12:30 → 14:30), cohérent avec le
 * libellé « Pause 2h » de `libellePause`.
 */
const HORAIRES_VENDREDI = {
  S1: ['08:30', '10:30'],
  S2: ['10:30', '12:30'],
  S3: ['14:30', '16:30'],
  S4: ['16:30', '18:30'],
  S5: ['19:00', '21:00'],
};

export function horaireCreneau(jour, creneau) {
  const table = jour === 'Vendredi' ? HORAIRES_VENDREDI : HORAIRES_STANDARD;
  const [debut, fin] = table[creneau] ?? ['00:00', '00:00'];
  return { debut, fin };
}

/**
 * L'instant présent, en heure LOCALE : `{ date: 'AAAA-MM-JJ', heure: 'HH:MM' }`.
 * Jamais `toISOString()`, qui passe par UTC et rend la veille pour tout ce qui
 * suit minuit au Maroc. Le zéro de tête rend l'ordre alphabétique chronologique.
 */
export function instantLocal(d = new Date()) {
  const deux = (n) => String(n).padStart(2, '0');
  return {
    date: enJour(d),
    heure: `${deux(d.getHours())}:${deux(d.getMinutes())}`,
  };
}

/**
 * Une séance est-elle TERMINÉE à cet instant ? (2026-09-12, demande du porteur :
 * « pour l'avancement eDTpro, afficher l'avancement des séances terminées ».)
 *
 * ⚠️ C'EST LA RÈGLE DE L'AGENDA, pas une seconde : un jour passé est terminé,
 * un jour à venir ne l'est pas, et le jour même la séance l'est dès que son
 * horaire OFFICIEL est échu (`fin <= heure`) — exactement le badge « Terminé »
 * de « Mon emploi du temps ». Deux définitions feraient dire « Terminé » à une
 * carte dont l'avancement n'aurait pas encore compté les heures.
 *
 * ⚠️ L'HORAIRE DÉPEND DU JOUR : le Vendredi, S2 finit à 12:30 et non à 13:30.
 *
 * @param {{date?: Date|string, jour?: string, seance?: string}} seance
 * @param {{date: string, heure: string}} maintenant
 */
export function seanceTerminee(seance, maintenant) {
  /* ⚠️ `new Date()` AVANT `enJour`, jamais la chaîne telle quelle : une date
     sérialisée (« 2026-08-30T23:00:00Z ») lue par son préfixe rendrait le jour
     UTC, soit la VEILLE au Maroc. */
  const jour = enJour(seance?.date ? new Date(seance.date) : null);
  if (!jour || !maintenant?.date) return false;
  if (jour < maintenant.date) return true;
  if (jour > maintenant.date) return false;
  return horaireCreneau(seance.jour, seance.seance).fin <= maintenant.heure;
}

/** « 11:00 » + 15 → « 11h15 ». ← `addMinutes()` de l'ancien produit — sans
 *  zéro de tête sur l'heure, telle quelle. */
function ajouterMinutes(heure, minutes) {
  const [h, m] = heure.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
}

/**
 * Le libellé d'une pause ENTRE deux créneaux fusionnés.
 * ← `getPauseLabel()` de l'ancien produit, GÉNÉRALISÉ (2026-09-05) : S3 est
 *   TOUJOURS la reprise du déjeuner, quel que soit le jour — mais ce n'est
 *   PAS la même pause partout.
 *
 * ⚠️⚠️ LE VENDREDI N'EST PAS UNE VARIANTE DÉCORATIVE, C'EST UN VRAI ÉCART
 * (2026-09-05, demande du porteur, corrigeant la première généralisation) —
 * entre S1/S2, et entre S3/S4, le créneau suivant commence PILE quand le
 * précédent finit, TOUS les jours : la pause de 15 min y est une pure
 * décoration, et sa reprise n'a pas d'importance réelle. Entre S2 et S3, ce
 * n'est vrai QUE le jour standard (13:30 → 13:30, zéro écart, d'où la
 * décoration « 30 min »). Le Vendredi, la prière de midi ouvre un écart
 * RÉEL de deux heures PILE (12:30 → 14:30) : lui donner la même étiquette
 * « 30 min » que le jour standard aurait été aussi faux que le défaut
 * précédent (qui, lui, appliquait par erreur le libellé DÉCORATIF de 15 min
 * — « reprise 14h45 » — à cette même frontière).
 */
function libellePause(jour, creneauSuivant) {
  const { debut } = horaireCreneau(jour, creneauSuivant);
  if (creneauSuivant === 'S3') {
    const duree = jour === 'Vendredi' ? '2h' : '30 min';
    return `Pause ${duree} · reprise ${ajouterMinutes(debut, 0)}`;
  }
  return `Pause 15 min · reprise ${ajouterMinutes(debut, 15)}`;
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
