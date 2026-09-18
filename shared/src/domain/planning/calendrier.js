/**
 * Calendrier : ce qui empêche une séance d'avoir lieu.
 *
 * Quatre causes d'indisponibilité, d'origines différentes :
 *   1. jour férié          — national, s'applique à tout le monde
 *   2. vacances scolaires  — période, s'applique à tout l'établissement
 *   3. stage               — période, s'applique à UN GROUPE
 *   4. formation           — période, s'applique à UN FORMATEUR
 *
 * ← public/emploi.html (isGroupOnInternshipDuringWeek, isFormateurEnFormation),
 *   tables `calendrier`, `stages`, `formations`
 *
 * ═══ CE MODULE NE VA JAMAIS CHERCHER DE DONNÉES ═══
 * Les fêtes religieuses viennent d'une API externe (api.aladhan.com dans
 * l'existant) : c'est un service du backend qui l'appelle et la met en cache,
 * pas le domaine. Ici on reçoit un calendrier déjà constitué et on répond à des
 * questions dessus. C'est la règle de couches du §10.1.
 *
 * ═══ LES DATES SONT DES CHAÎNES « AAAA-MM-JJ » ═══
 * Choix repris de l'existant, et pour la même raison : comparer des chaînes
 * évite les décalages de fuseau horaire qui font glisser une date d'un jour.
 * Le commentaire d'origine dans emploi.html le dit explicitement.
 */

import { avantRentree } from './rentree.js';
import { enJour } from './jour.js';

/* Ré-exporté : `enJour` était historiquement défini ici, et tout le projet
   l'importe depuis le barillet. Le déplacer sans ce pont casserait vingt
   appelants pour un gain nul. */
export { enJour };

