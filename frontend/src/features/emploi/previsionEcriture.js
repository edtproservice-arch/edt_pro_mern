import {
  anneeDuNomGroupe,
  cleModule,
  detecterConflits,
  dureeSeance,
  heuresPosees,
  optionsDuFormateur,
  separerFusion,
  typeDeSeance,
} from 'shared/domain';

/**
 * Ce que la semaine deviendrait si le serveur acceptait — pour l'afficher AVANT
 * sa réponse, SANS JAMAIS AFFICHER CE QU'IL REFUSERAIT.
 *
 * ═══ POURQUOI (2026-09-19, signalé par le porteur : « lent, surtout hébergé ») ═══
 * La grille attendait un aller-retour réseau puis la relecture de la semaine
 * avant de bouger : hébergé, une case déposée restait à sa place une à deux
 * secondes. On rejoue donc le geste localement, et le serveur confirme derrière.
 *
 * ═══ ⚠️⚠️ UN AFFICHAGE FAUX EST PIRE QU'UN AFFICHAGE LENT ═══
 * (Retour du porteur, même jour : « il donne parfois des chevauchements qui ne
 * sont pas justes, puis il rattrape et masque — il ne faut pas les afficher dès
 * le début ».) Une première version rejouait TOUT sans juger : une séance posée
 * sur un créneau déjà pris apparaissait en double, un instant, avant que le
 * refus du serveur ne la retire.
 *
 * Chaque pose est donc JUGÉE ici avec les mêmes règles que `poser` côté serveur,
 * DANS LE MÊME ORDRE — rattrapage, affectation, rentrée, conflits, quota — et une
 * pose qu'il refuserait n'est simplement pas montrée : elle apparaîtra si le
 * serveur l'accepte malgré tout (la prévision peut retarder, jamais tromper).
 *
 * ⚠️ MÊMES RÈGLES QUE LE SERVEUR, jamais une seconde version : les conflits
 * viennent de `detecterConflits`, le décompte de `heuresPosees`, les options de
 * `optionsDuFormateur` — les fonctions du domaine que `seances.service.js`
 * appelle lui-même.
 *
 * ⚠️ PURE : elle ne modifie pas `seances`, et ne touche à aucun cache.
 *
 * @param {Array} seances la semaine telle que le cache la porte
 * @param {Array} operations celles que `ecrire` s'apprête à envoyer
 * @param {object|null} regles ce qu'il faut pour JUGER — sans lui, tout est
 *   appliqué sans contrôle (c'est ce que fait la confirmation, où le serveur a
 *   déjà jugé) :
 *   `{ groupesFq, fiches, posees, affectations, gelDuJour(jour) }`
 * @returns {Array} la semaine simulée
 */
export function appliquerOperations(seances, operations, regles = null) {
  const suivi = regles ? suivreLesRegles(regles) : null;
  let etat = [...seances];

  for (const operation of operations) {
    if (operation.type === 'vider') {
      const partantes = etat.filter((s) => memeCreneau(s, operation.creneau));
      etat = etat.filter((s) => !partantes.includes(s));
      suivi?.retirer(partantes);
      continue;
    }

    const nouvelle = operation.seance;
    const id = idServeur(nouvelle.id);
    const index = id
      ? etat.findIndex((s) => s.id === id)
      : etat.findIndex((s) => memeCreneau(s, nouvelle));

    // Sans `id`, un créneau déjà pris par le même formateur est un conflit : le
    // serveur refuse, et la simulation n'y touche pas.
    if (!id && index >= 0) continue;

    const remplacee = index >= 0 ? etat[index] : null;
    let fusion = {
      ...(remplacee ?? {}),
      ...definies(nouvelle),
      // Un identifiant PROVISOIRE pour ce qui vient d'être créé : la réponse du
      // serveur apporte le vrai (voir `confirmer`).
      id:
        remplacee?.id ??
        id ??
        `provisoire-${nouvelle.jour}-${nouvelle.seance}-${nouvelle.periode}-${nouvelle.formateurMatricule}`,
    };

    if (suivi) {
      const verdict = suivi.juger({ etat, remplacee, fusion, id, operation });
      if (verdict === 'refus') continue;
      // La salle seule cède, pour un déplacement — c'est aussi ce que fait le
      // serveur (`ecrireLot`) : la séance est posée SANS salle.
      if (verdict === 'sans-salle') fusion = { ...fusion, salle: '' };
    }

    if (index >= 0) etat[index] = fusion;
    else etat.push(fusion);
    suivi?.retirer(remplacee ? [remplacee] : []);
    suivi?.ajouter(fusion);

    // Un déplacement libère son départ. Posée en place (`id`), la séance a déjà
    // quitté ce créneau : il n'y a alors plus rien à retirer.
    if (operation.type === 'deplacer' && operation.source) {
      const partantes = etat.filter((s) => s.id !== fusion.id && memeCreneau(s, operation.source));
      etat = etat.filter((s) => !partantes.includes(s));
      suivi?.retirer(partantes);
    }
  }

  return etat;
}

