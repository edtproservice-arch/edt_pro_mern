/**
 * Bilan offre / demande de la carte d'établissement.
 * ← computeOffreDemande() dans public/assets/js/affectation-carte.js:2453-2600
 *
 * Deux grandeurs, souvent confondues, et que l'écran doit distinguer :
 *
 *   OFFRE   — ce que les formateurs PEUVENT assurer (masse statutaire annuelle)
 *             face à ce qui leur est réellement affecté.
 *   DEMANDE — ce que les groupes DOIVENT suivre (heures des modules) face à ce
 *             qui est effectivement couvert par un formateur.
 *
 * ═══ LA RÈGLE QUI COMPTE : LE SYNCHRONE EST MUTUALISÉ ═══
 * Une séance synchrone est donnée une fois pour plusieurs groupes. Elle pèse
 * donc UNE FOIS sur la charge du formateur, mais couvre CHACUN des groupes.
 * Compter ses heures autant de fois qu'il y a de groupes gonflerait la charge
 * du formateur et ferait croire à une surcharge inexistante.
 */

/** Arrondi au centième — les masses horaires DRIF ont des demi-heures. */
function heures(valeur) {
  const nombre = Number.parseFloat(valeur);
  return Number.isFinite(nombre) ? Math.round(nombre * 100) / 100 : 0;
}

function cle(valeur) {
  return String(valeur ?? '')
    .trim()
    .toUpperCase();
}

function taux(numerateur, denominateur) {
  return denominateur > 0 ? Math.round((numerateur / denominateur) * 100) : 0;
}

/**
 * Un ensemble = une filière, une année de formation ET un mode.
 *
 * ═══ POURQUOI LE MODE FAIT PARTIE DE LA CLÉ ═══
 * Un groupe alterné ou par apprentissage passe une partie de l'année en
 * entreprise : ses masses horaires diffèrent de celles d'un groupe résidentiel
 * de la même filière. Les afficher dans la même matrice mêlait deux réalités —
 * une colonne aux heures ajustables à côté d'une colonne figée — et laissait
 * croire qu'une séance synchrone pouvait les mutualiser, ce qu'un rythme
 * d'alternance différent interdit.
 */
export function cleEnsemble(groupe) {
  return `${groupe?.codeFiliere ?? ''}||${groupe?.anneeFormation ?? ''}||${groupe?.mode ?? ''}`;
}

/**
 * Regroupe les groupes par ensemble filière / année.
 * ← buildEnsembles()
 *
 * C'est la maille de travail de la carte : les groupes d'un même ensemble
 * suivent les mêmes modules, et c'est à ce niveau que l'affectation se fait en
 * masse.
 */
export function construireEnsembles(groupes = []) {
  const ensembles = new Map();

  for (const groupe of groupes) {
    const identifiant = cleEnsemble(groupe);

    if (!ensembles.has(identifiant)) {
      ensembles.set(identifiant, {
        cle: identifiant,
        codeFiliere: groupe.codeFiliere ?? '',
        intituleFiliere: groupe.intituleFiliere ?? '',
        anneeFormation: groupe.anneeFormation ?? 1,
        mode: groupe.mode ?? '',
        groupes: [],
        modules: [],
      });
    }

    const ensemble = ensembles.get(identifiant);
    ensemble.groupes.push(groupe);

    // Les modules de l'ensemble : l'union de ceux de ses groupes. Un module
    // retiré d'un seul groupe doit rester visible pour les autres.
    for (const module of groupe.modules ?? []) {
      const codeModule = module.code || module.nom;
      if (!ensemble.modules.some((connu) => (connu.code || connu.nom) === codeModule)) {
        ensemble.modules.push(module);
      }
    }
  }

  return [...ensembles.values()].sort(
    (a, b) =>
      a.intituleFiliere.localeCompare(b.intituleFiliere, 'fr') ||
      a.anneeFormation - b.anneeFormation ||
      a.mode.localeCompare(b.mode, 'fr')
  );
}

/** Heures présentielles d'un module. */
export function heuresPresentiel(module) {
  return heures((module?.mhpS1 ?? 0) + (module?.mhpS2 ?? 0));
}

