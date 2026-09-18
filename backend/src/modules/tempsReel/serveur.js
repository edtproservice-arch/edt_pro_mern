import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { FERMETURES_TEMPS_REEL, messageTempsReelSchema } from 'shared/schemas';
import { env, isProduction } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { chargerSession } from '../../middleware/authenticate.js';
import { resoudreContexte } from '../../middleware/resolveTenant.js';
import { droitDe } from '../partages/partages.service.js';
import { cleSalle, creerRegistre } from './salles.js';

/**
 * Collaboration en temps réel (Phase 5bis, étape a).
 *
 * ═══ CE QUI PASSE PAR ICI, ET CE QUI N'Y PASSE PAS ═══
 * La socket transporte la PRÉSENCE (qui est sur la page, sur quelle semaine) et
 * l'ANNONCE qu'une écriture a eu lieu. Les écritures elles-mêmes restent des
 * requêtes HTTP : c'est là que vivent les conflits, les quotas, le gel de
 * rentrée. Faire écrire la socket, ce serait réécrire ces contrôles une seconde
 * fois — ou pire, les contourner.
 *
 * ⚠️ `ws`, PAS Socket.IO (décision du 2026-09-12) : le navigateur a un client
 * WebSocket natif, et Socket.IO imposerait le sien ainsi qu'un adaptateur Redis
 * dès la deuxième instance de l'API.
 */
export const CHEMIN_TEMPS_REEL = '/api/v2/temps-reel';

const COOKIE_ACCESS = 'edt_access';

/** Intervalle des pings : sous les 60 s par défaut de `proxy_read_timeout`. */
const INTERVALLE_PING_MS = 25_000;

/** Un message pèse quelques centaines d'octets ; 16 Kio bornent l'abus. */
const TAILLE_MAX = 16 * 1024;

/**
 * ⚠️ BORNE DE DÉBIT PAR CONNEXION. L'étape (b) enverra un curseur au plus toutes
 * les 50 ms, soit 20 par seconde : 40 laisse la marge, et au-delà le client est
 * défaillant — ou malveillant. Sans borne, une seule socket suffirait à occuper
 * le processus qui sert aussi toute l'API.
 */
const MESSAGES_PAR_SECONDE = 40;

/**
 * Lit un cookie dans l'en-tête brut. La poignée de main WebSocket ne passe pas
 * par Express, donc pas par `cookie-parser`.
 */