/**
 * Remplace, dans la semaine simulée, ce que le serveur vient de confirmer par SA
 * version de la séance : le vrai identifiant, la date, le statut réel. C'est ce
 * qui dispense de relire toute la semaine après un geste réussi.
 *
 * @param {Array} seances la semaine simulée
 * @param {object} confirmee la séance telle que le serveur l'a présentée
 */
export function confirmer(seances, confirmee) {
  if (!confirmee) return seances;

  let index = seances.findIndex((s) => s.id === confirmee.id);
  if (index < 0) index = seances.findIndex((s) => memeCreneau(s, confirmee));

  if (index < 0) return [...seances, confirmee];
  return seances.map((s, rang) => (rang === index ? confirmee : s));
}

/**
 * Les heures posées de l'année après un geste : celles d'avant, corrigées de ce
 * que la semaine a gagné ou perdu.
 *
 * ⚠️ PAR DIFFÉRENCE, PAS PAR RECALCUL : le contexte porte les heures de TOUTE
 * l'année, dont cette semaine n'est qu'un morceau — on ne peut donc pas les
 * refaire depuis les seules séances de la semaine. On retranche ce que la
 * semaine pesait avant, on ajoute ce qu'elle pèse maintenant. Les séances
 * absentes et les surveillances d'EFM sont déjà écartées par `heuresPosees`.
 *
 * @param {object} posees `{ "GROUPE||MODULE": { presentiel, synchrone } }`
 * @returns {object} un nouvel objet — l'ancien n'est pas modifié
 */
export function ajusterPosees(posees = {}, avant, apres) {
  const avantSemaine = heuresPosees(avant);
  const apresSemaine = heuresPosees(apres);
  const resultat = { ...posees };

  for (const cle of new Set([...avantSemaine.keys(), ...apresSemaine.keys()])) {
    const courant = { presentiel: 0, synchrone: 0, ...(posees[cle] ?? {}) };
    for (const type of ['presentiel', 'synchrone']) {
      const delta = (apresSemaine.get(cle)?.[type] ?? 0) - (avantSemaine.get(cle)?.[type] ?? 0);
      courant[type] = Math.max(0, arrondir(courant[type] + delta));
    }
    resultat[cle] = courant;
  }

  return resultat;
}

/* ─────────────────────────────── interne ─────────────────────────────── */

/** Un identifiant que le serveur a émis : 24 caractères hexadécimaux. */
const ID_SERVEUR = /^[a-f0-9]{24}$/i;
const idServeur = (id) => (typeof id === 'string' && ID_SERVEUR.test(id) ? id : undefined);

const memeCreneau = (seance, creneau) =>
  seance.jour === creneau.jour &&
  seance.seance === creneau.seance &&
  seance.periode === creneau.periode &&
  seance.formateurMatricule === creneau.formateurMatricule;

const definies = (objet) =>
  Object.fromEntries(Object.entries(objet).filter(([, valeur]) => valeur !== undefined));

const arrondir = (valeur) => Math.round(valeur * 100) / 100;

/**
 * Le juge : mêmes contrôles que `poser` côté serveur, dans le même ordre, et le
 * décompte des heures posées tenu à jour au fil du lot (une opération voit les
 * effets des précédentes, exactement comme le serveur qui les exécute en série).
 */
