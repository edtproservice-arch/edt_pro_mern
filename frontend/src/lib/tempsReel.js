import { useSyncExternalStore } from 'react';
import { FERMETURES_TEMPS_REEL } from 'shared/schemas';
import { rafraichirSession } from './apiClient';
import { definirConnexionId } from './identiteConnexion';

/**
 * Client de la collaboration en temps réel (Phase 5bis, étape a).
 *
 * ═══ POURQUOI HORS DE REACT ═══
 * UNE socket pour tout l'onglet, quelles que soient les pages ouvertes. Tenue
 * par un composant, elle se fermerait à chaque démontage — donc à chaque
 * navigation — et chaque page rouvrirait la sienne. Elle vit donc dans ce
 * module, comme l'année active, et React s'y abonne par
 * `useSyncExternalStore`.
 *
 * ═══ CE QUI PASSE PAR ICI ═══
 * La présence (qui est sur la page, sur quelle semaine) et les annonces
 * d'écriture. Les écritures elles-mêmes restent des requêtes HTTP.
 */
const CHEMIN = '/api/v2/temps-reel';

/**
 * ⚠️ UN DÉLAI DE GRÂCE AVANT DE FERMER. Passer de « Emploi » à « Édition »
 * démonte une page et en monte une autre : fermer la socket entre les deux la
 * ferait rouvrir aussitôt, et les collègues verraient l'avatar disparaître puis
 * revenir.
 */
const GRACE_FERMETURE_MS = 5_000;

/** Reconnexion : 1 s, 2 s, 4 s… jusqu'à 30 s. */
const ATTENTE_MAX_MS = 30_000;

const VIDE = { membres: [], erreur: null, rejoint: false, droit: null };

let etat = { statut: 'inactif', utilisateurId: null, salles: {} };
const abonnes = new Set();

/*
 * ═══ ⚠️ LES CURSEURS VIVENT DANS UN MAGASIN À PART ═══
 * Ils arrivent jusqu'à vingt fois par seconde et par collègue. Mêlés à `etat`,
 * ils feraient re-rendre à cette cadence tout ce qui lit la présence — dont la
 * page de l'emploi du temps et ses 1 224 cases. Seule la couche des curseurs
 * s'abonne ici.
 *
 * page → Map(connexion publique → { utilisateur, position, focus })
 */
let curseurs = {};
const abonnesCurseurs = new Set();

function publierCurseurs(page, maj) {
  const actuels = new Map(curseurs[page] ?? []);
  maj(actuels);
  curseurs = { ...curseurs, [page]: actuels };
  for (const abonne of abonnesCurseurs) abonne();
}

function viderCurseurs(page) {
  if (!curseurs[page]) return;
  const { [page]: _retire, ...reste } = curseurs;
  curseurs = reste;
  for (const abonne of abonnesCurseurs) abonne();
}

/** page → { anneeScolaire, vue, surModification } */
const pages = new Map();

let ws = null;
let tentative = 0;
let minuteurReconnexion = null;
let minuteurFermeture = null;

function publier(changement) {
  etat = { ...etat, ...changement };
  for (const abonne of abonnes) abonne();
}

function publierSalle(page, changement) {
  publier({ salles: { ...etat.salles, [page]: { ...(etat.salles[page] ?? VIDE), ...changement } } });
}

function envoyer(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function envoyerRejoindre(page) {
  const salle = pages.get(page);
  if (!salle) return;
  envoyer({
    type: 'rejoindre',
    page,
    anneeScolaire: salle.anneeScolaire ?? null,
    ...(salle.vue ? { vue: salle.vue } : {}),
  });
}

function urlSocket() {
  const protocole = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocole}//${window.location.host}${CHEMIN}`;
}

