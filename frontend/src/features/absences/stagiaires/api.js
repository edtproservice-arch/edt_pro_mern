import { api } from '@/lib/apiClient';

/**
 * Absences, retards et indisciplines des stagiaires — la note de discipline (F9).
 * ⚠️ `/api/v2` écrit en entier : `api.get` ne préfixe rien (piège payé deux fois).
 */
const RACINE = '/api/v2/absences-stagiaires';
const requete = (parametres) => new URLSearchParams(parametres).toString();

export const chargerGroupes = () => api.get(`${RACINE}/groupes`);

/**
 * La feuille d'absence hebdomadaire d'un ou plusieurs groupes, en Word, PDF
 * ou Excel (2026-09-29) — `groupes` est la liste que le filtre de « Faire
 * l'appel » laisse visible sur la grille : un fichier, une page (ou un
 * onglet Excel) par groupe.
 */
export const exporterFeuilleAbsence = ({ format, groupes, semaine }) =>
  api.telecharger(`${RACINE}/export`, { format, groupes, semaine }, {
    nomParDefaut: `feuille-absence.${format}`,
  });

/**
 * Les cartes de stagiaire des groupes choisis, en Word ou PDF (2026-10-11).
 * `valeurs.renouveler` : invalide les cartes déjà imprimées (nouveaux QR).
 */
export const exporterCartes = ({ format, groupes, valeurs, matricules }) =>
  api.telecharger(
    `${RACINE}/cartes`,
    // `adresse` : l'application qu'on utilise — c'est là que mèneront les QR (2026-10-11).
    // `matricules` : seulement ces stagiaires (2026-10-17, filtre par stagiaire de Documents).
    {
      format,
      groupes,
      renouveler: Boolean(valeurs?.renouveler),
      adresse: window.location.origin,
      ...(matricules ? { matricules } : {}),
    },
    { nomParDefaut: `cartes-stagiaires.${format}` }
  );

/**
 * Les liens de connexion (et leurs QR) des stagiaires d'un groupe — la colonne
 * QR de la fiche stagiaire (2026-10-11). Réservés à l'encadrement : 403 sinon.
 */
export const chargerLiensCartes = (groupe) =>
  api.get(`${RACINE}/cartes/liens?${requete({ groupe, adresse: window.location.origin })}`);

/** Les notes de discipline des groupes choisis, en Word, PDF ou Excel (2026-10-11) — une page par groupe. */
export const exporterNotes = ({ format, groupes }) =>
  api.telecharger(`${RACINE}/notes/export`, { format, groupes }, { nomParDefaut: `notes-discipline.${format}` });

/** Le registre des absences de l'année en Excel (2026-10-10) — une colonne par jour. */
export const exporterRegistre = () =>
  api.telecharger(`${RACINE}/registre/export`, {}, { nomParDefaut: 'registre-absences.xlsx' });

/**
 * Une feuille de présence d'épreuve d'un ou plusieurs groupes, en Word ou PDF
 * (2026-10-02) — `modele` : `eff` ou `cc-efm`. Une page par groupe.
 */
export const exporterFeuillePresence = (modele) => ({ format, groupes, valeurs, matricules }) =>
  // `valeurs` : les champs saisis dans la fenêtre — la date et l'horaire de la convocation à l'EFF (2026-10-11).
  // `matricules` : seulement ces stagiaires — le PV du conseil d'UN stagiaire (2026-10-11).
  api.telecharger(
    `${RACINE}/presence/${modele}`,
    { format, groupes, ...(valeurs ? { examen: valeurs } : {}), ...(matricules ? { matricules } : {}) },
    { nomParDefaut: `feuille-presence-${modele}.${format}` }
  );

/** Le tableau de bord du gestionnaire (2026-09-29) : absences et discipline, pour tout l'établissement. */
export const chargerTableauDeBord = () => api.get(`${RACINE}/tableau-bord`);

/** Les cours du jour ouverts à l'appel — ceux du formateur connecté, ou du groupe choisi. */
export const chargerSeancesDuJour = ({ date, groupe }) =>
  api.get(`${RACINE}/seances?${requete(groupe ? { date, groupe } : { date })}`);

export const chargerAppel = ({ date, seance, periode, groupe }) =>
  api.get(`${RACINE}/appel?${requete({ date, seance, periode, groupe })}`);

/** L'état de TOUTE la liste : `type` vaut 'absence', 'retard' ou `null` (présent). */
export const enregistrerAppel = (corps) => api.put(`${RACINE}/appel`, corps);