export function lireCookie(entete, nom) {
  for (const morceau of String(entete ?? '').split(';')) {
    const egal = morceau.indexOf('=');
    if (egal === -1) continue;
    if (morceau.slice(0, egal).trim() !== nom) continue;
    try {
      return decodeURIComponent(morceau.slice(egal + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Les origines admises à ouvrir une socket.
 *
 * ═══ ⚠️ LE CONTRÔLE D'ORIGINE EST INDISPENSABLE ═══
 * Une poignée de main WebSocket n'est pas soumise à la politique de même
 * origine : sans ce contrôle, n'importe quel site pourrait ouvrir une socket
 * vers l'API avec le cookie de la victime (« cross-site WebSocket hijacking »).
 * `SameSite=Lax` limite déjà l'envoi du cookie depuis un autre site, mais c'est
 * une défense des navigateurs, pas du serveur — on ne s'y fie pas seul.
 *
 * ⚠️ PAS LE `Host` DE LA REQUÊTE : en développement, le proxy de Vite le
 * réécrit (`changeOrigin`) alors que l'`Origin` reste celle de la page.
 */
export function originesAutorisees() {
  const liste = new Set();
  try {
    liste.add(new URL(env.APP_URL).origin);
  } catch {
    // APP_URL mal formée : les autres entrées suffisent en développement.
  }
  for (const origine of String(env.WS_ORIGINES ?? '').split(',')) {
    if (origine.trim()) liste.add(origine.trim());
  }
  if (!isProduction) {
    liste.add('http://localhost:5173');
    liste.add('http://127.0.0.1:5173');
  }
  return liste;
}

/**
 * Branche le serveur temps réel sur un serveur HTTP.
 *
 * ⚠️ DANS `server.js`, PAS DANS `app.js` : l'application Express reste montable
 * sans port par Supertest, et c'est le serveur HTTP — pas Express — qui reçoit
 * la demande de changement de protocole.
 *
 * @returns {{ fermer: () => Promise<void>, registre }}
 */
export function attacherTempsReel(serveurHttp) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: TAILLE_MAX });
  const registre = creerRegistre();
  const origines = originesAutorisees();
  /** Toutes les connexions ouvertes, pour la révocation et le ping. */
  const connexions = new Set();
  let horloge = 0;

  // ═══ Poignée de main ═══
  function surUpgrade(req, socket, tete) {
    let chemin;
    try {
      chemin = new URL(req.url, 'http://localhost').pathname;
    } catch {
      chemin = null;
    }

    if (chemin !== CHEMIN_TEMPS_REEL) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!origines.has(req.headers.origin)) {
      logger.warn({ origine: req.headers.origin }, 'Socket temps réel refusée : origine');
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    /*
     * ⚠️ L'AUTHENTIFICATION SE FAIT APRÈS LA POIGNÉE DE MAIN, et c'est voulu : le
     * navigateur ne voit PAS le statut HTTP d'une poignée de main refusée — un
     * 401 et une panne réseau lui arrivent sous la même forme, une fermeture
     * 1006. Seul un code de fermeture lui dit « rafraîchis ta session » plutôt
     * que « réessaie plus tard ». La socket non authentifiée ne reçoit rien et
     * se ferme aussitôt.
     */
    wss.handleUpgrade(req, socket, tete, (ws) => accueillir(ws, req));
  }

  serveurHttp.on('upgrade', surUpgrade);

  async function accueillir(ws, req) {
    let session;
    try {
      session = await chargerSession(lireCookie(req.headers.cookie, COOKIE_ACCESS));
    } catch (erreur) {
      const refuse = ['COMPTE_DESACTIVE', 'COMPTE_BLOQUE'].includes(erreur.code);
      ws.close(
        refuse ? FERMETURES_TEMPS_REEL.COMPTE_REFUSE : FERMETURES_TEMPS_REEL.REAUTHENTIFIER,
        erreur.code ?? 'NON_AUTHENTIFIE'
      );
      return;
    }

    const { utilisateur, impersonateur, charge } = session;

    const connexion = {
      id: crypto.randomUUID(),
      /*
       * ⚠️ UN SECOND IDENTIFIANT, PUBLIC. `id` est celui que l'onglet renvoie
       * dans `X-Connexion-Id` pour être écarté des annonces : le montrer aux
       * autres permettrait à un client malveillant de s'en servir pour priver
       * un collègue des annonces. Les curseurs sont donc rattachés à celui-ci,
       * qui ne donne aucun pouvoir.
       */
      idPublic: crypto.randomUUID(),
      ws,
      /*
       * ⚠️ LE DOCUMENT MONGOOSE EST GARDÉ pour `resoudreContexte`, qui lit
       * `etablissementIds`. Un établissement retiré au compte APRÈS l'ouverture
       * de la socket ne sera donc refusé qu'au prochain `rejoindre` — ou à
       * l'expiration du jeton, qui ferme la socket de toute façon.
       */
      document: utilisateur,
      utilisateur: { id: String(utilisateur.id), nom: utilisateur.nomComplet, role: utilisateur.role },
      // Présenté aux autres : qu'ils sachent que ce n'est pas le directeur
      // lui-même qui regarde, mais l'administration à sa place.
      usurpePar: impersonateur?.nomComplet ?? null,
      /** cle de salle → { page, vue, misAJour } */
      salles: new Map(),
      estVivant: true,
      fenetre: { debut: Date.now(), compte: 0 },
      expiration: null,
    };

    connexions.add(connexion);

    /*
     * ⚠️ LA SOCKET SE FERME À L'EXPIRATION DU JETON. Un access token vit 15 min,
     * une socket des heures : sans cette fermeture, un compte dont la session a
     * été révoquée continuerait de voir la page indéfiniment. Le client
     * rafraîchit alors sa session par HTTP — le mécanisme existe déjà — et se
     * reconnecte avec le nouveau cookie.
     */
    const restant = charge.exp * 1000 - Date.now();
    connexion.expiration = setTimeout(
      () => ws.close(FERMETURES_TEMPS_REEL.REAUTHENTIFIER, 'JETON_EXPIRE'),
      // setTimeout déborde au-delà de 2³¹ ms et partirait AUSSITÔT.
      Math.max(0, Math.min(restant, 2 ** 31 - 1))
    );

    ws.on('pong', () => {
      connexion.estVivant = true;
    });
    /*
     * ⚠️ LES MESSAGES D'UNE CONNEXION SONT TRAITÉS DANS L'ORDRE, UN À LA FOIS.
     * `rejoindre` lit la base : un `vue` arrivé pendant cette lecture trouverait
     * une salle pas encore inscrite et serait perdu — la personne apparaîtrait
     * aux autres sur la semaine qu'elle vient de quitter.
     */
    connexion.file = Promise.resolve();
    ws.on('message', (donnees, estBinaire) => {
      connexion.file = connexion.file.then(() => surMessage(connexion, donnees, estBinaire));
    });
    ws.on('close', () => quitterTout(connexion));
    ws.on('error', (erreur) => logger.debug({ err: erreur }, 'Erreur de socket temps réel'));

    /*
     * ⚠️ LE CLIENT ATTEND CE MESSAGE AVANT D'ENVOYER QUOI QUE CE SOIT.
     * L'authentification est asynchrone (lecture du compte en base) : un
     * `rejoindre` envoyé dès l'ouverture arriverait avant que ce gestionnaire ne
     * soit branché, et serait perdu sans que rien ne le signale.
     */
    envoyer(ws, {
      type: 'bienvenue',
      connexionId: connexion.id,
      utilisateurId: connexion.utilisateur.id,
    });
  }

  // ═══ Messages ═══
  async function surMessage(connexion, donnees, estBinaire) {
    if (!respecteLeDebit(connexion)) {
      connexion.ws.close(FERMETURES_TEMPS_REEL.TROP_DE_MESSAGES, 'TROP_DE_MESSAGES');
      return;
    }

    let brut;
    try {
      brut = estBinaire ? null : JSON.parse(donnees.toString('utf8'));
    } catch {
      brut = null;
    }

    const lecture = messageTempsReelSchema.safeParse(brut);
    if (!lecture.success) {
      /*
       * ⚠️ UN MESSAGE INVALIDE NE FERME PAS LA SOCKET : il est refusé, et dit.
       * Fermer pour une faute de forme ferait perdre la présence au premier
       * défaut de version entre deux onglets — un onglet resté ouvert pendant
       * une mise à jour parle encore l'ancien protocole.
       */
      envoyer(connexion.ws, { type: 'erreur', code: 'MESSAGE_INVALIDE', message: 'Message illisible' });
      return;
    }

    const message = lecture.data;
    try {
      if (message.type === 'rejoindre') await rejoindre(connexion, message);
      else if (message.type === 'vue') changerVue(connexion, message);
      else if (message.type === 'quitter') quitterPage(connexion, message.page);
      else if (message.type === 'curseur') relayer(connexion, message.page, 'curseur', { position: message.position });
      else if (message.type === 'focus') relayer(connexion, message.page, 'focus', { focus: message.focus });
    } catch (erreur) {
      envoyer(connexion.ws, {
        type: 'erreur',
        page: message.page,
        code: erreur.code ?? 'ERREUR',
        // Seules les erreurs construites exprès sont montrées — jamais
        // `erreur.message` d'une exception imprévue (constat §4.6).
        message: erreur.expose ? erreur.message : 'Impossible de rejoindre la page',
      });
    }
  }

  function respecteLeDebit(connexion) {
    const maintenant = Date.now();
    if (maintenant - connexion.fenetre.debut >= 1000) {
      connexion.fenetre = { debut: maintenant, compte: 0 };
    }
    connexion.fenetre.compte += 1;
    return connexion.fenetre.compte <= MESSAGES_PAR_SECONDE;
  }

  async function rejoindre(connexion, { page, anneeScolaire, etablissementId, vue }) {
    // ⚠️ La MÊME résolution que `resolveTenant` : un établissement qui
    // n'appartient pas au compte est refusé, jamais pris tel quel.
    const contexte = await resoudreContexte(connexion.document, etablissementId, anneeScolaire);

    /*
     * ⚠️ LE MÊME DROIT QUE LES ROUTES HTTP (`droitDe`) : une salle plus ouverte
     * que les données qu'elle annonce laisserait savoir QUAND et PAR QUI une
     * semaine est modifiée à quelqu'un qui n'a pas le droit de la lire.
     */
    const acces = await droitDe(connexion.document, contexte.etablissementId, contexte.anneeScolaire, page);
    if (!acces) {
      const erreur = new Error('Cette page ne vous est pas partagée');
      erreur.code = 'ACCES_REFUSE';
      erreur.expose = true;
      throw erreur;
    }

    /*
     * ⚠️ LA SOCKET A PU SE FERMER PENDANT LA RÉSOLUTION (qui lit la base). Sans
     * ce contrôle, on inscrirait dans la salle une connexion morte que plus rien
     * ne retirerait : elle resterait affichée dans la pile d'avatars.
     */
    if (connexion.ws.readyState !== connexion.ws.OPEN) return;

    const cle = cleSalle(contexte.etablissementId, contexte.anneeScolaire, page);

    // Une connexion n'occupe qu'UNE salle par page : changer d'année quitte
    // l'ancienne, sinon on apparaîtrait sur deux années à la fois.
    quitterPage(connexion, page, { sauf: cle });

    connexion.salles.set(cle, { page, vue: vue ?? {}, droit: acces.droit, misAJour: ++horloge });
    registre.ajouter(cle, connexion);

    envoyer(connexion.ws, {
      type: 'rejoint',
      page,
      anneeScolaire: contexte.anneeScolaire,
      etablissementId: contexte.etablissementId,
      droit: acces.droit,
    });
    diffuserPresence(cle, page);
  }

  function changerVue(connexion, { page, vue }) {
    for (const [cle, etat] of connexion.salles) {
      if (etat.page !== page) continue;
      etat.vue = vue;
      etat.misAJour = ++horloge;
      diffuserPresence(cle, page);
    }
  }

  function quitterPage(connexion, page, { sauf } = {}) {
    for (const [cle, etat] of [...connexion.salles]) {
      if (etat.page !== page || cle === sauf) continue;
      sortirDe(connexion, cle, etat.page);
    }
  }

  function sortirDe(connexion, cle, page) {
    connexion.salles.delete(cle);
    registre.retirer(cle, connexion);
    // Son curseur et sa case ouverte disparaissent avec lui chez les autres.
    for (const autre of registre.connexionsDe(cle)) {
      envoyer(autre.ws, { type: 'parti', page, connexion: connexion.idPublic });
    }
    diffuserPresence(cle, page);
  }

  /**
   * Relaie le curseur ou la case ouverte d'une personne aux autres membres de
   * la salle.
   *
   * ⚠️ RIEN N'EST ÉCRIT NI GARDÉ : un curseur n'a de valeur qu'à l'instant. Le
   * stocker pour le rejouer aux arrivants montrerait une souris qui n'est plus
   * là. Un arrivant voit les curseurs dès leur prochain mouvement.
   *
   * ⚠️ UN MEMBRE « PEUT CONSULTER » N'OUVRE AUCUNE CASE : sa `focus` n'est pas
   * relayée — elle dessinerait chez les autres « X modifie » pour quelqu'un qui
   * ne le peut pas.
   */
  function relayer(connexion, page, type, charge) {
    for (const [cle, etat] of connexion.salles) {
      if (etat.page !== page) continue;
      if (type === 'focus' && charge.focus && etat.droit === 'consulter') return;
      for (const autre of registre.connexionsDe(cle)) {
        if (autre === connexion) continue;
        envoyer(autre.ws, {
          type,
          page,
          connexion: connexion.idPublic,
          utilisateur: { id: connexion.utilisateur.id, nom: connexion.utilisateur.nom },
          ...charge,
        });
      }
    }
  }

  function quitterTout(connexion) {
    clearTimeout(connexion.expiration);
    connexions.delete(connexion);
    for (const [cle, etat] of [...connexion.salles]) sortirDe(connexion, cle, etat.page);
  }

  function diffuserPresence(cle, page) {
    const membres = registre.presence(cle);
    for (const autre of registre.connexionsDe(cle)) {
      envoyer(autre.ws, { type: 'presence', page, membres });
    }
  }

  // ═══ Annonces venues des routes ═══
  function surModification(evenement) {
    const cle = cleSalle(evenement.etablissementId, evenement.anneeScolaire, evenement.page);
    const { etablissementId, anneeScolaire, origine, ...charge } = evenement;

    for (const connexion of registre.connexionsDe(cle)) {
      if (connexion.id === origine) continue;
      envoyer(connexion.ws, { type: 'modification', ...charge });
    }
  }

  function surRevocation({ utilisateurIds }) {
    const cibles = new Set(utilisateurIds);
    for (const connexion of connexions) {
      if (cibles.has(connexion.utilisateur.id)) {
        connexion.ws.close(FERMETURES_TEMPS_REEL.REAUTHENTIFIER, 'SESSION_REVOQUEE');
      }
    }
  }

  /**
   * Un droit a changé : on le relit pour chaque membre concerné de la salle.
   *
   * ═══ ⚠️ RETIRER UNE INVITATION FERME LA PAGE SUR-LE-CHAMP ═══
   * Sans cette relecture, un invité retiré garderait la salle — donc les
   * annonces et les curseurs des autres — jusqu'à fermer son onglet. Il est
   * sorti de la salle et prévenu (`acces-retire`) ; son écran le renvoie
   * ailleurs. Celui dont le droit CHANGE est prévenu aussi (`acces-modifie`),
   * pour que son écran passe en lecture ou en écriture sans recharger.
   */
  async function surPartage({ etablissementId, anneeScolaire, page, utilisateurId }) {
    const cle = cleSalle(etablissementId, anneeScolaire, page);
    for (const connexion of registre.connexionsDe(cle)) {
      if (utilisateurId && connexion.utilisateur.id !== utilisateurId) continue;
      const etat = connexion.salles.get(cle);
      if (!etat) continue;

      let acces;
      try {
        acces = await droitDe(connexion.document, etablissementId, anneeScolaire, page);
      } catch (erreur) {
        logger.error({ err: erreur }, 'Relecture de droit impossible');
        continue;
      }

      if (!acces) {
        sortirDe(connexion, cle, page);
        envoyer(connexion.ws, { type: 'acces-retire', page });
      } else if (acces.droit !== etat.droit) {
        etat.droit = acces.droit;
        envoyer(connexion.ws, { type: 'acces-modifie', page, droit: acces.droit });
        diffuserPresence(cle, page);
      }
    }
  }

  bus.on(EVENEMENTS.MODIFICATION, surModification);
  bus.on(EVENEMENTS.SESSIONS_REVOQUEES, surRevocation);
  bus.on(EVENEMENTS.PARTAGE_MODIFIE, surPartage);

  /*
   * ⚠️ LE PING DÉTECTE LES CONNEXIONS MORTES. Un portable qui se met en veille
   * ne ferme pas sa socket : sans ping, il resterait affiché présent jusqu'au
   * redémarrage du serveur. Une connexion qui n'a pas répondu au ping précédent
   * est coupée.
   */
  const ping = setInterval(() => {
    for (const connexion of connexions) {
      if (!connexion.estVivant) {
        connexion.ws.terminate();
        continue;
      }
      connexion.estVivant = false;
      connexion.ws.ping();
    }
  }, INTERVALLE_PING_MS);
  ping.unref();

  function fermer() {
    clearInterval(ping);
    bus.off(EVENEMENTS.MODIFICATION, surModification);
    bus.off(EVENEMENTS.SESSIONS_REVOQUEES, surRevocation);
    bus.off(EVENEMENTS.PARTAGE_MODIFIE, surPartage);
    serveurHttp.off('upgrade', surUpgrade);
    for (const connexion of connexions) connexion.ws.terminate();
    return new Promise((resoudre) => wss.close(() => resoudre()));
  }

  return { fermer, registre };
}

function envoyer(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