function ouvrir() {
  if (ws || pages.size === 0) return;
  clearTimeout(minuteurReconnexion);
  minuteurReconnexion = null;

  publier({ statut: tentative === 0 ? 'connexion' : 'reconnexion' });

  let socket;
  try {
    socket = new WebSocket(urlSocket());
  } catch {
    planifierReconnexion();
    return;
  }
  ws = socket;

  socket.onmessage = (evenement) => {
    let message;
    try {
      message = JSON.parse(evenement.data);
    } catch {
      return;
    }
    recevoir(message);
  };

  socket.onclose = (evenement) => {
    if (ws !== socket) return;
    ws = null;
    definirConnexionId(null);

    // Les présences d'une socket fermée ne disent plus rien de vrai — ni ses
    // curseurs, qui resteraient figés là où chacun a laissé sa souris.
    const salles = Object.fromEntries(Object.keys(etat.salles).map((page) => [page, VIDE]));
    publier({ salles });
    curseurs = {};
    for (const abonne of abonnesCurseurs) abonne();

    if (pages.size === 0) {
      publier({ statut: 'inactif' });
      return;
    }

    /*
     * ⚠️ LE CODE DE FERMETURE DÉCIDE DE LA SUITE — c'est la seule chose que le
     * navigateur sache d'une socket refusée, il ne voit pas le statut HTTP.
     */
    if (
      evenement.code === FERMETURES_TEMPS_REEL.COMPTE_REFUSE ||
      evenement.code === FERMETURES_TEMPS_REEL.TROP_DE_MESSAGES
    ) {
      publier({ statut: 'arrete' });
      return;
    }

    if (evenement.code === FERMETURES_TEMPS_REEL.REAUTHENTIFIER) {
      /*
       * Jeton expiré ou session révoquée : on passe par le MÊME rafraîchissement
       * que les requêtes HTTP — sa promesse est partagée, donc une requête et la
       * socket qui expirent ensemble ne font tourner le refresh token qu'une
       * fois. S'il échoue, la session est finie : la prochaine requête HTTP
       * renverra vers la connexion, la socket n'a pas à le faire elle-même.
       */
      publier({ statut: 'reconnexion' });
      rafraichirSession().then((reussi) => {
        if (!reussi) {
          publier({ statut: 'arrete' });
          return;
        }
        tentative = 0;
        ouvrir();
      });
      return;
    }

    planifierReconnexion();
  };
}

function planifierReconnexion() {
  if (pages.size === 0 || minuteurReconnexion) return;
  publier({ statut: 'reconnexion' });
  const attente = Math.min(ATTENTE_MAX_MS, 1000 * 2 ** tentative) + Math.random() * 500;
  tentative += 1;
  minuteurReconnexion = setTimeout(() => {
    minuteurReconnexion = null;
    ouvrir();
  }, attente);
}

function recevoir(message) {
  if (message.type === 'bienvenue') {
    tentative = 0;
    definirConnexionId(message.connexionId);
    publier({ statut: 'connecte', utilisateurId: message.utilisateurId });
    // Le serveur n'écoute qu'APRÈS ce message : c'est maintenant qu'on rejoint.
    for (const page of pages.keys()) envoyerRejoindre(page);
    return;
  }

  if (message.type === 'rejoint') {
    publierSalle(message.page, { rejoint: true, erreur: null, droit: message.droit ?? null });
    /*
     * ⚠️ LA VUE A PU CHANGER PENDANT L'ALLER-RETOUR. La semaine s'ouvre souvent
     * juste après l'entrée dans la salle : un `majVue` arrivé avant ce message
     * n'a pas été envoyé (la salle n'était pas encore rejointe), et les autres
     * verraient la personne sur une semaine vide. On renvoie donc la vue
     * courante dès que la salle est acquise.
     */
    const vue = pages.get(message.page)?.vue;
    if (vue) envoyer({ type: 'vue', page: message.page, vue });
    return;
  }

  if (message.type === 'presence') {
    const membres = message.membres ?? [];
    publierSalle(message.page, { membres });
    // Filet : un curseur dont la personne n'est plus présente disparaît, même
    // si l'annonce `parti` s'est perdue.
    const presents = new Set(membres.map((m) => m.id));
    publierCurseurs(message.page, (table) => {
      for (const [cle, entree] of table) if (!presents.has(entree.utilisateur.id)) table.delete(cle);
    });
    return;
  }

  if (message.type === 'curseur' || message.type === 'focus') {
    publierCurseurs(message.page, (table) => {
      const entree = table.get(message.connexion) ?? { utilisateur: message.utilisateur, position: null, focus: null };
      table.set(message.connexion, {
        ...entree,
        utilisateur: message.utilisateur,
        ...(message.type === 'curseur' ? { position: message.position } : { focus: message.focus }),
      });
    });
    return;
  }

  if (message.type === 'parti') {
    publierCurseurs(message.page, (table) => table.delete(message.connexion));
    return;
  }

  /*
   * ⚠️ UN ACCÈS RETIRÉ OU CHANGÉ PENDANT QU'ON EST SUR LA PAGE. Le serveur nous
   * a déjà sortis de la salle ; c'est à l'écran de le dire et d'en tirer la
   * conséquence (quitter la page, passer en lecture).
   */
  if (message.type === 'acces-retire' || message.type === 'acces-modifie') {
    if (message.type === 'acces-retire') {
      publierSalle(message.page, { ...VIDE, erreur: { code: 'ACCES_RETIRE' } });
      viderCurseurs(message.page);
    } else {
      publierSalle(message.page, { droit: message.droit });
    }
    pages.get(message.page)?.surAcces?.(message);
    return;
  }

  if (message.type === 'modification') {
    pages.get(message.page)?.surModification?.(message);
    return;
  }

  if (message.type === 'erreur' && message.page) {
    publierSalle(message.page, { erreur: { code: message.code, message: message.message } });
  }
}

