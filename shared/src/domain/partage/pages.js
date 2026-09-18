/**
 * Les pages qu'un directeur peut partager (Phase 5bis, étape d).
 *
 * ═══ UNE SEULE DÉFINITION ═══
 * Le serveur (quelles pages accepter dans une invitation, quelles salles
 * ouvrir), l'écran (le sélecteur de la boîte « Partager », le menu de l'invité)
 * et les modèles (énumérations Mongoose) lisent CETTE table. Une liste recopiée
 * ailleurs finirait par proposer une page que le serveur refuse.
 *
 * Champs :
 *   - `libelle`     ce que l'écran affiche ;
 *   - `url`         où la page s'ouvre en SAISIE ;
 *   - `urlLecture`  où elle s'ouvre pour qui ne peut que consulter, quand
 *                   l'écran de saisie n'a pas de mode lecture (Emploi → Édition) ;
 *   - `droitMax`    le plus haut droit accordable (`consulter` = lecture seule) ;
 *   - `parRole`     ce qu'un rôle y a SANS invitation ;
 *   - `annuelle`    ses données sont rangées par ANNÉE scolaire (séances, base,
 *                   chronogrammes…) ; les autres valent pour l'établissement
 *                   tout entier (salles, stages, calendrier, comptes). C'est ce
 *                   qui dit si la date « Modifié … » change avec l'année affichée ;
 *   - `prete`       ⚠️ la page se PARTAGE : on peut y inviter, et une invitation
 *                   ou l'accès général y ouvrent quelque chose (`droitSurPage`).
 *
 * ═══ SEULES EMPLOI, CHRONOGRAMME ET AFFECTATIONS SE PARTAGENT (2026-09-14) ═══
 * Décision du porteur : ce sont les trois pages où l'on travaille À PLUSIEURS
 * sur une même grille — celles qui ont les curseurs et la case ouverte. Les
 * onze autres ont été ouvertes aux invités aux étapes (d2) à (d4) ; elles
 * reviennent à `prete: false`. Leurs routes gardent le contrôle par droit
 * (`exigerDroitPage`) : sans partage, il ne laisse passer que le directeur et ce
 * qu'un rôle a par défaut (`parRole`) — rouvrir une page ne demande donc que de
 * rebasculer son drapeau.
 *
 * ⚠️ LES CLÉS SONT DES IDENTIFIANTS STOCKÉS (Partage.page, Message.invitation) :
 * on n'en renomme pas une sans migrer les documents.
 */
export const PAGES_PARTAGEABLES = {
  emploi: {
    libelle: 'Emploi du temps',
    groupe: 'planification',
    url: '/app/emploi',
    urlLecture: '/app/edition',
    // Le gestionnaire consulte l'emploi du temps depuis « Édition » (2026-09-03).
    parRole: { gestionnaire: 'consulter' },
    annuelle: true,
    prete: true,
  },
  // Étape d2 (2026-09-12) : Avancement, Absences, Chronogramme et EFM régional
  // se gardent par droit sur la page — routes, salle et écran.
  avancement: { libelle: 'Avancement', groupe: 'suivi', url: '/app/avancement', droitMax: 'consulter', annuelle: true, prete: false },
  absences: { libelle: 'Absences', groupe: 'suivi', url: '/app/absences', annuelle: true, prete: false },
  /*
   * ⚠️ CONSULTATION SEULE (étape d4, 2026-09-13) : la seule écriture de la page
   * est l'import Konosys, qui remplace tous les stagiaires ET supprime les
   * comptes des absents du fichier — il reste au directeur, comme l'import
   * e-note. « Peut modifier » n'y ouvrirait rien de plus : l'afficher mentirait.
   */
  documents: {
    libelle: 'Documents',
    groupe: 'suivi',
    url: '/app/documents',
    droitMax: 'consulter',
    parRole: { gestionnaire: 'consulter' },
    // Une base Konosys par année scolaire depuis le 2026-09-14.
    annuelle: true,
    prete: false,
  },
  // Étape d3 (2026-09-13) : les pages « tout ou rien » — Espaces, Calendrier,
  // Formateurs, Affectations, Stages, Formations, Groupes FQ — s'ouvrent aux
  // invités, sous version optimiste (409 `VERSION_PERIMEE` puis rechargement).
  chronogramme: { libelle: 'Chronogramme', groupe: 'planification', url: '/app/parametres/chronogramme', annuelle: true, prete: true },
  espaces: { libelle: 'Espaces', groupe: 'etablissement', url: '/app/parametres/espaces', prete: false },
  calendrier: { libelle: 'Calendrier', groupe: 'etablissement', url: '/app/parametres/calendrier', prete: false },
  formateurs: { libelle: 'Formateurs', groupe: 'equipes', url: '/app/parametres/formateurs', annuelle: true, prete: false },
  affectations: { libelle: 'Affectations', groupe: 'equipes', url: '/app/parametres/affectations', annuelle: true, prete: true },
  stages: { libelle: 'Stages', groupe: 'etablissement', url: '/app/parametres/stages', prete: false },
  formations: { libelle: 'Formations', groupe: 'etablissement', url: '/app/parametres/formations', prete: false },
  /*
   * ⚠️ CONSULTATION SEULE (décision du porteur, 2026-09-12) : « modifier »
   * permettrait de réinitialiser le mot de passe d'un collègue — et, pour un
   * compte sans vraie adresse, de le lire à l'écran. Une prise de compte.
   */
  sessions: { libelle: 'Sessions', groupe: 'equipes', url: '/app/parametres/sessions', droitMax: 'consulter', prete: false },
  groupesFq: { libelle: 'Groupes (FQ)', groupe: 'equipes', url: '/app/parametres/groupes-fq', prete: false },
  efm: { libelle: 'EFM régional', groupe: 'planification', url: '/app/parametres/efm-regional', annuelle: true, prete: false },
};

