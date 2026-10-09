/**
 * Traduit une semaine de l'établissement en problème d'optimisation abstrait.
 *
 * ═══ C'EST ICI QUE LE MÉTIER S'ARRÊTE ═══
 * Tout ce qui relève de l'OFPPT — fériés, vacances, stages, formations,
 * rentrées, groupes FQ, salles attribuées, distinction présentiel/synchrone —
 * est résolu dans ce fichier, en réutilisant le domaine JS. Ce qui part vers le
 * solveur n'est plus qu'une liste de créneaux numérotés et d'interdictions.
 *
 * ⚠️ FONCTION PURE : elle reçoit des données déjà chargées et ne touche pas la
 *    base. C'est ce qui la rend testable sans MongoDB — et c'est indispensable,
 *    parce qu'une interdiction oubliée ici ne produit aucune erreur : elle
 *    produit une grille que le serveur refusera ensuite, séance par séance,
 *    sans que personne ne comprenne pourquoi.
 */

import { JOURS, MOTIFS_INTERDICTION, PERIODES, SEANCES, TYPES_COURS } from 'shared/constants';
import {
  anneeDuNomGroupe,
  creneauAEviter,
  DUREE_SOIR,
  SEANCE_SOIR,
  groupesSeCroisent,
  indexerContraintes,
  SALLE_DISTANCIEL,
  SALLES_SANS_CONFLIT,
  separerFusion,
} from 'shared/domain';

/**
 * Les créneaux que la génération remplit.
 *
 * ⚠️ S1 À S4 SEULEMENT — LA GRILLE DU SOIR N'EST PAS GÉNÉRÉE, comme dans
 *    l'ancien. S5 est le créneau du soir, réservé aux groupes « CDS » ; il se
 *    saisit à la main. L'inclure ici poserait des cours du soir à des groupes
 *    de jour.
 */
export const CRENEAUX_GENERES = SEANCES.slice(0, 4);

/*
 * ═══ ⚠️ SAUF POUR LE COURS DU SOIR (CDS), DEPUIS LE 2026-10-09 ═══
 * Une tâche CDS de 2 h (`periode: soir`, voir `taches.js`) se pose sur la
 * grille du SOIR : un créneau par jour ouvert, de 2 h. Ces créneaux n'existent
 * dans le problème que si une telle tâche existe — sans elle, le problème est
 * celui d'avant, au caractère près.
 *
 * ⚠️ RANG 5, PAS 4 : le solveur tient pour voisins deux rangs qui se suivent,
 *    et il donnerait un bonus d'enchaînement à S4 + soir, qui ne se touchent pas.
 */
const RANG_SOIR = 5;
const SAMEDI = 'Samedi';
const cleSoir = (jour) => `${jour}||${SEANCE_SOIR}||${PERIODES.SOIR}`;
/** La clé d'une séance existante dans `cleVersId` : le soir a la sienne. */
const cleDeSeance = (seance) =>
  seance.periode === PERIODES.SOIR ? cleSoir(seance.jour) : `${seance.jour}||${seance.seance}`;

const normaliser = (valeur) => String(valeur ?? '').trim().toUpperCase();

/**
 * Les jours où ce groupe est en stage.
 *
 * ⚠️ COMPARAISON INSENSIBLE À LA CASSE ET AUX ESPACES : les stages se saisissent
 *    dans « Paramètres », les groupes viennent de la base e-note — une majuscule
 *    d'écart suffirait à ne jamais fermer le créneau, et la génération poserait
 *    un cours à un groupe parti en entreprise.
 */
function joursEnStage(jours, groupes) {
  const cherches = new Set(groupes.map(normaliser));
  return new Set(
    jours
      .filter((jour) => (jour.stages ?? []).some((stage) => cherches.has(normaliser(stage.groupe))))
      .map((jour) => jour.jour)
  );
}

/**
 * Les jours où ce formateur est en formation.
 *
 * ⚠️ ON APPARIE SUR LE MATRICULE D'ABORD, JAMAIS SUR UNE VALEUR VIDE. La
 *    comparaison de noms bidirectionnelle de l'existant rendait vrai pour
 *    `"AMMARI".includes("")` : une ligne de `formations` au nom vide rendait
 *    TOUS les formateurs indisponibles sur sa période, et la colonne est
 *    nullable. Défaut corrigé le 2026-08-14, à ne pas rouvrir.
 */
