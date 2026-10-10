import { createContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyserSemaine } from 'shared/domain';

import { chargerSemaines } from '@/features/emploi/api';

/**
 * ═══ LES SEMAINES PUBLIÉES OU PASSÉES (2026-10-10, demande du porteur) ═══
 * Des directeurs retouchaient la planification de semaines déjà réalisées, ce
 * qui désaligne leur emploi du temps. Rien n'est verrouillé : la grille demande
 * une confirmation appuyée avant de sélectionner ou de modifier une telle
 * semaine (voir `GrilleChronogramme`).
 */

export const MOTIFS_PROTECTION = { PUBLIEE: 'publiée', PASSEE: 'passée' };

const aujourdhui = () => {
  const date = new Date();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
};

/**
 * Les semaines protégées : numéro → motif.
 *
 * ⚠️ PUBLIÉE L'EMPORTE SUR PASSÉE : c'est l'acte du directeur, le plus parlant.
 * ⚠️ SANS ACCÈS À L'EMPLOI DU TEMPS (un invité qui n'a que le chronogramme),
 *    les publications ne se lisent pas : seules les semaines passées sont
 *    protégées — mieux que rien, et sans erreur à l'écran.
 */
export function useSemainesProtegees(semaines = []) {
  const publications = useQuery({
    queryKey: ['emploi', 'semaines'],
    queryFn: chargerSemaines,
    retry: false,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const protegees = new Map();
    const jour = aujourdhui();
    for (const semaine of semaines) {
      if (semaine.fin && semaine.fin < jour) protegees.set(semaine.numero, MOTIFS_PROTECTION.PASSEE);
    }
    for (const valeur of publications.data?.publications ?? []) {
      const numero = analyserSemaine(valeur)?.numero;
      if (numero) protegees.set(numero, MOTIFS_PROTECTION.PUBLIEE);
    }
    return protegees;
  }, [semaines, publications.data]);
}

/** Les numéros de semaine dont une cellule diffère entre deux plannings `{module: {numero: cellule}}`. */
export function semainesTouchees(avant = {}, apres = {}) {
  const touchees = new Set();
  for (const module of new Set([...Object.keys(avant ?? {}), ...Object.keys(apres ?? {})])) {
    const a = avant?.[module] ?? {};
    const b = apres?.[module] ?? {};
    if (a === b) continue;
    for (const numero of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[numero] ?? null) !== JSON.stringify(b[numero] ?? null)) {
        touchees.add(Number(numero));
      }
    }
  }
  return touchees;
}

/**
 * Ce que les cellules consultent : `{ bloquee(numero), demander(numeros, poursuivre) }`.
 * Une valeur STABLE (refs à l'intérieur) : les 765 cellules mémoïsées ne se
 * rendent pas à chaque confirmation.
 */
export const GardeSemaines = createContext(null);