export const PAGES_COLLABORATIVES = Object.keys(PAGES_PARTAGEABLES);

/**
 * Les colonnes de la carte « Partagé » (2026-09-12, demande du porteur : quand
 * le directeur partage beaucoup de pages, une carte au survol qui les range).
 *
 * ⚠️ DANS LE REGISTRE, PAS DANS L'ÉCRAN : la barre du formateur et la barre
 * latérale du gestionnaire rangent les mêmes pages ; deux classements écrits
 * chacun de son côté finiraient par placer Stages dans deux colonnes différentes.
 * L'ordre du tableau est celui des colonnes — du geste quotidien au réglage.
 */
export const GROUPES_PAGES = [
  { cle: 'planification', libelle: 'Planification' },
  { cle: 'suivi', libelle: 'Suivi' },
  { cle: 'etablissement', libelle: 'Établissement' },
  { cle: 'equipes', libelle: 'Équipes & groupes' },
];

/**
 * Range des entrées par colonne. Chaque entrée porte sa clé de page dans
 * `page`. Une colonne vide n'est pas rendue — une en-tête suivie de rien fait
 * chercher ce qui manque. L'ordre des entrées est conservé dans chaque colonne.
 *
 * ⚠️ UNE PAGE SANS GROUPE (ou inconnue) N'EST PAS PERDUE : elle tombe dans une
 * dernière colonne « Autres ». Écarter en silence une page réellement partagée
 * la rendrait inatteignable.
 *
 * @param {{ page: string }[]} entrees
 * @returns {{ cle: string, libelle: string, entrees: object[] }[]}
 */
export function grouperPages(entrees) {
  const colonnes = [...GROUPES_PAGES, { cle: 'autres', libelle: 'Autres' }].map((groupe) => ({
    ...groupe,
    entrees: [],
  }));
  const parCle = new Map(colonnes.map((colonne) => [colonne.cle, colonne]));

  for (const entree of entrees ?? []) {
    const cle = PAGES_PARTAGEABLES[entree?.page]?.groupe;
    (parCle.get(cle) ?? parCle.get('autres')).entrees.push(entree);
  }
  return colonnes.filter((colonne) => colonne.entrees.length > 0);
}

/** Les pages qu'on peut réellement proposer au partage aujourd'hui. */
export const pagesPretes = () => PAGES_COLLABORATIVES.filter((page) => PAGES_PARTAGEABLES[page].prete);

export const pagePrete = (page) => Boolean(PAGES_PARTAGEABLES[page]?.prete);

export const libellePage = (page) => PAGES_PARTAGEABLES[page]?.libelle ?? page;

/**
 * Le droit réellement accordé sur une page : jamais au-delà de son `droitMax`.
 * Inviter « à modifier » sur une page en lecture seule donne « consulter ».
 */
export function droitBorne(page, droit) {
  const maximum = PAGES_PARTAGEABLES[page]?.droitMax;
  return maximum === 'consulter' && droit === 'modifier' ? 'consulter' : droit;
}

/** Où ouvrir une page pour ce droit : la lecture quand la saisie n'est pas permise. */
export function urlDePage(page, droit) {
  const definition = PAGES_PARTAGEABLES[page];
  if (!definition) return null;
  return droit === 'consulter' && definition.urlLecture ? definition.urlLecture : definition.url;
}

/** Ses données sont-elles rangées par année scolaire ? Voir `annuelle`. */
export const pageAnnuelle = (page) => Boolean(PAGES_PARTAGEABLES[page]?.annuelle);