/** Heures synchrones d'un module. */
export function heuresSynchrone(module) {
  return heures((module?.mhsynS1 ?? 0) + (module?.mhsynS2 ?? 0));
}

/**
 * Semestre où le module est dispensé : `'S1'`, `'S2'`, `'annuel'` ou `null`.
 *
 * ═══ POURQUOI CE N'EST PAS LISIBLE SUR L'ÉCRAN SANS ÇA ═══
 * Les heures sont bien affichées — « S1 140 h · S2 0 h » — mais il faut LIRE
 * deux nombres et en tirer une conclusion, module par module. Sur vingt lignes,
 * personne ne le fait. Le semestre est une propriété du module : il se nomme.
 *
 * ⚠️ Le total d'un semestre inclut le SYNCHRONE. Un module sans présentiel mais
 * avec vingt heures à distance au second semestre est un module du S2 : ne
 * regarder que `mhp*` le laisserait sans badge, comme s'il n'était pas dispensé.
 *
 * @param {object} module
 * @returns {'S1'|'S2'|'annuel'|null} `null` quand le module ne porte aucune
 *   heure — il n'y a alors rien à annoncer, et un badge « annuel » serait faux.
 */
export function semestreModule(module) {
  const s1 = heures((module?.mhpS1 ?? 0) + (module?.mhsynS1 ?? 0));
  const s2 = heures((module?.mhpS2 ?? 0) + (module?.mhsynS2 ?? 0));

  if (s1 > 0 && s2 > 0) return 'annuel';
  if (s1 > 0) return 'S1';
  if (s2 > 0) return 'S2';
  return null;
}

/**
 * Identité d'une SÉANCE synchrone — ce qui ne se compte qu'une fois.
 *
 * ═══ C'EST LA FUSION QUI FAIT LA SÉANCE, PAS LE FORMATEUR ═══
 * (corrigé le 2026-08-19)
 *
 * La première version dédoublonnait sur `(ensemble, module, formateur)`. Elle
 * était juste tant qu'un formateur ne donnait qu'une séance par module — mais
 * l'écran permet d'en ajouter plusieurs, et rien n'oblige à changer de
 * formateur entre elles : dix groupes ne tiennent pas dans une classe Teams, et
 * la même personne peut assurer deux séances de suite.
 *
 * Le cas réel : BRAHIM LOURID, Arabe synchrone, GM101 sur une séance et GM102
 * sur une autre. Ce sont DEUX séances — les groupes ne sont pas fusionnés — donc
 * deux fois 5 h. L'ancienne clé les confondait et n'en comptait que 5 : la
 * moitié de sa charge disparaissait du bilan, et il apparaissait disponible
 * alors qu'il ne l'était pas.
 *
 * ⚠️ `groupeFusion` VIDE ne veut pas dire « inconnu », il veut dire « fusionné
 * avec personne » — c'est ce qu'écrit `definirLignesSynchrone` pour une ligne à
 * un seul groupe, et ce que restitue la reconstruction quand l'affectation ne
 * porte qu'un groupe. On retombe alors sur le nom du groupe, qui EST l'identité
 * de cette séance-là.
 */
function empreinteSeance(cleDEnsemble, groupe, module) {
  const fusion = String(module.groupeFusion ?? '').trim() || groupe.nom;
  return `${cleDEnsemble}||${module.code || module.nom}||${cle(
    module.formateurSynchrone
  )}||${fusion}`;
}

/**
 * Un module désactivé est-il à ignorer ?
 *
 * `actif` absent vaut ACTIF : les modules issus de la répartition DRIF n'ont pas
 * ce champ, et les traiter comme désactivés viderait la carte.
 */
export function estActif(module) {
  return module?.actif !== false;
}

/**
 * État d'avancement d'une affectation.
 * ← getAssignmentStateClass() : `is-full` / `is-partial` / rien
 *
 * Trois états seulement, et la nuance qui compte est entre `vide` et `partiel` :
 * un groupe sans aucune affectation n'a peut-être pas encore été traité, alors
 * qu'un groupe partiel a été commencé puis laissé en plan. Les confondre en
 * « incomplet » ferait perdre cette distinction, la seule qui dise où reprendre.
 *
 * @returns {'complet'|'partiel'|'vide'}
 */
