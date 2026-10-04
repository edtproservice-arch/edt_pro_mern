import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { ecouterGuidage, envoyerGuidage } from '@/lib/tempsReel';
import { ancrer, fractionDefilement, zoneGuidage } from './positions';
import { cheminRecu, defilementRecu } from './echo';
import { champDe, cliquableDe, declencheurDe, decrire, etatBarre, etatDe, fenetresOuvertes } from './gestes';

/**
 * Le guidage, côté ADMINISTRATEUR EN COLLABORATION (2026-10-03, demande du
 * porteur : « lorsque je bascule entre les pages, lui aussi il bascule, il voit
 * mon curseur — utile pour les démonstrations et la formation à distance »).
 *
 * ═══ AUTOMATIQUE (2026-10-04, demande du porteur) ═══ « Lorsque je collabore,
 * j'entre automatiquement en mode guidage » : plus de bouton « Guider le
 * directeur », plus de « Ne plus suivre » chez lui. Toute la collaboration est
 * un guidage.
 *
 * ⚠️ HORS DE REACT, LE NOMBRE DE DIRECTEURS EN LIGNE : la coquille l'apprend,
 * le bandeau l'affiche — deux composants qui ne se connaissent pas.
 */
let etat = { spectateurs: null };
const abonnes = new Set();

function publier(changement) {
  etat = { ...etat, ...changement };
  for (const abonne of abonnes) abonne();
}

export function useEtatGuidage() {
  return useSyncExternalStore(
    (rappel) => {
      abonnes.add(rappel);
      return () => abonnes.delete(rappel);
    },
    () => etat
  );
}

/** ⚠️ Débits bornés : le serveur coupe une socket au-delà de 40 messages/s. */
const PAS_CURSEUR_MS = 60;
const PAS_DEFILEMENT_MS = 120;

/**
 * ═══ DANS LES DEUX SENS (2026-10-04, demande du porteur : « chaque action que
 * fait le directeur doit s'afficher chez moi aussi ») ═══ Le directeur guidé
 * émet à son tour : `actif` = émettre ses gestes, `annonceur` = c'est
 * l'administrateur, qui ouvre et ferme le guidage.
 *
 * ⚠️ JAMAIS D'ÉCHO : un geste REJOUÉ ici ne repart pas vers celui qui l'a fait,
 * sans quoi les deux écrans se renverraient le même clic sans fin. Les
 * événements rejoués sont synthétiques (`isTrusted === false`) ; la navigation
 * et le défilement reçus sont marqués (`echo.js`).
 */
