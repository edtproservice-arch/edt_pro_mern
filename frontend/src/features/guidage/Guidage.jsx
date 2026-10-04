import { useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MousePointer2 } from 'lucide-react';
import { ecouterGuidage, envoyerGuidage } from '@/lib/tempsReel';
import { appliquerDefilement, desancrer, zoneGuidage } from './positions';
import { cliquer, echap, etatBarre, etatDe, fenetresOuvertes, presser, retrouver, saisir } from './gestes';
import { noterCheminRecu } from './echo';
import { useGuidageEmetteur } from './useGuidageEmetteur';
import { definirGuidageActif, recevoirEtat } from './useEtatPartage';
import { afficherMessage, observerMessages } from './messages';

/**
 * Le guidage, côté DIRECTEUR (2026-10-03).
 *
 * Quand l'administrateur qui collabore avec son établissement le guide, le
 * directeur suit sa navigation et voit son curseur et ses clics — sans que
 * l'administrateur ait pris sa session.
 *
 * ═══ TOUJOURS SUIVI (2026-10-04, demande du porteur) ═══ Plus de « Ne plus
 * suivre » : la collaboration EST un guidage. La pastille « vous guide » a été
 * retirée aussi (même jour, demande du porteur) : le nom porté par le curseur
 * dit qui fait bouger l'écran.
 */
/**
 * Rejoue un geste de l'administrateur sur l'écran du directeur (2026-10-04).
 *
 * ⚠️ UNE BASCULE N'EST CLIQUÉE QUE SI SON ÉTAT DIFFÈRE de celui voulu : un
 * écran déjà en e-note ne repasse pas en eDTpro parce qu'on lui redit « e-note ».
 */
function rejouerGeste({ geste, fenetres, barre }) {
  if (geste?.action === 'double') {
    const element = retrouver(geste);
    if (element) cliquer(element, { modifs: geste.modifs ?? '', double: true });
  } else if (geste?.action === 'clic') {
    const element = retrouver(geste);
    if (element && (geste.etat == null || etatDe(element) !== geste.etat)) cliquer(element, { modifs: geste.modifs ?? '' });
    /*
     * Une option dont la liste n'est pas ouverte ici (l'ouverture s'est perdue,
     * ou le directeur l'a refermée) : on l'ouvre par son déclencheur, puis on
     * choisit — le temps que Radix monte la liste.
     */
    if (!element && geste.declencheur) {
      const declencheur = retrouver(geste.declencheur);
      if (declencheur) {
        cliquer(declencheur);
        setTimeout(() => {
          const option = retrouver(geste);
          if (option) cliquer(option);
        }, 200);
      }
    }
  } else if (geste?.action === 'saisie') {
    const champ = retrouver(geste, { champ: true });
    if (champ && champ.value !== geste.valeur) saisir(champ, geste.valeur ?? '');
  }

  // Le temps que React rende l'effet du clic, puis on réaligne le reste.
  setTimeout(() => {
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    if (barre && trigger && etatBarre() && etatBarre() !== barre) cliquer(trigger);
    fermerJusqua(fenetres, 0);
  }, 120);
}

/** Ferme, une à une, les fenêtres que l'administrateur a fermées. */
function fermerJusqua(fenetres, essais) {
  if (fenetresOuvertes() <= fenetres || essais >= 5) return;
  echap();
  setTimeout(() => fermerJusqua(fenetres, essais + 1), 80);
}

/**
 * ═══ LE GUIDAGE DANS LES DEUX SENS (2026-10-04) ═══ Monté chez le directeur ET
 * chez l'administrateur en collaboration (`admin`) : chacun rejoue ce que fait
 * l'autre, et émet ce qu'il fait lui-même. Chez le directeur, rien ne part tant
 * qu'aucun administrateur ne le guide.
 */
export default function Guidage({ admin = false }) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [guide, setGuide] = useState(null);
  const [position, setPosition] = useState(null);
  /** Le nom de celui dont on voit le curseur. */
  const [auteur, setAuteur] = useState(null);
  const [clic, setClic] = useState(0);
  // Notre propre défilement déplace le curseur de l'autre à l'écran : on le redessine.
  const [, redessiner] = useReducer((n) => n + 1, 0);

  const actif = admin || Boolean(guide);
  useGuidageEmetteur({ actif, annonceur: admin });
  useEffect(() => {
    definirGuidageActif(actif);
    return () => definirGuidageActif(false);
  }, [actif]);
  // Les notifications apparues ici partent chez l'autre (2026-10-04).
  useEffect(() => {
    if (!actif) return undefined;
    return observerMessages((message) => envoyerGuidage({ type: 'guide-message', ...message }));
  }, [actif]);

  useEffect(
    () =>
      ecouterGuidage((message) => {
        const aller = (chemin) => {
          if (!chemin?.startsWith('/app')) return;
          if (chemin === `${window.location.pathname}${window.location.search}`) return;
          noterCheminRecu(chemin);
          navigate(chemin);
        };

        if (message.type === 'guide-debut') {
          setGuide(message.guide);
          aller(message.chemin);
        } else if (message.type === 'guide-nav') {
          setPosition(null);
          aller(message.chemin);
        } else if (message.type === 'guide-curseur') {
          setPosition(message.position);
          if (message.de?.nom) setAuteur(message.de.nom);
          if (message.position?.clic) setClic((n) => n + 1);
        } else if (message.type === 'guide-defilement') {
          appliquerDefilement(zoneGuidage(), message.y);
        } else if (message.type === 'guide-touche') {
          presser(message.touche);
        } else if (message.type === 'guide-message') {
          afficherMessage(message);
        } else if (message.type === 'guide-etat') {
          recevoirEtat(message);
        } else if (message.type === 'guide-geste') {
          rejouerGeste(message);
          // L'autre a écrit : on relit ce qui est affiché, pour montrer le même état que lui.
          if (message.ecriture) cache.invalidateQueries({ refetchType: 'active' });
        } else if (message.type === 'guide-fin' || message.type === 'deconnecte') {
          setGuide(null);
          setPosition(null);
        }
      }),
    [navigate, cache]
  );

  useEffect(() => {
    if (!actif) return undefined;
    window.addEventListener('scroll', redessiner, { capture: true, passive: true });
    window.addEventListener('resize', redessiner);
    return () => {
      window.removeEventListener('scroll', redessiner, { capture: true });
      window.removeEventListener('resize', redessiner);
    };
  }, [actif]);

  if (!actif) return null;

  const point = desancrer(position);
  if (!point) return null;

  // Le curseur seul, sans pastille (2026-10-04, demande du porteur) : son nom l'accompagne.
  return (
    <div
      aria-hidden
      data-guidage-ignorer
      className="pointer-events-none fixed z-[60] transition-[left,top] duration-75 ease-linear print:hidden"
      style={{ left: point.left, top: point.top }}
    >
      {/* Chaque clic de l'administrateur fait une onde, rejouée par sa clé. */}
      {clic > 0 && (
        <span
          key={clic}
          className="absolute -left-4 -top-4 h-8 w-8 animate-ping rounded-full bg-primary/40 [animation-iteration-count:1]"
        />
      )}
      <MousePointer2 className="h-5 w-5 -translate-x-0.5 -translate-y-0.5 fill-primary text-primary-foreground drop-shadow" />
      <span className="ml-4 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground shadow">
        {auteur ?? guide?.nom}
      </span>
    </div>
  );
}