function joursEnFormation(jours, matricule, nom) {
  const cleMatricule = normaliser(matricule);
  const cleNom = normaliser(nom);

  return new Set(
    jours
      .filter((jour) =>
        (jour.formations ?? []).some((formation) => {
          const surMatricule = normaliser(formation.matricule);
          if (surMatricule && cleMatricule) return surMatricule === cleMatricule;
          const surNom = normaliser(formation.nom);
          return Boolean(surNom && cleNom && surNom === cleNom);
        })
      )
      .map((jour) => jour.jour)
  );
}

/**
 * Les jours gelés parce que ces groupes ne sont pas encore rentrés.
 *
 * ⚠️ LA RENTRÉE PORTE SUR UNE ANNÉE DE FORMATION, qui se lit dans le NOM du
 *    groupe (« DEVOWFS201 » → 2). L'ancien générateur ignorait complètement
 *    cette cause : elle n'existait pas encore. `poser()` la refuse côté
 *    serveur — sans ce filtre, chaque séance de septembre reviendrait en échec.
 *
 * ⚠️ DÈS QU'UN SEUL GROUPE N'EST PAS RENTRÉ, le créneau est fermé : une séance
 *    mutualisée couvre tout le monde à la fois.
 */
function joursAvantRentree(jours, groupes) {
  const annees = new Set(groupes.map((groupe) => anneeDuNomGroupe(groupe)).filter(Boolean));
  if (annees.size === 0) return new Set();

  return new Set(
    jours
      .filter((jour) =>
        (jour.rentreesGelees ?? []).some((gel) => annees.has(gel.anneeFormation))
      )
      .map((jour) => jour.jour)
  );
}

/**
 * Salles d'une tâche : celles où elle PEUT aller, et celles où elle DEVRAIT.
 *
 * ⚠️ UNE SÉANCE À DISTANCE NE PREND QUE « TEAMS ». C'est la seule règle qui
 *    reste ici de la distinction présentiel/synchrone ; le solveur, lui, ne
 *    connaît que `reelle: false`.
 *
 * ⚠️ UNE LISTE DE SALLES VIDE VEUT DIRE « TOUTES », comme dans l'ancien : c'est
 *    le cas normal d'un formateur à qui aucune salle n'est attribuée. Rendre une
 *    liste vide le priverait de tout créneau.
 *
 * ═══ ⚠️ LA SALLE DU MODULE L'EMPORTE SUR CELLE DU FORMATEUR ═══ (2026-09-23)
 * Décision du porteur. Un atelier de soudure est imposé par la MATIÈRE, pas par
 * la personne qui l'enseigne. Les salles déclarées sur l'affectation sont donc
 * autorisées **même si elles ne sont pas attribuées au formateur**.
 *
 * ═══ ⚠️⚠️ ET ELLE EST IMPOSÉE ═══ (décision du porteur, 2026-10-03)
 * La règle du 2026-09-23 en faisait une simple préférence : atelier pris, la
 * séance partait dans une autre salle. Renversée : un cours de soudure hors de
 * l'atelier n'est pas un cours de soudure. `possibles` se réduit donc aux
 * salles du module ; si elles sont toutes prises, la séance ressort NON PLACÉE
 * — visible au rapport — plutôt que posée dans un local qui ne convient pas.
 *
 * ⚠️ `preferees` VAUT LA MÊME LISTE : elle reste incluse dans `possibles` (ce
 *    que `lecture.py` exige), et la pénalité « hors salle » des deux moteurs
 *    ne peut plus jamais s'appliquer.
 *
 * ⚠️ LA RELANCE « TOUTES LES SALLES » LÈVE L'IMPOSITION, explicitement : c'est
 *    le seul moyen de passer outre, et c'est le directeur qui le décide.
 *
 * ⚠️ SANS SALLE DÉCLARÉE, `preferees` EST VIDE et `possibles` vaut exactement
 *    ce que cette fonction rendait avant : le comportement de toutes les cartes
 *    existantes est inchangé.
 */