function suivreLesRegles({ groupesFq = [], fiches, posees, affectations = [], gelDuJour }) {
  // Copie paresseuse : on ne touche jamais la Map du cache.
  const heures = new Map();
  const lire = (cle) => heures.get(cle) ?? posees?.get(cle) ?? { presentiel: 0, synchrone: 0 };
  const modifier = (seances, signe) => {
    for (const seance of seances) {
      for (const [cle, compte] of heuresPosees([seance])) {
        const courant = { ...lire(cle) };
        for (const type of Object.keys(compte)) courant[type] = arrondir((courant[type] ?? 0) + signe * compte[type]);
        heures.set(cle, courant);
      }
    }
  };

  const optionsParFormateur = new Map();
  const modulesDe = (matricule, groupe) => {
    if (!optionsParFormateur.has(matricule)) {
      optionsParFormateur.set(matricule, optionsDuFormateur(affectations, matricule));
    }
    return optionsParFormateur.get(matricule).modulesParGroupe.get(groupe);
  };

  return {
    ajouter: (seances) => modifier(Array.isArray(seances) ? seances : [seances], +1),
    retirer: (seances) => modifier(seances, -1),

    juger({ etat, remplacee, fusion, id, operation }) {
      const nouvelle = operation.seance;

      // 1. Un rattrapage ne se fabrique ni ne se déplace par la saisie ordinaire.
      if (remplacee?.rattrapageDe) {
        const bouge = ['formateurMatricule', 'groupe', 'module', 'jour', 'seance', 'periode'].some(
          (champ) => String(remplacee[champ] ?? '') !== String(fusion[champ] ?? '')
        );
        if (bouge || nouvelle.statut === 'absent') return 'refus';
      } else if (nouvelle.statut === 'rattrape') {
        return 'refus';
      }

      // 2. Le formateur doit être affecté à ce groupe pour ce module.
      const modules = modulesDe(fusion.formateurMatricule, fusion.groupe);
      if (!modules?.includes(fusion.module)) return 'refus';

      // 3. Le gel de rentrée : aucun membre du groupe ne doit être avant sa rentrée.
      const gels = gelDuJour?.(fusion.jour) ?? [];
      if (
        gels.length > 0 &&
        separerFusion(fusion.groupe).some((membre) =>
          gels.some((gel) => gel.anneeFormation === anneeDuNomGroupe(membre))
        )
      ) {
        return 'refus';
      }

      // 4. Les conflits, sur les séances DU MÊME créneau et d'elles seules.
      const surLeCreneau = etat.filter(
        (s) => s.jour === fusion.jour && s.seance === fusion.seance && s.periode === fusion.periode
      );
      const conflits = detecterConflits(
        {
          id,
          groupe: fusion.groupe,
          formateurMatricule: fusion.formateurMatricule,
          salle: fusion.salle,
        },
        surLeCreneau,
        { groupesFq }
      );

      let sansSalle = false;
      if (conflits.length > 0) {
        const seulementLaSalle = operation.type === 'deplacer' && conflits.every((c) => c.type === 'salle');
        if (!seulementLaSalle) return 'refus';
        sansSalle = true;
      }

      // 5. Le quota : on ne pose pas plus d'heures que la carte n'en a prévu. La
      // séance remplacée est EXCLUE du décompte — la déplacer ne change aucune
      // heure au total.
      const type = typeDeSeance(sansSalle ? { ...fusion, salle: '' } : fusion);
      const cle = cleModule(fusion.groupe, fusion.module);
      const prevu = fiches?.get(cle)?.[type] ?? 0;
      if (prevu > 0) {
        const sienne = remplacee ? (heuresPosees([remplacee]).get(cle)?.[type] ?? 0) : 0;
        const deja = arrondir((lire(cle)[type] ?? 0) - sienne);
        if (arrondir(deja + dureeSeance(fusion.seance)) > prevu) return 'refus';
      }

      return sansSalle ? 'sans-salle' : 'accepte';
    },
  };
}