/** Normalise un identifiant pour comparaison : majuscules, espaces réduits. */
function cle(valeur) {
  return String(valeur ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Jour férié correspondant à cette date, s'il y en a un.
 * @returns {{date: string, libelle: string}|null}
 */
export function jourFerie(date, joursFeries = []) {
  const jour = enJour(date);
  if (!jour) return null;

  return joursFeries.find((ferie) => enJour(ferie?.date ?? ferie) === jour) ?? null;
}

/** Période (vacances, stage, formation) contenant cette date. */
function periodeContenant(jour, periodes = []) {
  return (
    periodes.find((periode) => {
      const debut = enJour(periode?.debut ?? periode?.date_debut);
      const fin = enJour(periode?.fin ?? periode?.date_fin);
      return debut && fin && jour >= debut && jour <= fin;
    }) ?? null
  );
}

/** Période chevauchant l'intervalle [debut, fin] — utilisé au niveau semaine. */
function periodeChevauchant(debutJour, finJour, periodes = []) {
  return (
    periodes.find((periode) => {
      const debut = enJour(periode?.debut ?? periode?.date_debut);
      const fin = enJour(periode?.fin ?? periode?.date_fin);
      // Chevauchement : la période commence avant la fin ET finit après le début.
      return debut && fin && debut <= finJour && fin >= debutJour;
    }) ?? null
  );
}

export function vacances(date, periodes = []) {
  const jour = enJour(date);
  return jour ? periodeContenant(jour, periodes) : null;
}

/**
 * Stage du groupe à cette date.
 * Le nom du groupe est comparé APRÈS renommage (suffixes CDS/FQ compris) :
 * c'est le nom stocké dans `stages.groupe_nom`.
 */
export function stageDuGroupe(groupe, date, stages = []) {
  const jour = enJour(date);
  const nom = cle(groupe);
  if (!jour || nom === '') return null;

  return periodeContenant(
    jour,
    stages.filter((stage) => cle(stage?.groupe ?? stage?.groupe_nom) === nom)
  );
}

/**
 * Le groupe est-il en stage pendant tout ou partie de la semaine ?
 * ← isGroupOnInternshipDuringWeek() : la comparaison se fait par CHEVAUCHEMENT,
 * un stage d'un seul jour suffit à marquer la semaine.
 */
export function stageDuGroupeSurSemaine(groupe, debut, fin, stages = []) {
  const debutJour = enJour(debut);
  const finJour = enJour(fin);
  const nom = cle(groupe);
  if (!debutJour || !finJour || nom === '') return null;

  return periodeChevauchant(
    debutJour,
    finJour,
    stages.filter((stage) => cle(stage?.groupe ?? stage?.groupe_nom) === nom)
  );
}

/**
 * Formation suivie par le formateur à cette date — il est alors indisponible.
 *
 * ⚠️ DÉFAUT CORRIGÉ. `isFormateurEnFormation()` comparait les noms dans les
 * DEUX SENS :
 *
 *     formationName.includes(targetName) || targetName.includes(formationName)
 *
 * Or `"AMMARI".includes("")` vaut **vrai** : une ligne de `formations` dont le
 * `nom_formateur` est vide rendait TOUS les formateurs indisponibles sur sa
 * période. Aucune ligne n'est dans ce cas aujourd'hui, mais rien ne l'empêche —
 * la colonne est nullable.
 *
 * Ici, l'appariement se fait d'abord sur le MATRICULE, identifiant stable
 * (cf. formateur_identity.php), et à défaut sur le nom exact normalisé. Une
 * valeur vide n'apparie jamais rien.
 */
export function formationDuFormateur(formateur, date, formations = []) {
  const jour = enJour(date);
  if (!jour) return null;

  const matricule = cle(formateur?.matricule);
  const nom = cle(formateur?.nomComplet ?? formateur);

  if (matricule === '' && nom === '') return null;

  const concernees = formations.filter((formation) => {
    const matriculeFormation = cle(formation?.matriculeFormateur ?? formation?.matricule_formateur);
    const nomFormation = cle(formation?.nomFormateur ?? formation?.nom_formateur);

    // Le matricule fait foi dès qu'il est renseigné des deux côtés.
    if (matricule !== '' && matriculeFormation !== '') return matriculeFormation === matricule;

    // Repli sur le nom, exact et non vide.
    return nomFormation !== '' && nom !== '' && nomFormation === nom;
  });

  return periodeContenant(jour, concernees);
}

/**
 * Qui manque CE JOUR-LÀ : les groupes en stage, les formateurs en formation.
 *
 * ═══ ⚠️ DEUX PORTÉES QUI NE SE CONFONDENT PAS ═══
 * Les vacances ferment l'ÉTABLISSEMENT, un stage ferme UN GROUPE, une formation
 * ferme UNE PERSONNE. C'est déjà la règle du chronogramme, et elle vaut ici : la
 * grille ne doit verrouiller que la ligne concernée, jamais la colonne entière.
 *
 * ⚠️ ÉCRIT ICI, PAS DANS LE SERVICE. `stageDuGroupe` et `formationDuFormateur`
 * répondent « ce groupe est-il absent ? » — une question par sujet. La grille
 * pose l'inverse : « qui est absent ce jour ? ». Refaire le filtrage de dates
 * dans le service en ferait une seconde définition, et c'est exactement ce que
 * le §4.2 du plan reproche à l'existant.
 *
 * ⚠️ LES BORNES DE LA PÉRIODE SONT RENDUES (2026-08-26), pas seulement son
 * intitulé. Elles étaient déjà lues pour filtrer et jetées aussitôt — or c'est
 * la question qu'on se pose en voyant une ligne verrouillée : jusqu'à QUAND ?
 * Un intitulé seul (« Stage de fin de première année ») ne dit pas si le groupe
 * revient demain ou dans trois semaines.
 *
 * @returns {{stages: Array<{groupe, libelle, debut, fin}>,
 *            formations: Array<{matricule, nom, libelle, debut, fin}>}}
 */
export function absencesDuJour(date, { stages = [], formations = [] } = {}) {
  const jour = enJour(date);
  if (!jour) return { stages: [], formations: [] };

  const bornes = (periode) => ({
    debut: enJour(periode?.debut ?? periode?.date_debut),
    fin: enJour(periode?.fin ?? periode?.date_fin),
  });

  const contient = (periode) => {
    const { debut, fin } = bornes(periode);
    return Boolean(debut && fin && jour >= debut && jour <= fin);
  };

  return {
    stages: stages.filter(contient).map((stage) => ({
      groupe: String(stage?.groupe ?? stage?.groupe_nom ?? '').trim(),
      libelle: String(stage?.libelle ?? stage?.nom ?? '').trim(),
      ...bornes(stage),
    })),
    formations: formations.filter(contient).map((formation) => ({
      matricule: String(formation?.matriculeFormateur ?? formation?.matricule_formateur ?? '').trim(),
      nom: String(formation?.nomFormateur ?? formation?.nom_formateur ?? '').trim(),
      libelle: String(formation?.libelle ?? formation?.nom ?? '').trim(),
      ...bornes(formation),
    })),
  };
}

/**
 * Fusionne les fêtes obtenues de l'API avec les ajustements de l'établissement.
 *
 * Les dates des fêtes religieuses sont des ESTIMATIONS : elles dépendent de
 * l'observation de la lune et sont confirmées tardivement. L'établissement doit
 * donc pouvoir décaler ou retirer une date, sans que le prochain appel à l'API
 * n'écrase sa correction.
 *
 * @param {Array<{date: string, libelle: string}>} depuisApi
 * @param {Array<{libelle: string, date?: string, supprime?: boolean}>} ajustements
 * @returns {Array<{date: string, libelle: string, origine: 'api'|'ajuste'|'manuel'}>}
 */
export function fusionnerJoursFeries(depuisApi = [], ajustements = []) {
  const parLibelle = new Map(ajustements.map((a) => [cle(a?.libelle), a]));
  const utilises = new Set();
  const resultat = [];

  for (const ferie of depuisApi) {
    const libelle = cle(ferie?.libelle);
    const ajustement = parLibelle.get(libelle);

    if (!ajustement) {
      resultat.push({ date: enJour(ferie.date), libelle: ferie.libelle, origine: 'api' });
      continue;
    }

    utilises.add(libelle);
    if (ajustement.supprime) continue; // retiré par l'établissement

    resultat.push({
      date: enJour(ajustement.date ?? ferie.date),
      libelle: ferie.libelle,
      origine: 'ajuste',
    });
  }

  // Ajustements qui ne correspondent à aucune fête de l'API : jours fériés
  // ajoutés à la main par l'établissement.
  for (const ajustement of ajustements) {
    const libelle = cle(ajustement?.libelle);
    if (utilises.has(libelle) || ajustement?.supprime) continue;
    if (!ajustement?.date) continue;

    resultat.push({ date: enJour(ajustement.date), libelle: ajustement.libelle, origine: 'manuel' });
  }

  return resultat.filter((f) => f.date).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Une séance peut-elle avoir lieu ?
 *
 * @returns {{disponible: boolean, motif: string|null, detail: object|null}}
 *   `motif` vaut 'ferie', 'vacances', 'rentree', 'stage' ou 'formation'.
 */
export function disponibilite({
  date,
  groupe = null,
  formateur = null,
  anneeFormation = null,
  joursFeries = [],
  vacances: periodesVacances = [],
  rentrees = [],
  stages = [],
  formations = [],
}) {
  const jour = enJour(date);
  if (!jour) throw new TypeError('disponibilite attend une date valide');

  // Ordre du plus général au plus particulier : un jour férié prime sur tout,
  // et la première cause trouvée est celle qu'on annonce.
  const ferie = jourFerie(jour, joursFeries);
  if (ferie) return { disponible: false, motif: 'ferie', detail: ferie };

  const conges = vacances(jour, periodesVacances);
  if (conges) return { disponible: false, motif: 'vacances', detail: conges };

  /*
   * ═══ ⚠️ LA RENTRÉE PORTE SUR UNE ANNÉE DE FORMATION ═══ (2026-09-02.)
   * Elle vient APRÈS les vacances et AVANT le stage : plus générale qu'un
   * groupe — elle vaut pour tous ceux de son année — mais moins qu'un férié.
   *
   * ⚠️ ELLE DEMANDE `anneeFormation`, QUE L'APPELANT DÉRIVE DU GROUPE
   * (`anneeDuNomGroupe`) : le domaine du calendrier ne connaît pas les règles
   * de nommage des groupes, et les y importer les mettrait à deux endroits.
   *
   * ⚠️ SANS RÉGLAGE, RIEN N'EST GELÉ : `avantRentree` rend `null` quand l'année
   * n'a pas de date. Un défaut inventé figerait des journées que personne n'a
   * déclarées fermées.
   */
  if (anneeFormation !== null && anneeFormation !== undefined) {
    const rentree = avantRentree(jour, anneeFormation, rentrees);
    if (rentree) return { disponible: false, motif: 'rentree', detail: rentree };
  }

  if (groupe) {
    const stage = stageDuGroupe(groupe, jour, stages);
    if (stage) return { disponible: false, motif: 'stage', detail: stage };
  }

  if (formateur) {
    const formation = formationDuFormateur(formateur, jour, formations);
    if (formation) return { disponible: false, motif: 'formation', detail: formation };
  }

  return { disponible: true, motif: null, detail: null };
}