function sallesDe(tache, index, sallesReelles, { toutesLesSalles = false } = {}) {
  if (tache.type === TYPES_COURS.SYNCHRONE) {
    return { possibles: [SALLE_DISTANCIEL], preferees: [] };
  }
  if (toutesLesSalles) return { possibles: sallesReelles, preferees: [] };

  const attribuees = (index.get(tache.formateurMatricule)?.espaces ?? []).filter((salle) =>
    sallesReelles.includes(salle)
  );
  const base = attribuees.length > 0 ? attribuees : sallesReelles;

  /*
   * ⚠️ FILTRÉES SUR LES SALLES RÉELLES : la carte s'enregistre pendant que le
   *    directeur crée ses espaces, et une salle déclarée puis supprimée
   *    resterait sinon dans la liste — le solveur poserait des séances dans un
   *    local qui n'existe plus.
   */
  const imposees = [
    ...new Set((tache.sallesModule ?? []).filter((salle) => sallesReelles.includes(salle))),
  ];
  if (imposees.length === 0) return { possibles: base, preferees: [] };

  return { possibles: imposees, preferees: imposees };
}

/**
 * Construit le problème envoyé au solveur.
 *
 * @param {object} entrees
 * @param {object} entrees.semaine — sortie de `seances.service.semaine()`
 * @param {Array}  entrees.taches — sortie de `tachesDeLaSemaine()`
 * @param {string[]} entrees.salles — `Etablissement.espaces`
 * @param {Array}  entrees.groupesFq
 * @param {Array}  entrees.contraintes — sortie de `contraintes.service.lister()`
 * @param {Array}  entrees.formateurs — `[{matricule, nom}]`, pour apparier les formations
 * @param {number} entrees.graine
 * @param {object} [entrees.assouplissement] — `{ignorerIndisponibilites, toutesLesSalles}`
 * @param {Array}  [entrees.aPreserver] — séances existantes à ne pas écraser (EFM, rattrapages)
 * @returns {{probleme: object, index: Map<string, object>}}
 */
