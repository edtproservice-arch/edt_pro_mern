import { useCallback, useEffect, useRef } from 'react';
import { entrer, salleVide, useTempsReel } from '@/lib/tempsReel';

/**
 * Entre dans la salle temps réel d'une page tant que le composant est monté.
 *
 * ⚠️ ON N'ENTRE QU'UNE FOIS L'ANNÉE CONNUE (`actif`). La salle est propre à une
 * année : entrer avant, c'est rejoindre l'année par défaut de l'établissement
 * puis la quitter aussitôt — les collègues verraient l'avatar clignoter.
 *
 * ⚠️ LES RAPPELS PASSENT PAR DES `ref` : écrits en place par l'appelant, ils
 * changent à chaque rendu, et les mettre en dépendance ferait sortir puis
 * rentrer dans la salle à chaque frappe.
 *
 * @returns {{ statut, utilisateurId, membres, erreur, rejoint, droit,
 *             envoyerCurseur, envoyerFocus }}
 */
export function useSalle(page, { anneeScolaire, vue, surModification, surAcces, actif = true, anneeParDefaut = false }) {
  const rappels = useRef({ surModification, surAcces });
  rappels.current = { surModification, surAcces };

  const poignee = useRef(null);
  const derniereVue = useRef(vue);
  derniereVue.current = vue;
  const derniereAnnee = useRef(anneeScolaire);
  derniereAnnee.current = anneeScolaire;

  /*
   * ⚠️ `anneeParDefaut` : là où aucune année n'est posée — pas de sélecteur
   * (la barre du formateur), ou jamais utilisé — aucune ne le sera jamais :
   * attendre, c'est ne jamais entrer. La salle est alors rejointe sur l'année que le serveur retient par
   * défaut, exactement celle que lisent les requêtes HTTP de la même page, qui
   * partent elles aussi sans en-tête `X-Annee-Scolaire`. (Trouvé en vérifiant
   * l'étape d2 : le formateur invité restait « Hors ligne » sur toutes les pages
   * partagées autres que l'emploi du temps.)
   */
  const pret = actif && (Boolean(anneeScolaire) || anneeParDefaut);

  useEffect(() => {
    if (!pret) return undefined;
    const salle = entrer(page, {
      anneeScolaire: derniereAnnee.current,
      vue: derniereVue.current,
      surModification: (message) => rappels.current.surModification?.(message),
      surAcces: (message) => rappels.current.surAcces?.(message),
    });
    poignee.current = salle;
    return () => {
      salle.sortir();
      poignee.current = null;
    };
  }, [page, pret]);

  useEffect(() => {
    poignee.current?.majAnnee(anneeScolaire);
  }, [anneeScolaire]);

  // Comparée par sa FORME : un objet `vue` recréé à chaque rendu ne doit pas
  // renvoyer la même vue au serveur à chaque frappe.
  const cleVue = JSON.stringify(vue ?? {});
  useEffect(() => {
    poignee.current?.majVue(derniereVue.current);
  }, [cleVue]);

  // Stables : l'écran les passe à des composants mémorisés.
  const envoyerCurseur = useCallback((position) => poignee.current?.envoyerCurseur(position), []);
  const envoyerFocus = useCallback((focus) => poignee.current?.envoyerFocus(focus), []);

  const etat = useTempsReel();
  return {
    statut: etat.statut,
    utilisateurId: etat.utilisateurId,
    ...(etat.salles[page] ?? salleVide),
    envoyerCurseur,
    envoyerFocus,
  };
}
