import { SEANCES_JOUR, SEANCE_SOIR } from './grille.js';

/**
 * Les horaires d'horloge des créneaux S1 à S4 — trois jeux, un seul en vigueur.
 * (demande du porteur, 2026-09-20 : « en admin, page calendrier, l'option de changer
 * l'horaire — hiver, été, ramadan — appliquée dans toutes les sessions : directeur,
 * stagiaires, formateurs, gestionnaire ; ces valeurs sont par défaut, je peux les
 * modifier ».)
 *
 * ═══ ⚠️ CE QUI CHANGE, ET CE QUI NE CHANGE PAS ═══
 * Change : l'HEURE D'HORLOGE affichée d'un créneau (agenda, absences), « la séance est-elle
 * terminée ? » (avancement) et le libellé des pauses. Ne change PAS : la DURÉE COMPTABLE
 * d'une séance (`dureeSeance`, 2,5 h) — c'est elle qui compte les heures posées, l'avancement
 * et les objectifs. Un créneau de ramadan de 1 h 50 reste une séance d'une unité : y
 * toucher ferait varier tous les cumuls d'heures selon le mois.
 *
 * ═══ ⚠️ LE VENDREDI A SON PROPRE TABLEAU, PAR JEU ═══ La prière de midi décale S3 et
 * raccourcit S1/S2 (voir `consultation.js`). Il est donc porté par chaque jeu, et modifiable
 * comme le reste — plutôt qu'une règle codée en dur qui ne suivrait pas le ramadan.
 *
 * ⚠️ LE SOIR (S5) N'EST PAS UN CRÉNEAU DE CE RÉGLAGE : il garde son horaire fixe.
 */

export const NOMS_HORAIRES = ['hiver', 'ete', 'ramadan'];

export const LIBELLES_HORAIRES = {
  hiver: 'Horaire d’hiver',
  ete: 'Horaire d’été',
  ramadan: 'Horaire de ramadan',
};

/** Le créneau du soir : hors réglage. */
const HORAIRE_SOIR = { debut: '19:00', fin: '21:00' };

const creneaux = (lignes) =>
  Object.fromEntries(SEANCES_JOUR.map((creneau, i) => [creneau, { debut: lignes[i][0], fin: lignes[i][1] }]));

/**
 * ⚠️ Les valeurs du porteur (2026-09-20) : hiver et été identiques ; ramadan resserré.
 * Le vendredi d'hiver/été reprend l'horaire jusqu'ici codé en dur (prière : S3 à 14:30).
 * Celui de ramadan n'a pas été donné : il reprend, faute de mieux, le tableau de ramadan de la
 * semaine — modifiable dans le réglage.
 */
const SEMAINE_HIVER = creneaux([
  ['08:00', '10:30'],
  ['10:30', '13:00'],
  ['13:30', '16:00'],
  ['16:00', '18:30'],
]);
const VENDREDI_HIVER = creneaux([
  ['08:30', '10:30'],
  ['10:30', '12:30'],
  ['14:30', '16:30'],
  ['16:30', '18:30'],
]);
const SEMAINE_RAMADAN = creneaux([
  ['08:30', '10:20'],
  ['10:25', '12:15'],
  ['12:45', '14:40'],
  ['14:40', '16:30'],
]);

const cloner = (valeur) => JSON.parse(JSON.stringify(valeur));

/** Le réglage d'origine : le jeu en vigueur, et les trois jeux complets. */
export const HORAIRES_PAR_DEFAUT = Object.freeze({
  actif: 'hiver',
  horaires: {
    hiver: { semaine: SEMAINE_HIVER, vendredi: VENDREDI_HIVER },
    ete: { semaine: cloner(SEMAINE_HIVER), vendredi: cloner(VENDREDI_HIVER) },
    ramadan: { semaine: SEMAINE_RAMADAN, vendredi: cloner(SEMAINE_RAMADAN) },
  },
});

/** Le jeu d'origine d'un horaire (« Rétablir les valeurs par défaut »). */
export const horaireParDefaut = (nom) => cloner(HORAIRES_PAR_DEFAUT.horaires[nom]);