export function construireProbleme({
  semaine,
  taches,
  salles = [],
  groupesFq = [],
  contraintes = [],
  formateurs = [],
  graine,
  assouplissement = {},
  aPreserver = [],
}) {
  /*
   * ⚠️ LES JOURS FERMÉS NE DEVIENNENT PAS DES CRÉNEAUX INTERDITS : ils
   *    n'existent pas. Un férié et des vacances ferment l'ÉTABLISSEMENT — les
   *    transmettre comme interdictions obligerait à les répéter sur chaque
   *    tâche, et le diagnostic dirait « créneau interdit » là où il faut dire
   *    « la semaine est fermée ».
   */
  const ouverts = joursOuverts(semaine);

  const creneaux = [];
  const blocs = [];
  const cleVersId = new Map();

  for (const jour of ouverts) {
    const ids = [];
    CRENEAUX_GENERES.forEach((seance, rang) => {
      const id = creneaux.length;
      creneaux.push({ id, jour: jour.jour, rang });
      cleVersId.set(`${jour.jour}||${seance}`, id);
      ids.push(id);
    });
    /*
     * ⚠️ [S1,S2] ET [S3,S4], MAIS PAS [S2,S3] : la pause déjeuner les sépare.
     *    C'est la règle de l'ancien (`pairs = [['S1','S2'], ['S3','S4']]`), et
     *    c'est pour cela que le solveur reçoit les blocs plutôt que de les
     *    deviner.
     */
    for (let depart = 0; depart + 1 < ids.length; depart += 2) {
      blocs.push([ids[depart], ids[depart + 1]]);
    }
  }

  if (taches.some((tache) => tache.periode === PERIODES.SOIR)) {
    for (const jour of ouverts) {
      const id = creneaux.length;
      creneaux.push({ id, jour: jour.jour, rang: RANG_SOIR, duree: DUREE_SOIR, periode: PERIODES.SOIR });
      cleVersId.set(cleSoir(jour.jour), id);
    }
  }

  const sallesReelles = salles.filter((salle) => !SALLES_SANS_CONFLIT.includes(salle));
  const declarees = [
    ...sallesReelles.map((nom) => ({ nom, reelle: true })),
    { nom: SALLE_DISTANCIEL, reelle: false },
  ];

  const index = indexerContraintes(contraintes);
  const nomDuFormateur = new Map(
    formateurs.map((formateur) => [String(formateur.matricule).trim(), formateur.nom])
  );

  const tachesSolveur = [];
  const parId = new Map();

  for (const tache of taches) {
    const enStage = joursEnStage(ouverts, tache.groupes);
    const enFormation = joursEnFormation(
      ouverts,
      tache.formateurMatricule,
      nomDuFormateur.get(tache.formateurMatricule)
    );
    const avantRentree = joursAvantRentree(ouverts, tache.groupes);

    const interdits = [];
    /*
     * ═══ ⚠️ CHAQUE INTERDICTION GARDE SON ORIGINE ═══ (2026-09-22)
     * Jusqu'ici cette boucle savait EXACTEMENT pourquoi elle fermait un
     * créneau — `enStage`, `enFormation`, `avantRentree`, `creneauAEviter` —
     * puis n'en poussait que le NUMÉRO. Python recevait une liste anonyme et
     * ne pouvait répondre que `creneau_interdit` : la cause n°1 mesurée sur
     * l'année réelle (163 séances sur 341), et la moins exploitable des
     * quatre, puisqu'elle envoie chercher dans quatre directions à la fois.
     *
     * ⚠️ ON N'AJOUTE AUCUNE CONTRAINTE : `creneauxInterdits` reste la liste
     *    plate que le solveur consomme telle quelle. Les motifs voyagent à
     *    côté, pour le seul diagnostic. La grille produite est identique —
     *    c'est ce qui rend ce changement vérifiable.
     */
    const parMotif = new Map();
    const interdire = (id, motif) => {
      interdits.push(id);
      const liste = parMotif.get(motif);
      if (liste) liste.push(id);
      else parMotif.set(motif, [id]);
    };
    /*
     * ═══ ⚠️ LES CONSIGNES DU FORMATEUR NE SONT PLUS DES INTERDICTIONS ═══
     *     (décision du porteur du 2026-09-21, appliquée côté Node le 2026-09-22)
     *
     * Python portait DÉJÀ toute la machinerie — `contrat.py` déclare
     * `creneaux_a_eviter`, `lecture.py` le lit, `cpsat.py` le pénalise
     * souplement — et ce fichier ne l'émettait nulle part : il rangeait ces
     * créneaux dans `creneauxInterdits`, en dur. **La fonctionnalité était du
     * code mort de bout en bout.**
     *
     * ⚠️ CE RENVERSEMENT ANNULE LA RÈGLE DU 2026-09-17 qui figurait ici même
     *    (« il n'y a personne pour arbitrer, la consigne doit être
     *    respectée »). Le porteur l'a rouverte le 21 avec une raison nouvelle,
     *    mesurée : traiter ces créneaux en dur coûtait 37 séances non placées
     *    — et 136 au relevé du 2026-09-22, les consignes saisies ayant grossi.
     *    **Une séance non placée n'est pas non plus arbitrée ; elle est
     *    perdue.**
     *
     * ⚠️ « ÉVITER » N'EST PAS « IGNORER » : le solveur ne s'y résout que s'il
     *    n'a rien d'autre (`_Palmares` côté glouton, pénalité côté CP-SAT).
     */
    const aEviter = [];
    /*
     * ═══ CRÉNEAUX DE SECOURS (2026-10-09, demande du porteur) ═══
     * Employés seulement à défaut de mieux, SANS être une indisponibilité :
     *  · cours du soir : le samedi soir, « en dernier recours » ;
     *  · cours de jour d'un groupe CDS : tout sauf le samedi, qu'il préfère.
     */
    const secours = [];
    const auSoir = tache.periode === PERIODES.SOIR;

    for (const jour of ouverts) {
      /*
       * ⚠️ UN JOUR PEUT CUMULER PLUSIEURS MOTIFS — un groupe avant sa rentrée
       *    ET en stage. On retient le plus STRUCTUREL, celui qui subsisterait
       *    si on levait les autres : la rentrée ferme tout, le stage ne
       *    concerne que le groupe, la formation que le formateur. Garder le
       *    premier venu dans l'ordre des tests aurait fait dépendre le
       *    diagnostic de l'ordre du code.
       */
      const motifDuJour = avantRentree.has(jour.jour)
        ? MOTIFS_INTERDICTION.RENTREE
        : enStage.has(jour.jour)
          ? MOTIFS_INTERDICTION.STAGE
          : enFormation.has(jour.jour)
            ? MOTIFS_INTERDICTION.FORMATION
            : null;

      const samedi = jour.jour === SAMEDI;

      // Le créneau du soir de ce jour, s'il existe : à la seule tâche du soir.
      const idSoir = cleVersId.get(cleSoir(jour.jour));
      if (idSoir !== undefined) {
        if (motifDuJour) interdire(idSoir, motifDuJour);
        // ⚠️ SANS MOTIF : ce n'est pas une cause, c'est une autre période — le
        //    diagnostic l'écarte sur `periode`, comme ci-dessous pour le jour.
        else if (!auSoir) interdits.push(idSoir);
        else if (samedi) secours.push(idSoir);
      }

      for (const seance of CRENEAUX_GENERES) {
        const id = cleVersId.get(`${jour.jour}||${seance}`);
        if (motifDuJour) {
          interdire(id, motifDuJour);
          continue;
        }
        if (auSoir) {
          interdits.push(id);
          continue;
        }
        if (tache.cds && !samedi) secours.push(id);
        /*
         * ═══ ⚠️ UN CRÉNEAU « À ÉVITER » EST INTERDIT ICI, ALORS QU'IL NE L'EST
         *     PAS À LA SAISIE ═══ (2026-09-17 : « en saisie manuelle un créneau
         *     à éviter ne se fige pas, il est signalé »). La divergence est
         *     voulue : à la main, une personne voit l'avertissement et décide en
         *     connaissance de cause ; automatiquement, il n'y a personne pour
         *     arbitrer — la consigne du formateur doit donc être respectée. La
         *     relance assouplie permet de passer outre, explicitement.
         */
        if (
          !assouplissement.ignorerIndisponibilites &&
          creneauAEviter(index, tache.formateurMatricule, jour.jour, seance)
        ) {
          aEviter.push(id);
        }
      }
    }

    /*
     * ⚠️ DEUX LISTES, PAS UNE : `possibles` est ce que le solveur a le droit
     *    d'employer, `preferees` ce qu'il DEVRAIT employer. Voir `sallesDe` —
     *    la salle du module y est IMPOSÉE (2026-10-03) : les deux listes la
     *    portent seule.
     */
    const salles = sallesDe(tache, index, sallesReelles, assouplissement);

    tachesSolveur.push({
      id: tache.id,
      formateur: tache.formateurMatricule,
      groupes: tache.groupes,
      seancesRequises: tache.seancesRequises,
      priorite: tache.priorite,
      /*
       * ⚠️ LA DIFFICULTÉ SE MESURE SUR CE QUI RESTE OUVERT à cette tâche, pas
       *    sur un quota horaire comme dans l'ancien (`hours / availableSlots`).
       *    Une tâche qui demande beaucoup dans peu de créneaux doit passer
       *    devant : c'est le seul rôle de ce nombre, et il départage à priorité
       *    égale.
       */
      /*
       * ⚠️ LES CRÉNEAUX « À ÉVITER » COMPTENT ICI, BIEN QU'ILS NE SOIENT PLUS
       *    INTERDITS (2026-09-22). Deux raisons, et la seconde est la plus
       *    importante :
       *    · une tâche dont il ne reste que des créneaux déconseillés EST plus
       *      difficile que la même sans consigne — c'est exactement ce que ce
       *      nombre sert à dire ;
       *    · ils étaient jusqu'ici DANS `interdits`. Les en retirer sans les
       *      recompter ici aurait allégé la difficulté de ces tâches, donc
       *      changé l'ordre de priorisation, donc la grille — un effet de bord
       *      que personne n'a demandé, par-dessus le changement voulu. Ainsi,
       *      la SEULE différence de comportement est le recours en dernier
       *      ressort.
       */
      difficulte:
        tache.seancesRequises /
        Math.max(1, creneaux.length - interdits.length - aEviter.length - secours.length),
      creneauxInterdits: interdits,
      /** Les mêmes identifiants, rangés par origine — pour le seul diagnostic. */
      motifsInterdiction: Object.fromEntries(parMotif),
      /** Consignes du formateur : évitées si possible, employées en dernier recours. */
      creneauxAEviter: aEviter,
      sallesPossibles: salles.possibles,
      /** Les salles du module : imposées, donc égales à `sallesPossibles` — voir `sallesDe`. */
      sallesPreferees: salles.preferees,
      periode: tache.periode ?? PERIODES.JOUR,
      creneauxSecours: secours,
    });

    parId.set(tache.id, tache);
  }

  /*
   * ═══ LES INCOMPATIBILITÉS VIENNENT DE `groupesSeCroisent` ═══
   * Fusions et groupes FQ compris : c'est la MÊME fonction que `detecterConflits`
   * emploie à l'écriture. En écrire une seconde ici produirait des grilles que le
   * serveur refuserait ensuite — ou, pire, laisserait passer deux cours pour la
   * même classe.
   */
  const tousGroupes = [
    ...new Set([
      ...taches.flatMap((tache) => tache.groupes),
      ...aPreserver.flatMap((seance) => separerFusion(seance.groupe)),
    ]),
  ];

  const incompatibilites = {};
  for (let i = 0; i < tousGroupes.length; i += 1) {
    for (let j = i + 1; j < tousGroupes.length; j += 1) {
      if (groupesSeCroisent(tousGroupes[i], tousGroupes[j], groupesFq)) {
        (incompatibilites[tousGroupes[i]] ??= []).push(tousGroupes[j]);
      }
    }
  }

  /*
   * ⚠️ LES SÉANCES PRÉSERVÉES OCCUPENT LEURS CRÉNEAUX. Une surveillance d'EFM
   *    ou un rattrapage que `poser()` verrouille doit être vu par le solveur :
   *    un placement proposé par-dessus serait refusé à l'écriture, et la séance
   *    ressortirait « non placée » pour une raison introuvable côté solveur.
   */
  const occupation = [];
  for (const seance of aPreserver) {
    const id = cleVersId.get(cleDeSeance(seance));
    // Jour fermé, S5 de jour, ou soir sans tâche du soir cette semaine.
    if (id === undefined) continue;
    occupation.push({
      creneauId: id,
      formateur: seance.formateurMatricule,
      groupes: separerFusion(seance.groupe),
      salle: SALLES_SANS_CONFLIT.includes(seance.salle) ? null : seance.salle || null,
    });
  }

  return {
    probleme: {
      graine,
      creneaux,
      blocs,
      salles: declarees,
      taches: tachesSolveur,
      incompatibilites,
      occupation,
    },
    index: parId,
    /** Pour traduire un `creneauId` en (jour, séance) au moment d'écrire. */
    creneauVersCase: new Map(
      creneaux.map((creneau) => [
        creneau.id,
        creneau.periode === PERIODES.SOIR
          ? { jour: creneau.jour, seance: SEANCE_SOIR, periode: PERIODES.SOIR }
          : { jour: creneau.jour, seance: CRENEAUX_GENERES[creneau.rang], periode: PERIODES.JOUR },
      ])
    ),
  };
}