export function etatAffectation(affectes, total) {
  if (!total || !affectes) return 'vide';
  return affectes >= total ? 'complet' : 'partiel';
}

/**
 * Charge de chaque formateur, ventilée par semestre.
 * ← computeFormateurLoads() dans affectation-carte.js:2402-2436
 *
 * Sert aux libellés des sélecteurs : le directeur doit voir, au moment où il
 * choisit, ce que la personne porte déjà. Sans cela il affecte à l'aveugle et
 * découvre la surcharge à la fin.
 *
 * Le synchrone n'est compté qu'une fois par (ensemble, module, formateur) —
 * même règle que `calculerBilan`, et pour la même raison.
 *
 * @returns {Map<string, {s1, s2, total, regional}>} indexée par nom en majuscules
 */
export function calculerCharges(groupes = []) {
  const charges = new Map();
  const synchronesComptes = new Set();

  const ajouter = (nom, s1, s2, regional) => {
    const identifiant = cle(nom);
    if (identifiant === '') return;

    const courante = charges.get(identifiant) ?? { s1: 0, s2: 0, total: 0, regional: 0 };
    courante.s1 = heures(courante.s1 + s1);
    courante.s2 = heures(courante.s2 + s2);
    courante.total = heures(courante.s1 + courante.s2);
    if (regional) courante.regional += 1;

    charges.set(identifiant, courante);
  };

  for (const ensemble of construireEnsembles(groupes)) {
    for (const groupe of ensemble.groupes) {
      for (const module of groupe.modules ?? []) {
        if (!estActif(module)) continue;

        if (module.formateurPresentiel) {
          ajouter(module.formateurPresentiel, module.mhpS1 ?? 0, module.mhpS2 ?? 0, module.estRegional);
        }

        if (module.formateurSynchrone) {
          const empreinte = empreinteSeance(ensemble.cle, groupe, module);

          if (!synchronesComptes.has(empreinte)) {
            synchronesComptes.add(empreinte);
            ajouter(module.formateurSynchrone, module.mhsynS1 ?? 0, module.mhsynS2 ?? 0, false);
          }
        }
      }
    }
  }

  return charges;
}

/**
 * Bilan complet de la carte.
 *
 * @param {{groupes: Array, formateurs: Array}} carte
 * @returns {{offre: {statutaire, affecte, taux},
 *            demande: {total, couvert, taux},
 *            metiers: Array, formateurs: Array, besoin: number}}
 */
