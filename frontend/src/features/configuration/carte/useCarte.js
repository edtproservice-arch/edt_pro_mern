import { useCallback, useMemo, useState } from 'react';
import {
  activerModule as activerModuleSurEnsemble,
  projeterSynchrones,
  synchronesEffectifs,
  calculerBilan,
  copierAffectationsPresentiel,
  definirMasseHoraire as definirMasseHoraireGroupe,
  estActif,
  genererNomsGroupes,
  libererFormateursInconnus,
  renommagesDesambiguisation,
  renommerGroupes,
} from 'shared/domain';

/** Construit un groupe « neuf » à partir d'une filière et d'un gabarit de modules. */
function construireGroupe(nom, { filiere, annee, mode, modules }) {
  return {
    nom,
    codeFiliere: filiere.code,
    intituleFiliere: filiere.intitule,
    anneeFormation: annee,
    niveau: filiere.niveau,
    secteur: filiere.secteur,
    typeFormation: filiere.typeFormation,
    creneau: filiere.creneau,
    mode,
    // Chaque groupe porte SA copie des modules : les affectations d'un
    // groupe ne doivent pas suivre celles d'un autre.
    modules: modules.map((module) => ({
      ...module,
      formateurPresentiel: '',
      formateurSynchrone: '',
      // Masse de la répartition DRIF, conservée pour pouvoir rétablir un
      // ajustement fait sur un groupe alterné ou par apprentissage.
      reference: { mhpS1: module.mhpS1, mhpS2: module.mhpS2 },
    })),
  };
}

/**
 * État de la carte d'établissement en cours de construction.
 * ← les variables globales `generatedGroupsMap`, `affectationFormateursList` et
 *   `synchroneAssignments` de public/assets/js/affectation-carte.js
 *
 * Le fichier d'origine gardait cet état dans des globales lues et écrites par
 * une quarantaine de fonctions, et rendu par manipulation directe du DOM. Ici
 * l'état est fermé sur ce module ; les règles de nommage, elles, vivent dans
 * `shared/domain/carte` — testées, partagées avec le serveur.
 */