export function useGuidageEmetteur({ actif, annonceur = false }) {
  const { pathname, search } = useLocation();
  const chemin = `${pathname}${search}`;
  const guide = actif;

  // La socket, et ce qu'elle nous dit de notre public — l'administrateur seul.
  useEffect(() => {
    if (!guide || !annonceur) return undefined;
    const annoncer = () => {
      envoyerGuidage({ type: 'guide', actif: true });
      envoyerGuidage({ type: 'guide-nav', chemin: `${window.location.pathname}${window.location.search}` });
    };
    const debrancher = ecouterGuidage((message) => {
      if (message.type === 'connecte') annoncer();
      else if (message.type === 'guide-spectateurs') publier({ spectateurs: message.nombre });
      // Un autre onglet guide désormais : celui-ci reprendra la main quand on y reviendra.
      else if (message.type === 'guide-repris') publier({ spectateurs: null });
    });
    // Socket déjà ouverte : `connecte` ne viendra pas, on s'annonce tout de suite.
    annoncer();
    // ⚠️ DEUX ONGLETS : c'est celui où l'on travaille qui guide.
    window.addEventListener('focus', annoncer);
    return () => {
      window.removeEventListener('focus', annoncer);
      envoyerGuidage({ type: 'guide', actif: false });
      publier({ spectateurs: null });
      debrancher();
    };
  }, [guide, annonceur]);

  // La navigation — sauf celle qu'on vient de recevoir de l'autre écran.
  useEffect(() => {
    if (!guide || !chemin.startsWith('/app') || cheminRecu(chemin)) return;
    envoyerGuidage({ type: 'guide-nav', chemin });
  }, [guide, chemin]);

  // Le curseur, les clics et le défilement.
  useEffect(() => {
    if (!guide) return undefined;

    let dernierCurseur = 0;
    let dernierDefilement = 0;
    let horsZone = true;

    const curseur = (evenement, clic = false) => {
      if (!evenement.isTrusted) return;
      const maintenant = Date.now();
      if (!clic && maintenant - dernierCurseur < PAS_CURSEUR_MS) return;
      const position = ancrer(evenement.clientX, evenement.clientY);
      // Hors du contenu : un seul `null`, pas un à chaque mouvement.
      if (!position && horsZone) return;
      horsZone = !position;
      dernierCurseur = maintenant;
      envoyerGuidage({ type: 'guide-curseur', position: position && (clic ? { ...position, clic } : position) });
    };
    const bouger = (evenement) => curseur(evenement);
    const cliquer = (evenement) => curseur(evenement, true);
    const defiler = (evenement) => {
      const zone = zoneGuidage();
      if (evenement.target !== zone || defilementRecu()) return;
      const maintenant = Date.now();
      if (maintenant - dernierDefilement < PAS_DEFILEMENT_MS) return;
      dernierDefilement = maintenant;
      envoyerGuidage({ type: 'guide-defilement', y: fractionDefilement(zone) });
    };

    // ⚠️ EN CAPTURE : les cases de l'emploi du temps arrêtent la propagation.
    window.addEventListener('pointermove', bouger, { capture: true, passive: true });
    // ⚠️ PENDANT UN GLISSER-DÉPOSER, le navigateur n'émet plus de `pointermove` : seul `dragover` dit où est la souris.
    window.addEventListener('dragover', bouger, { capture: true, passive: true });
    window.addEventListener('pointerdown', cliquer, { capture: true, passive: true });
    // `scroll` ne remonte pas, mais se capture.
    window.addEventListener('scroll', defiler, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointermove', bouger, { capture: true });
      window.removeEventListener('dragover', bouger, { capture: true });
      window.removeEventListener('pointerdown', cliquer, { capture: true });
      window.removeEventListener('scroll', defiler, { capture: true });
      envoyerGuidage({ type: 'guide-curseur', position: null });
    };
  }, [guide]);

  // Les gestes : clics, saisies, fenêtres et barre latérale (2026-10-04).
  useEffect(() => {
    if (!guide) return undefined;

    /*
     * ⚠️ QUI A ÉCRIT ? On le sait par les requêtes : toute requête qui n'est ni
     * GET ni HEAD est une écriture (un export aussi — POST). Le clic qui en a
     * lancé une n'est PAS rejoué chez le directeur : il écrirait deux fois.
     */
    let derniereEcriture = 0;
    const fetchOriginal = window.fetch;
    let minuteurEcriture = null;
    const fetchSurveille = (entree, init) => {
      const methode = String(init?.method ?? (entree instanceof Request ? entree.method : 'GET')).toUpperCase();
      const adresse = String(entree instanceof Request ? entree.url : entree);
      // ⚠️ La session (battement de cœur, rafraîchissement du jeton) n'est pas une écriture de l'utilisateur.
      const ecrit = methode !== 'GET' && methode !== 'HEAD' && !adresse.includes('/api/v2/auth/');
      if (!ecrit) return fetchOriginal(entree, init);
      derniereEcriture = Date.now();
      const requete = fetchOriginal(entree, init);
      /*
       * ═══ L'AUTRE ÉCRAN RELIT APRÈS UNE ÉCRITURE (2026-10-04, signalé par le
       * porteur : « je délie l'emploi chez moi, il ne se délie pas chez le
       * directeur ») ═══ Le clic qui écrit n'est pas rejoué — il écrirait deux
       * fois —, et toutes les écritures n'ont pas d'annonce temps réel (la
       * liaison au chronogramme n'en a pas). L'écriture FAITE, on demande donc à
       * l'autre écran de relire ses données : ce qu'il affiche rejoint le nôtre.
       */
      requete
        .finally(() => {
          clearTimeout(minuteurEcriture);
          minuteurEcriture = setTimeout(
            () => envoyerGuidage({ type: 'guide-geste', geste: null, ecriture: true, ...etatCommun() }),
            PAS_ECRITURE_MS
          );
        })
        .catch(() => {});
      return requete;
    };
    window.fetch = fetchSurveille;

    const etatCommun = () => {
      const barre = etatBarre();
      return { fenetres: Math.min(20, fenetresOuvertes()), barre: barre === 'expanded' || barre === 'collapsed' ? barre : null };
    };

    const minuteurs = new Set();
    const plusTard = (fonction, delai) => {
      const id = setTimeout(() => {
        minuteurs.delete(id);
        fonction();
      }, delai);
      minuteurs.add(id);
    };

    /** Le dernier élément noté, pour ne pas le noter deux fois (pointeur PUIS clic). */
    let dernierNote = { element: null, action: null, instant: 0 };

    /**
     * @param {Element|null} element
     * @param {{ action?: 'clic'|'double', modifs?: string }} [options] `modifs` : les touches
     *   tenues — Ctrl, Maj, Alt, Méta (`csam`) —, qui changent le sens d'un clic (ajouter à une sélection).
     */
    const noter = (element, { action = 'clic', modifs = '' } = {}) => {
      const instant = Date.now();
      if (element && dernierNote.element === element && dernierNote.action === action && instant - dernierNote.instant < 600) return;
      dernierNote = { element, action, instant };
      // ⚠️ DÉCRIT AVANT L'EFFET : le clic peut démonter l'élément (un menu qui se ferme).
      const signature = element ? decrire(element) : null;
      const declencheur = element ? declencheurDe(element) : null;
      plusTard(() => {
        const aEcrit = derniereEcriture >= instant;
        const geste =
          signature && !aEcrit
            ? {
                action,
                ...signature,
                ...(modifs ? { modifs } : {}),
                etat: element.isConnected ? etatDe(element) : null,
                ...(declencheur ? { declencheur } : {}),
              }
            : null;
        envoyerGuidage({ type: 'guide-geste', geste, ...etatCommun() });
      }, DELAI_GESTE_MS);
    };

    const cliquerChezMoi = (evenement) => {
      if (evenement.isTrusted) noter(cliquableDe(evenement.target), { modifs: modifsDe(evenement) });
    };
    // Le double clic (ouvrir une fiche, éditer une case) — rejoué en double clic (2026-10-04).
    const doubleCliquer = (evenement) => {
      const element = evenement.isTrusted ? cliquableDe(evenement.target) : null;
      if (element) noter(element, { action: 'double', modifs: modifsDe(evenement) });
    };

    /*
     * ═══ ⚠️ UNE LISTE DÉROULANTE NE PRODUIT PAS DE CLIC (2026-10-04, signalé
     * par le porteur : « je clique sur un select, rien chez le directeur, ni la
     * sélection ») ═══ Radix ouvre un Select — et un menu — au `pointerdown`,
     * puis rend le reste de la page insensible au pointeur : le `click` qui
     * suit ne tombe plus sur le déclencheur. Et l'option se choisit au
     * `pointerup`, avant tout clic, en refermant la liste. On note donc le
     * déclencheur à l'appui, et l'option au relâchement.
     */
    const appuyer = (evenement) => {
      if (!evenement.isTrusted || evenement.button !== 0) return;
      const element = cliquableDe(evenement.target);
      if (element && (element.getAttribute('role') === 'combobox' || element.hasAttribute('aria-haspopup'))) noter(element);
    };
    const relacher = (evenement) => {
      if (!evenement.isTrusted || evenement.button !== 0) return;
      const element = cliquableDe(evenement.target);
      if (element?.getAttribute('role') === 'option') noter(element);
    };

    const touche = (evenement) => {
      if (!evenement.isTrusted) return;
      if (evenement.key === 'Escape') {
        plusTard(() => envoyerGuidage({ type: 'guide-geste', geste: null, ...etatCommun() }), 150);
        return;
      }
      /*
       * ═══ LES RACCOURCIS (2026-10-04) ═══ Ctrl+C dans la grille, Suppr sur une
       * sélection, une flèche… — hors d'un champ, où la frappe est déjà recopiée
       * comme saisie. ⚠️ Comme un clic : un raccourci qui ÉCRIT (Ctrl+V, Suppr)
       * n'est pas rejoué. Entrée et Espace non plus : sur un bouton, ils
       * produisent un clic, qui part déjà comme tel.
       */
      if (cibleSaisissable(evenement.target) || ['Enter', ' ', 'Tab'].includes(evenement.key)) return;
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(evenement.key)) return;
      const modifs = modifsDe(evenement);
      const raccourci = Boolean(modifs.replace('s', '')) || evenement.key.length > 1;
      if (!raccourci) return;
      const instant = Date.now();
      const { key, code } = evenement;
      plusTard(() => {
        if (derniereEcriture >= instant) return;
        envoyerGuidage({ type: 'guide-touche', touche: { key: key.slice(0, 30), code: code.slice(0, 30), ...(modifs ? { modifs } : {}) } });
      }, DELAI_GESTE_MS);
    };

    const enAttente = new Map();
    const taper = (evenement) => {
      if (!evenement.isTrusted) return;
      const champ = champDe(evenement.target);
      if (!champ) return;
      clearTimeout(enAttente.get(champ));
      enAttente.set(
        champ,
        setTimeout(() => {
          enAttente.delete(champ);
          if (!champ.isConnected) return;
          envoyerGuidage({
            type: 'guide-geste',
            geste: { action: 'saisie', ...decrire(champ, { champ: true }), valeur: String(champ.value ?? '').slice(0, 500) },
            ...etatCommun(),
          });
        }, PAS_SAISIE_MS)
      );
    };

    window.addEventListener('click', cliquerChezMoi, { capture: true });
    window.addEventListener('dblclick', doubleCliquer, { capture: true });
    window.addEventListener('pointerdown', appuyer, { capture: true });
    window.addEventListener('pointerup', relacher, { capture: true });
    window.addEventListener('keydown', touche, { capture: true });
    window.addEventListener('input', taper, { capture: true });
    return () => {
      window.removeEventListener('click', cliquerChezMoi, { capture: true });
      window.removeEventListener('dblclick', doubleCliquer, { capture: true });
      window.removeEventListener('pointerdown', appuyer, { capture: true });
      window.removeEventListener('pointerup', relacher, { capture: true });
      window.removeEventListener('keydown', touche, { capture: true });
      window.removeEventListener('input', taper, { capture: true });
      for (const id of minuteurs) clearTimeout(id);
      clearTimeout(minuteurEcriture);
      for (const id of enAttente.values()) clearTimeout(id);
      // Seulement si personne ne l'a enveloppé à son tour depuis.
      if (window.fetch === fetchSurveille) window.fetch = fetchOriginal;
    };
  }, [guide]);
}

/**
 * ⚠️ LE TEMPS DE SAVOIR SI LE CLIC A ÉCRIT : un enregistrement part dans la
 * foulée du clic, rarement au-delà. Le directeur voit le geste avec ce retard.
 */
const DELAI_GESTE_MS = 350;

/** Les touches tenues pendant un geste : Ctrl, Maj, Alt, Méta. */
const modifsDe = (evenement) =>
  (evenement.ctrlKey ? 'c' : '') + (evenement.shiftKey ? 's' : '') + (evenement.altKey ? 'a' : '') + (evenement.metaKey ? 'm' : '');

const cibleSaisissable = (cible) =>
  cible instanceof Element && (cible.matches('input,textarea,select') || cible.isContentEditable);
const PAS_SAISIE_MS = 250;
/** Plusieurs écritures d'affilée (un report puis la liaison) : une seule relecture. */
const PAS_ECRITURE_MS = 300;