const estHeure = (valeur) => typeof valeur === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valeur);

/**
 * Complète ce qui est stocké avec les valeurs d'origine, créneau par créneau.
 *
 * ⚠️ UNE BASE INCOMPLÈTE OU ABÎMÉE NE DOIT PAS CASSER L'AGENDA : un jeu absent, un créneau
 * sans heure, un `actif` inconnu retombent sur l'origine — l'écran de tous les comptes en
 * dépend, jamais un `undefined.debut`.
 */
export function configurationHoraires(stocke) {
  const resultat = {
    actif: NOMS_HORAIRES.includes(stocke?.actif) ? stocke.actif : HORAIRES_PAR_DEFAUT.actif,
    horaires: {},
  };

  for (const nom of NOMS_HORAIRES) {
    resultat.horaires[nom] = {};
    for (const tableau of ['semaine', 'vendredi']) {
      resultat.horaires[nom][tableau] = {};
      for (const creneau of SEANCES_JOUR) {
        const origine = HORAIRES_PAR_DEFAUT.horaires[nom][tableau][creneau];
        const lu = stocke?.horaires?.[nom]?.[tableau]?.[creneau];
        resultat.horaires[nom][tableau][creneau] = {
          debut: estHeure(lu?.debut) ? lu.debut : origine.debut,
          fin: estHeure(lu?.fin) ? lu.fin : origine.fin,
        };
      }
    }
  }
  return resultat;
}

/**
 * La table que les écrans lisent : le jeu EN VIGUEUR, soir compris.
 * `{ semaine: { S1..S5 }, vendredi: { S1..S5 } }`, chaque créneau `{ debut, fin }`.
 */
export function horairesCourants(configuration) {
  const { actif, horaires } = configurationHoraires(configuration);
  const jeu = horaires[actif];
  return {
    semaine: { ...jeu.semaine, [SEANCE_SOIR]: { ...HORAIRE_SOIR } },
    vendredi: { ...jeu.vendredi, [SEANCE_SOIR]: { ...HORAIRE_SOIR } },
  };
}

/** Ce qu'utilisent les appelants qui ne fournissent pas de réglage (tests, chargement). */
export const HORAIRES_COURANTS_PAR_DEFAUT = Object.freeze(horairesCourants(HORAIRES_PAR_DEFAUT));

/** « 08:30 » → 510. */
export const enMinutes = (heure) => {
  const [h, m] = String(heure).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Les incohérences d'un jeu, en clair — la même règle sert l'écran (avant d'enregistrer) et le
 * serveur (le schéma). Un créneau finit après son début ; le suivant ne commence pas avant que
 * le précédent finisse (un écart est une pause, un chevauchement est une erreur).
 *
 * @returns {Array<{ tableau: 'semaine'|'vendredi', creneau: string, champ: 'debut'|'fin', message: string }>}
 */
export function erreursHoraire(jeu) {
  const erreurs = [];
  for (const tableau of ['semaine', 'vendredi']) {
    let precedent = null;
    for (const creneau of SEANCES_JOUR) {
      const { debut, fin } = jeu?.[tableau]?.[creneau] ?? {};
      if (!estHeure(debut)) erreurs.push({ tableau, creneau, champ: 'debut', message: 'Heure attendue (HH:MM)' });
      if (!estHeure(fin)) erreurs.push({ tableau, creneau, champ: 'fin', message: 'Heure attendue (HH:MM)' });
      if (estHeure(debut) && estHeure(fin)) {
        if (enMinutes(fin) <= enMinutes(debut)) {
          erreurs.push({ tableau, creneau, champ: 'fin', message: 'La fin doit suivre le début' });
        }
        if (precedent && enMinutes(debut) < enMinutes(precedent.fin)) {
          erreurs.push({ tableau, creneau, champ: 'debut', message: `Ne peut pas commencer avant la fin de ${precedent.creneau}` });
        }
        precedent = { creneau, fin };
      }
    }
  }
  return erreurs;
}
