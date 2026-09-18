import { useCallback, useEffect, useRef } from 'react';

/** Un curseur au plus toutes les 50 ms : 20 par seconde suffisent à l'œil. */
export const PAS_CURSEUR_MS = 50;

/**
 * Envoie le curseur de cet onglet, borné à 20 par seconde (2026-09-13 — sorti
 * de la page Emploi, dont c'était le mécanisme, pour servir aussi au
 * chronogramme : deux copies auraient fini par ne plus borner pareil).
 *
 * ⚠️ LA DERNIÈRE POSITION PART À LA FIN DU PAS : sans elle, le curseur
 * s'arrêterait chez les autres un peu avant l'endroit où on l'a posé. Le serveur
 * coupe une connexion qui dépasse 40 messages par seconde.
 *
 * @param {(position: object | null) => void} envoyer  `salle.envoyerCurseur`
 */
export function useEmetteurCurseur(envoyer) {
  const etat = useRef({ dernier: 0, minuteur: null, position: undefined });

  useEffect(() => () => clearTimeout(etat.current.minuteur), []);

  return useCallback(
    (position) => {
      const envoi = etat.current;
      envoi.position = position;
      const attente = PAS_CURSEUR_MS - (Date.now() - envoi.dernier);

      if (attente <= 0) {
        clearTimeout(envoi.minuteur);
        envoi.minuteur = null;
        envoi.dernier = Date.now();
        envoyer(position);
        return;
      }
      if (!envoi.minuteur) {
        envoi.minuteur = setTimeout(() => {
          envoi.minuteur = null;
          envoi.dernier = Date.now();
          envoyer(envoi.position);
        }, attente);
      }
    },
    [envoyer]
  );
}