export function calculerBilan({ groupes = [], formateurs = [] } = {}) {
  const metiers = new Map();
  const charges = new Map(); // nom de formateur → heures affectées

  let demandeTotale = 0;
  let demandeCouverte = 0;
  let offreAffectee = 0;

  // Détail exportable : chaque module qui n'a pas encore tous ses formateurs.
  const lignesNonCouvertes = [];

  const ajouterCharge = (nom, valeur) => {
    const identifiant = cle(nom);
    charges.set(identifiant, heures((charges.get(identifiant) ?? 0) + valeur));
  };

  const metier = (nom) => {
    const libelle = nom || 'Non renseigné';
    if (!metiers.has(libelle)) {
      metiers.set(libelle, {
        metier: libelle,
        demande: 0,
        couvert: 0,
        affecte: 0,
        modules: 0,
        modulesNonCouverts: 0,
        formateurs: new Set(),
        groupes: new Set(),
      });
    }
    return metiers.get(libelle);
  };

  // Le synchrone déjà compté : un même module synchrone partagé par plusieurs
  // groupes ne pèse qu'une fois sur la charge du formateur.
  const synchronesComptes = new Set();

  for (const ensemble of construireEnsembles(groupes)) {
    for (const groupe of ensemble.groupes) {
      for (const module of groupe.modules ?? []) {
        // Un module désactivé ne se donne pas : il ne pèse ni sur la demande du
        // groupe ni sur la charge d'un formateur.
        if (!estActif(module)) continue;

        const mhp = heuresPresentiel(module);
        const mhsyn = heuresSynchrone(module);
        const entree = metier(module.metier);

        entree.demande = heures(entree.demande + mhp + mhsyn);
        entree.modules += 1;
        entree.groupes.add(groupe.nom);
        demandeTotale = heures(demandeTotale + mhp + mhsyn);

        let couvert = 0;

        if (module.formateurPresentiel) {
          couvert += mhp;
          entree.affecte = heures(entree.affecte + mhp);
          entree.formateurs.add(cle(module.formateurPresentiel));
          offreAffectee = heures(offreAffectee + mhp);
          ajouterCharge(module.formateurPresentiel, mhp);
        }

        if (module.formateurSynchrone) {
          // Le groupe est couvert dans tous les cas…
          couvert += mhsyn;
          entree.formateurs.add(cle(module.formateurSynchrone));

          // …mais la charge du formateur n'est comptée qu'une fois par SÉANCE.
          const empreinte = empreinteSeance(ensemble.cle, groupe, module);

          if (!synchronesComptes.has(empreinte)) {
            synchronesComptes.add(empreinte);
            entree.affecte = heures(entree.affecte + mhsyn);
            offreAffectee = heures(offreAffectee + mhsyn);
            ajouterCharge(module.formateurSynchrone, mhsyn);
          }
        }

        entree.couvert = heures(entree.couvert + couvert);
        demandeCouverte = heures(demandeCouverte + couvert);

        if (mhp + mhsyn - couvert > 0.001) {
          entree.modulesNonCouverts += 1;

          /*
           * Le détail, module par module, de ce qu'il reste à affecter.
           * ← `lignesNonCouvertes` de computeOffreDemande()
           *
           * Les totaux par métier disent COMBIEN il manque ; seule cette liste
           * dit OÙ. C'est elle qu'on emporte pour répartir le travail, d'où les
           * deux dernières colonnes : un module peut n'avoir besoin que de son
           * formateur synchrone, l'heure manquante ne dit pas laquelle.
           */
          lignesNonCouvertes.push({
            metier: entree.metier,
            codeFiliere: groupe.codeFiliere ?? '',
            intituleFiliere: groupe.intituleFiliere ?? '',
            anneeFormation: groupe.anneeFormation ?? '',
            groupe: groupe.nom,
            mode: groupe.mode ?? '',
            code: module.code ?? '',
            module: module.nom ?? '',
            demande: heures(mhp + mhsyn),
            couvert: heures(couvert),
            besoin: heures(mhp + mhsyn - couvert),
            manquePresentiel: mhp > 0 && !module.formateurPresentiel,
            manqueSynchrone: mhsyn > 0 && !module.formateurSynchrone,
          });
        }
      }
    }
  }

  // Capacité statutaire déclarée.
  const statutaires = new Map();
  let offreStatutaire = 0;

  for (const formateur of formateurs) {
    const valeur = heures(formateur.masseHoraire);
    statutaires.set(cle(formateur.nom), valeur);
    offreStatutaire = heures(offreStatutaire + valeur);
  }

  const detailMetiers = [...metiers.values()]
    .map((entree) => {
      let capacite = 0;
      for (const nom of entree.formateurs) capacite = heures(capacite + (statutaires.get(nom) ?? 0));

      return {
        metier: entree.metier,
        formateurs: entree.formateurs.size,
        capacite,
        affecte: entree.affecte,
        demande: entree.demande,
        couvert: entree.couvert,
        besoin: heures(Math.max(0, entree.demande - entree.couvert)),
        modules: entree.modules,
        modulesNonCouverts: entree.modulesNonCouverts,
        groupes: entree.groupes.size,
      };
    })
    .sort((a, b) => b.demande - a.demande || a.metier.localeCompare(b.metier, 'fr'));

  // Ventilation par semestre, pour les colonnes « Affecté S1 » / « Affecté S2 ».
  const parSemestre = calculerCharges(groupes);

  const detailFormateurs = formateurs
    .map((formateur) => {
      const statutaire = heures(formateur.masseHoraire);
      const affecte = charges.get(cle(formateur.nom)) ?? 0;
      const semestres = parSemestre.get(cle(formateur.nom)) ?? { s1: 0, s2: 0 };

      return {
        nom: formateur.nom,
        matricule: formateur.matricule ?? '',
        statutaire,
        s1: semestres.s1,
        s2: semestres.s2,
        affecte,
        // Négatif = dépassement de la masse statutaire.
        disponible: heures(statutaire - affecte),
        taux: taux(affecte, statutaire),
      };
    })
    .sort((a, b) => b.affecte - a.affecte || a.nom.localeCompare(b.nom, 'fr'));

  // Sous-affectés : du plus disponible au moins. C'est la liste qu'on parcourt
  // pour trouver à qui confier les heures encore sans formateur.
  const sousAffectes = detailFormateurs
    .filter((f) => f.statutaire > 0 && f.disponible > 0)
    .sort((a, b) => b.disponible - a.disponible || a.nom.localeCompare(b.nom, 'fr'));

  const surcharges = detailFormateurs
    .filter((f) => f.statutaire > 0 && f.disponible < 0)
    .map((f) => ({ ...f, depassement: heures(-f.disponible) }))
    .sort((a, b) => b.depassement - a.depassement || a.nom.localeCompare(b.nom, 'fr'));

  /*
   * ═══ RÉCONCILIATION AVEC LA TUILE « OFFRE » ═══
   * Question posée sans arrêt en production : « j'ai 400 h disponibles chez mes
   * formateurs, pourquoi la tuile Offre n'affiche pas 400 h d'écart ? »
   * Parce que trois volumes s'y soustraient, et qu'aucun n'est visible :
   *   − les heures des formateurs DÉJÀ en dépassement (non mobilisables),
   *   − les heures affectées à un formateur SANS masse statutaire déclarée,
   *   − les heures affectées à un nom ABSENT de la liste des formateurs.
   * Les exposer évite de conclure à un bug du calcul.
   */
  const totalDisponible = heures(sousAffectes.reduce((somme, f) => somme + f.disponible, 0));
  const totalSurcharge = heures(surcharges.reduce((somme, f) => somme + f.depassement, 0));
  const sansCapacite = detailFormateurs.filter((f) => f.statutaire === 0 && f.affecte > 0);
  const heuresSansCapacite = heures(sansCapacite.reduce((somme, f) => somme + f.affecte, 0));
  const affecteConnu = heures(detailFormateurs.reduce((somme, f) => somme + f.affecte, 0));

  return {
    offre: {
      statutaire: offreStatutaire,
      affecte: offreAffectee,
      taux: taux(offreAffectee, offreStatutaire),
    },
    demande: {
      total: demandeTotale,
      couvert: demandeCouverte,
      taux: taux(demandeCouverte, demandeTotale),
    },
    besoin: heures(Math.max(0, demandeTotale - demandeCouverte)),
    besoinTaux: taux(Math.max(0, demandeTotale - demandeCouverte), demandeTotale),
    metiers: detailMetiers,
    // Le besoin ligne à ligne, trié comme l'existant : par métier, puis par
    // groupe, puis par code de module.
    lignes: lignesNonCouvertes.sort(
      (a, b) =>
        a.metier.localeCompare(b.metier, 'fr') ||
        a.groupe.localeCompare(b.groupe, 'fr', { numeric: true }) ||
        String(a.code).localeCompare(String(b.code), 'fr', { numeric: true })
    ),
    formateurs: detailFormateurs,
    // Formateurs à qui il reste des heures : c'est là qu'on cherche qui peut
    // couvrir le besoin.
    sousAffectes,
    // Formateurs dont la charge dépasse la masse statutaire : l'écran doit le
    // dire avant l'enregistrement, pas l'emploi du temps trois semaines après.
    surcharges,
    reconciliation: {
      disponible: totalDisponible,
      surcharge: totalSurcharge,
      sansCapacite: sansCapacite.length,
      heuresSansCapacite,
      // Heures affectées à un nom qui ne figure pas dans la liste : elles
      // pèsent sur l'offre sans être rattachables à personne.
      horsListe: heures(Math.max(0, offreAffectee - affecteConnu)),
      ecartNet: heures(offreStatutaire - offreAffectee),
    },
  };
}