/*
 * Revenir en ligne relance tout de suite une reconnexion en attente, au lieu
 * d'attendre la fin de l'intervalle — qui peut atteindre 30 secondes.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!ws && pages.size > 0) {
      tentative = 0;
      ouvrir();
    }
  });
}

/**
 * Entre dans la salle d'une page. UNE entrée par page à la fois : la dernière
 * l'emporte — il n'y a qu'un écran par page à l'écran.
 *
 * @returns {{ majVue, majAnnee, majRappel, sortir }}
 */
export function entrer(page, { anneeScolaire, vue, surModification, surAcces } = {}) {
  clearTimeout(minuteurFermeture);
  minuteurFermeture = null;

  pages.set(page, { anneeScolaire, vue, surModification, surAcces });
  if (ws?.readyState === WebSocket.OPEN) envoyerRejoindre(page);
  else ouvrir();

  const salle = () => pages.get(page);

  return {
    majVue(nouvelle) {
      if (!salle()) return;
      salle().vue = nouvelle;
      if (etat.salles[page]?.rejoint) envoyer({ type: 'vue', page, vue: nouvelle });
    },
    majAnnee(annee) {
      if (!salle() || salle().anneeScolaire === annee) return;
      salle().anneeScolaire = annee;
      // Le serveur quitte lui-même la salle de l'ancienne année.
      envoyerRejoindre(page);
    },
    majRappel(rappel) {
      if (salle()) salle().surModification = rappel;
    },
    /** Le curseur de CET onglet — `null` quand la souris quitte la grille. */
    envoyerCurseur(position) {
      if (etat.salles[page]?.rejoint) envoyer({ type: 'curseur', page, position });
    },
    /** La case que CET onglet a ouverte pour la saisir — `null` à la fermeture. */
    envoyerFocus(focus) {
      if (etat.salles[page]?.rejoint) envoyer({ type: 'focus', page, focus });
    },
    sortir() {
      pages.delete(page);
      envoyer({ type: 'quitter', page });
      publierSalle(page, VIDE);
      viderCurseurs(page);

      if (pages.size > 0) return;
      clearTimeout(minuteurReconnexion);
      minuteurReconnexion = null;
      minuteurFermeture = setTimeout(() => {
        if (pages.size > 0) return;
        ws?.close(1000, 'PLUS_DE_PAGE');
        ws = null;
        definirConnexionId(null);
        publier({ statut: 'inactif' });
      }, GRACE_FERMETURE_MS);
    },
  };
}

function sAbonner(rappel) {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** L'état de la connexion et des salles, pour React. */
export function useTempsReel() {
  return useSyncExternalStore(sAbonner, () => etat);
}

/** L'état d'une salle — lu par l'écran, jamais modifié. */
export const salleVide = VIDE;

const AUCUN_CURSEUR = new Map();

function sAbonnerCurseurs(rappel) {
  abonnesCurseurs.add(rappel);
  return () => abonnesCurseurs.delete(rappel);
}

/**
 * Lecture IMPÉRATIVE, sans abonnement — pour l'écran qui veut savoir, au moment
 * d'un clic, si la case est déjà ouverte par quelqu'un, sans se re-rendre à
 * chaque mouvement de souris des autres.
 */
export const lireCurseurs = (page) => curseurs[page] ?? AUCUN_CURSEUR;

/** Les curseurs et cases ouvertes des AUTRES sur une page. */
export function useCurseurs(page) {
  return useSyncExternalStore(sAbonnerCurseurs, () => curseurs[page] ?? AUCUN_CURSEUR);
}