export function useCarte({ groupesInitiaux = [], formateursInitiaux = [] } = {}) {
  const [groupes, setGroupes] = useState(groupesInitiaux);
  const [formateurs, setFormateurs] = useState(formateursInitiaux);

  /**
   * Séances synchrones : cle d'ensemble → module → lignes { formateur, groupes }.
   * ← `synchroneAssignments` de affectation-carte.js
   *
   * État À PART, et non déduit des groupes : une ligne en cours de saisie ne
   * laisse aucune trace sur eux, elle disparaîtrait donc à l'instant où on
   * l'ajoute. Elle n'est reportée sur les groupes qu'à l'enregistrement.
   */
  const [synchrones, setSynchrones] = useState({});

  /**
   * Génère les groupes d'une filière.
   *
   * @returns {{crees: string[], renommages: Array<{ancien, nouveau}>}}
   *   `renommages` signale les groupes d'une filière homonyme qui devraient
   *   être suffixés — l'appelant demande confirmation avant de les appliquer,
   *   car des séances déjà planifiées référencent l'ancien nom.
   */
  const genererGroupes = useCallback(
    ({ filiere, annee, nombre, mode, modules }) => {
      const { noms, conflits } = genererNomsGroupes({
        codeFiliere: filiere.code,
        anneeFormation: annee,
        nombre,
        groupesExistants: groupes.map((groupe) => ({
          nom: groupe.nom,
          codeFiliere: groupe.codeFiliere,
        })),
      });

      const nouveaux = noms.map((nom) => construireGroupe(nom, { filiere, annee, mode, modules }));

      setGroupes((precedents) => [
        ...precedents.filter((groupe) => !noms.includes(groupe.nom)),
        ...nouveaux,
      ]);

      return { crees: noms, renommages: renommagesDesambiguisation(conflits) };
    },
    [groupes]
  );

  /**
   * Ajoute UN groupe à un ensemble DÉJÀ EXISTANT, depuis son propre bloc.
   * ← demande du porteur, 2026-09-03 : ajouter un groupe passait par le
   * formulaire du haut, qui fait ressaisir secteur, niveau, créneau, année et
   * filière — alors que l'ensemble les porte déjà tous.
   *
   * @param {string|null} dupliquerDepuis — nom d'un groupe de CET ensemble
   *   dont on reprend les affectations présentielles ; `null` pour un groupe
   *   vierge.
   *
   * ⚠️ LA DUPLICATION SE FAIT DANS LE MÊME `setGroupes`, PAS EN DEUX APPELS.
   * `copierAffectations` lit `groupes` capturé par sa propre fermeture : appelé
   * juste après cette fonction, il lirait l'état D'AVANT la génération, et son
   * écriture EFFACERAIT le groupe qu'on vient d'ajouter. On applique donc
   * `copierAffectationsPresentiel` sur la liste FRAÎCHE, à l'intérieur de ce
   * même updater — c'est la fonction du domaine déjà testée, pas une seconde
   * écriture de la même règle.
   */
  const ajouterGroupeAEnsemble = useCallback(
    ({ filiere, annee, mode, modules, dupliquerDepuis = null }) => {
      const { noms, conflits } = genererNomsGroupes({
        codeFiliere: filiere.code,
        anneeFormation: annee,
        nombre: 1,
        groupesExistants: groupes.map((groupe) => ({
          nom: groupe.nom,
          codeFiliere: groupe.codeFiliere,
        })),
      });

      const nouveaux = noms.map((nom) => construireGroupe(nom, { filiere, annee, mode, modules }));

      setGroupes((precedents) => {
        const suivants = [
          ...precedents.filter((groupe) => !noms.includes(groupe.nom)),
          ...nouveaux,
        ];

        if (!dupliquerDepuis) return suivants;

        // ⚠️ SUR LA LISTE FRAÎCHE : c'est elle qui porte le groupe créé
        // ci-dessus, celle sur laquelle `copierAffectationsPresentiel` doit
        // reconnaître qu'il appartient au même ensemble que la source.
        return copierAffectationsPresentiel(suivants, dupliquerDepuis).groupes;
      });

      return { crees: noms, renommages: renommagesDesambiguisation(conflits) };
    },
    [groupes]
  );

  /**
   * Applique les renommages de désambiguïsation acceptés par le directeur.
   *
   * ⚠️ Les séances synchrones déjà saisies citent leurs groupes par leur nom :
   * les renommer aussi, sinon elles ne couvrent plus personne. La règle vit dans
   * le domaine (`renommerGroupes`) ; chaque état n'en reçoit que sa moitié.
   */
  const appliquerRenommages = useCallback((renommages) => {
    setGroupes((precedents) => renommerGroupes(precedents, {}, renommages).groupes);
    setSynchrones((precedents) => renommerGroupes([], precedents, renommages).table);
  }, []);

  const supprimerGroupe = useCallback((nom) => {
    setGroupes((precedents) => precedents.filter((groupe) => groupe.nom !== nom));
  }, []);

  /** Affecte un formateur à un module d'un groupe, en présentiel ou en synchrone. */
  const affecter = useCallback((nomGroupe, codeModule, champ, formateur) => {
    setGroupes((precedents) =>
      precedents.map((groupe) =>
        groupe.nom !== nomGroupe
          ? groupe
          : {
              ...groupe,
              modules: groupe.modules.map((module) =>
                module.code === codeModule ? { ...module, [champ]: formateur } : module
              ),
            }
      )
    );
  }, []);

  /** Active ou désactive un module dans tous les groupes de son ensemble. */
  const activerModule = useCallback((cle, module, actif) => {
    setGroupes((precedents) => activerModuleSurEnsemble(precedents, cle, module, actif));
  }, []);

  /** Ajuste la masse horaire d'un module pour un groupe alterné / apprentissage. */
  const definirMasseHoraire = useCallback((nomGroupe, module, champ, valeur) => {
    setGroupes((precedents) =>
      definirMasseHoraireGroupe(precedents, nomGroupe, module, champ, valeur)
    );
  }, []);

  /**
   * Séances effectivement retenues : les choix du directeur, complétés par la
   * proposition par défaut — le formateur présentiel dominant sur tous les
   * groupes — pour les modules qu'il n'a pas encore touchés.
   */
  const synchronesRetenus = useMemo(
    () => synchronesEffectifs(groupes, synchrones),
    [groupes, synchrones]
  );

  /** Séances d'un module, proposition par défaut comprise. */
  const lignesSynchronesDe = useCallback(
    (cle, codeModule) => synchronesRetenus[cle]?.[codeModule] ?? [],
    [synchronesRetenus]
  );

  /**
   * Enregistre les séances synchrones d'un module — une ligne par séance.
   * N'écrit que le modèle synchrone : le présentiel a son propre champ, et les
   * deux affectations ne doivent jamais se contaminer.
   */
  const definirLignesSynchrone = useCallback((cle, codeModule, lignes) => {
    setSynchrones((precedents) => ({
      ...precedents,
      [cle]: { ...precedents[cle], [codeModule]: lignes },
    }));
  }, []);

  /**
   * Groupes AVEC leurs séances synchrones reportées.
   *
   * C'est cette vue qui est exposée : compteurs, bilan de charge et
   * enregistrement doivent tous refléter les séances en cours de saisie, pas
   * seulement celles déjà écrites sur les groupes.
   */
  const groupesProjetes = useMemo(
    () => projeterSynchrones(groupes, synchronesRetenus),
    [groupes, synchronesRetenus]
  );

  /**
   * Report des affectations d'un groupe sur les autres de son ensemble.
   *
   * Le nombre de groupes touchés est calculé AVANT la mise à jour d'état : le
   * compter dans le `setGroupes` le rendrait faux en mode strict de React, qui
   * appelle le réducteur deux fois.
   */
  const copierAffectations = useCallback(
    (nomSource) => {
      const { groupes: suivants, touches } = copierAffectationsPresentiel(groupes, nomSource);
      if (touches > 0) setGroupes(suivants);
      return touches;
    },
    [groupes]
  );

  const ajouterFormateur = useCallback((formateur) => {
    const nom = String(formateur.nom ?? '')
      .trim()
      .toUpperCase();
    if (!nom) return;

    setFormateurs((precedents) =>
      precedents.some((existant) => existant.nom === nom)
        ? precedents
        : [...precedents, { ...formateur, nom }].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    );
  }, []);

  /**
   * Remplace toute la liste — issue d'un import Excel fusionné.
   *
   * Les affectations qui désignent un formateur disparu sont libérées : son nom
   * resté sur un module produirait un formateur inconnu à l'enregistrement.
   */
  const remplacerFormateurs = useCallback((nouveaux) => {
    setFormateurs(nouveaux);
    setGroupes((precedents) => libererFormateursInconnus(precedents, nouveaux));
  }, []);

  const retirerFormateur = useCallback(
    (nom) => {
      const restants = formateurs.filter((formateur) => formateur.nom !== nom);

      setFormateurs(restants);
      // Retirer un formateur libère ses modules : laisser son nom sur une
      // affectation produirait un formateur inconnu à l'enregistrement.
      setGroupes((precedents) => libererFormateursInconnus(precedents, restants));
    },
    [formateurs]
  );

  /** Chiffres du bandeau. ← updateAffectationStats() */
  const statistiques = useMemo(() => {
    let modules = 0;
    let affectes = 0;
    let synchrones = 0;
    const filieres = new Set();
    const affectants = new Set();

    for (const groupe of groupesProjetes) {
      filieres.add(groupe.codeFiliere);
      for (const module of groupe.modules) {
        // Un module désactivé n'est pas dispensé : le compter parmi les
        // « non affectés » ferait croire à un manque qui n'existe pas.
        if (!estActif(module)) continue;
        modules += 1;
        if (module.formateurPresentiel) {
          affectes += 1;
          affectants.add(module.formateurPresentiel);
        }
        if (module.formateurSynchrone) {
          synchrones += 1;
          affectants.add(module.formateurSynchrone);
        }
      }
    }

    return {
      filieres: filieres.size,
      groupes: groupesProjetes.length,
      modules,
      affectes,
      nonAffectes: modules - affectes,
      synchrones,
      formateursAffectes: affectants.size,
    };
  }, [groupesProjetes]);

  /**
   * Offre et demande de masse horaire — le calcul vit dans le domaine, testé.
   * ← les tuiles « Offre » et « Demande » de affectation-carte.html:64-80
   */
  const bilan = useMemo(
    () => calculerBilan({ groupes: groupesProjetes, formateurs }),
    [groupesProjetes, formateurs]
  );

  /**
   * Repose une carte entière — celle d'un collègue, adoptée (Phase 5bis), ou un
   * état précédent (« Défaire »).
   *
   * ═══ ⚠️⚠️ LA TABLE DES SÉANCES SYNCHRONES REPART DE ZÉRO (2026-09-13) ═══
   * Elle n'était pas touchée : les séances saisies ICI survivaient à la reprise
   * et, prioritaires sur les lignes de la carte reposée (`synchronesEffectifs`),
   * masquaient celles du collègue — puis repartaient en base au premier
   * enregistrement, par-dessus son travail. Vide, la table laisse la carte
   * reposée dire ses propres séances, exactement comme au rechargement de la
   * page.
   *
   * ⚠️ STABLE (`useCallback`) : `CarteEtablissement` la remonte dans un effet qui
   * en dépend. Recréée à chaque rendu, elle relançait cet effet à chaque rendu.
   */
  const reprendre = useCallback((nouveauxGroupes, nouveauxFormateurs) => {
    setGroupes(nouveauxGroupes);
    setFormateurs(nouveauxFormateurs);
    setSynchrones({});
  }, []);

  return {
    groupes: groupesProjetes,
    formateurs,
    // Reprise d'une carte déjà enregistrée : l'écran d'affectation la charge
    // depuis la base au lieu de repartir d'une page blanche.
    reprendre,
    statistiques,
    genererGroupes,
    ajouterGroupeAEnsemble,
    appliquerRenommages,
    supprimerGroupe,
    affecter,
    definirLignesSynchrone,
    lignesSynchronesDe,
    activerModule,
    definirMasseHoraire,
    copierAffectations,
    ajouterFormateur,
    retirerFormateur,
    remplacerFormateurs,
    bilan,
  };
}
