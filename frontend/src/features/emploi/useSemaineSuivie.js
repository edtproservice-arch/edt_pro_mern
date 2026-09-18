import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prochaineBascule } from 'shared/domain';

/* Marge après 6 h 30 : c'est l'horloge du SERVEUR qui décide de la semaine, et
   celle du poste peut avancer de quelques secondes sur la sienne. */
const MARGE_MS = 5_000;

/**
 * La semaine affichée par un écran d'emploi du temps.
 *
 * ═══ L'ÉCRAN SUIT LA SEMAINE QUE LE SERVEUR DÉSIGNE, TANT QU'ON N'EN CHOISIT
 * PAS UNE ═══ (2026-09-14, demande du porteur : « chaque samedi à 6:30, même si
 * le directeur n'a pas publié ».) `courante` porte déjà toute la règle —
 * publication, bascule du samedi — et elle vit dans `semaineAOuvrir`. Posée UNE
 * fois au montage, comme avant, une page restée ouverte le samedi matin gardait
 * la semaine finie jusqu'au rechargement.
 *
 * ⚠️ AU SAMEDI 6 H 30, ON RELIT `courante` — une minuterie jusqu'à
 * `prochaineBascule`, réarmée après chaque passage. Sans elle rien ne relit : le
 * retour sur l'onglet ne recharge pas (`refetchOnWindowFocus: false`).
 *
 * ⚠️ UN CHOIX EXPLICITE L'EMPORTE : on ne déplace pas quelqu'un qui regarde
 * délibérément une autre semaine. Revenir sur la semaine courante (« Cette
 * semaine ») rend la main à la règle.
 *
 * @param {object} p
 * @param {string|undefined} p.courante — la semaine désignée par le serveur
 * @param {string|null} [p.repli] — tant que le serveur n'a pas répondu
 * @param {unknown[]} p.cle — la clé de la requête qui porte `courante`
 * @returns {[string|null, (semaine: string) => void]}
 */
export function useSemaineSuivie({ courante, repli = null, cle }) {
  const cache = useQueryClient();
  const [choisie, setChoisie] = useState(null);
  const [tour, setTour] = useState(0);

  // La clé est un tableau neuf à chaque rendu : en dépendre réarmerait la
  // minuterie à chaque rendu, et elle ne partirait jamais.
  const cleRef = useRef(cle);
  cleRef.current = cle;

  useEffect(() => {
    const delai = prochaineBascule(new Date()).getTime() - Date.now() + MARGE_MS;
    const minuterie = setTimeout(() => {
      cache.invalidateQueries({ queryKey: cleRef.current });
      setTour((valeur) => valeur + 1);
    }, delai);
    return () => clearTimeout(minuterie);
  }, [cache, tour]);

  const choisir = (semaine) => setChoisie(semaine === courante ? null : semaine);

  return [choisie ?? courante ?? repli, choisir];
}