/** Les jours que la génération ne peut pas remplir, et pourquoi. */
export function joursFermes(semaine) {
  return (semaine.jours ?? [])
    .filter((jour) => jour.ferie || jour.vacances)
    .map((jour) => ({
      jour: jour.jour,
      date: jour.date,
      motif: jour.ferie ? 'ferie' : 'vacances',
      libelle: jour.ferie?.libelle ?? '',
    }));
}

/**
 * Les jours que la génération peut remplir.
 *
 * ⚠️ UNE SEULE DÉFINITION DE « OUVERT » (2026-09-22). `construireProbleme`
 *    filtrait déjà `!ferie && !vacances` dans son coin ; le service, lui, ne
 *    testait que `taches.length === 0`. Une semaine ENTIÈREMENT fermée passait
 *    donc le garde, arrivait au solveur sans aucun créneau, et échouait sur
 *    « creneaux : au moins un créneau est attendu » — un message de Python, à
 *    un directeur. Mesuré sur l'année réelle : la S21 réclame **154 séances
 *    pour 0 créneau**.
 */
export function joursOuverts(semaine) {
  return (semaine.jours ?? []).filter((jour) => !jour.ferie && !jour.vacances);
}

/** Rappel : `JOURS` reste la référence d'ordre, même quand des jours sont fermés. */
export const ORDRE_JOURS = JOURS;