/**
 * Enregistre l'appel ET l'ATTESTE (2026-09-27) — le bouton « Valider l'appel »
 * du formateur, qui remplace l'enregistrement automatique pour lui.
 */
export const validerAppel = (corps) => api.put(`${RACINE}/appel/valider`, corps);

/**
 * Le signe « validé » sur la grille elle-même (2026-09-27, demande du
 * porteur : « un signe de validé sans cliquer sur la séance »).
 */
export const chargerValidationsAppel = ({ debut, fin }) =>
  api.get(`${RACINE}/appel/validations?${requete({ debut, fin })}`);

export const chargerRegistre = (filtre = {}) => {
  const propre = Object.fromEntries(Object.entries(filtre).filter(([, valeur]) => valeur));
  return api.get(`${RACINE}${Object.keys(propre).length ? `?${requete(propre)}` : ''}`);
};

/** Les cours passés dont l'appel n'a pas été validé — le rappel au formateur (2026-10-25). */
export const chargerAppelsEnAttente = () => api.get(`${RACINE}/appel/en-attente`);

export const justifierAbsence = (id, champs) => api.patch(`${RACINE}/${id}`, champs);
/** Toutes les absences non justifiées d'un stagiaire entre deux dates (2026-10-25). */
export const justifierPeriode = (corps) => api.post(`${RACINE}/justifier-periode`, corps);
export const supprimerAbsence = (id) => api.delete(`${RACINE}/${id}`);

/**
 * Le(s) billet(s) d'excuse (Word, PDF ou Excel) d'une ou plusieurs absences
 * et retards JUSTIFIÉS (2026-09-29, demande du porteur : « si un seul
 * stagiaire justifié il s'affiche une seule billet… si deux stagiaires
 * justifient en même temps il s'affiche deux billets »), canevas transmis —
 * autant de billets que d'identifiants, dans le même fichier. Le serveur
 * refuse dès qu'une seule des absences demandées n'est pas justifiée.
 */
export const telechargerBillets = ({ format, ids }) =>
  api.telecharger(`${RACINE}/billets`, { format, ids }, { nomParDefaut: `billets-excuse.${format}` });

/** Une page de quinze billets vierges, à remplir à la main (Word ou PDF). */
export const telechargerBilletsVierges = (format) =>
  api.telecharger(`${RACINE}/billets/vierges`, { format }, { nomParDefaut: `billets-excuse-vierges.${format}` });

/**
 * Un document VIERGE de la page Documents (2026-10-17) — `cle` : `fils-agent`
 * (fiche du candidat fils d'agent), `duplicata` (demande de duplicata imprimée vide),
 * `reorientation` (PV de réorientation imprimé vide).
 */
export const telechargerDocumentVierge = (cle) => (format) =>
  api.telecharger(`${RACINE}/documents-vierges`, { cle, format }, { nomParDefaut: `${cle}.${format}` });

/*
 * Les documents d'une séance, pour l'encadrement (2026-10-26) : fiche de réclamation
 * et feuille CC/EFM d'une séance de N'IMPORTE QUEL formateur de l'établissement.
 */
export const chargerStagiairesDeSeance = (seanceId) =>
  api.get(`${RACINE}/documents-seance/${encodeURIComponent(seanceId)}/stagiaires`);

export const telechargerReclamationDeSeance = ({ seanceId, format, ...demande }) =>
  api.telecharger(`${RACINE}/documents-seance/${encodeURIComponent(seanceId)}/reclamation`, { format, ...demande }, {
    nomParDefaut: `fiche-reclamation.${format}`,
  });

export const telechargerCcEfmDeSeance = ({ seanceId, format, ...demande }) =>
  api.telecharger(`${RACINE}/documents-seance/${encodeURIComponent(seanceId)}/presence-cc-efm`, { format, ...demande }, {
    nomParDefaut: `feuille-presence-cc-efm.${format}`,
  });

/** Un formulaire d'examen vierge, logo OFPPT en tête (2026-10-11) — `cle` : voir le serveur. */
export const telechargerFormulaireExamen = (cle) => (format) =>
  api.telecharger(`${RACINE}/formulaires-examen`, { cle, format }, { nomParDefaut: `${cle}.${format}` });

export const chargerNotes = (groupe) => api.get(`${RACINE}/notes?${requete({ groupe })}`);
export const chargerFiche = (matricule) => api.get(`${RACINE}/stagiaires/${encodeURIComponent(matricule)}`);

export const declarerIndiscipline = (corps) => api.post(`${RACINE}/indisciplines`, corps);
export const retirerIndiscipline = (id) => api.delete(`${RACINE}/indisciplines/${id}`);
