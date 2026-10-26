import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { imprimerPvSanction } from './api';

/**
 * ═══ L'IMPRESSION D'UN PV DE SANCTION, PARTAGÉE (2026-10-26) ═══ Le tableau du
 * Registre (Absences → Stagiaires) et la carte « Seuils d'assiduité atteints » de
 * l'accueil impriment le même PV, dans la même langue retenue : un seul réglage. Pas
 * d'onglet à part (demande du porteur) — le bouton vit là où l'on voit le stagiaire.
 */

export const LANGUES_PV = [
  { valeur: 'fr', libelle: 'Français', court: 'FR' },
  { valeur: 'ar', libelle: 'العربية', court: 'ع' },
];

/* La version choisie se retient d'une visite à l'autre — une préférence de poste, rien de plus. */
const CLE_LANGUE = 'pv-sanctions.langue';

export function useLanguePv() {
  const [langue, setLangue] = useState(() => {
    try {
      return localStorage.getItem(CLE_LANGUE) === 'ar' ? 'ar' : 'fr';
    } catch {
      return 'fr';
    }
  });
  const choisir = (valeur) => {
    setLangue(valeur);
    try {
      localStorage.setItem(CLE_LANGUE, valeur);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la visite.
    }
  };
  return [langue, choisir];
}

/** Les pastilles « Français / العربية » — `court` : « FR / ع », pour un en-tête de carte. */
export function ChoixLanguePv({ langue, onChoisir, court = false }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Version du PV">
      {LANGUES_PV.map((option) => {
        const actif = option.valeur === langue;
        return (
          <button
            key={option.valeur}
            type="button"
            aria-pressed={actif}
            title={`PV en ${option.valeur === 'ar' ? 'arabe' : 'français'}`}
            onClick={() => onChoisir(option.valeur)}
            className={cn(
              'rounded-full border font-medium transition-colors',
              court ? 'px-2 py-0.5 text-[0.65rem]' : 'px-3.5 py-1 text-xs',
              actif
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-input text-muted-foreground hover:border-primary/30 hover:text-primary'
            )}
          >
            {court ? option.court : option.libelle}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Imprimer le PV d'UN stagiaire (PDF), puis relire la liste : imprimé, il en sort.
 * `onImprime` : de quoi prévenir l'appelant, en plus du message.
 */
export function useImpressionPv(langue) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ matricule, format = 'pdf' }) => imprimerPvSanction(matricule, { langue, format }),
    onSuccess: (_reponse, { nom, libelle }) => {
      toast.success('PV imprimé', { description: [nom, libelle].filter(Boolean).join(' — ') });
      cache.invalidateQueries({ queryKey: ['absences-stagiaires', 'pv-sanctions'] });
    },
    onError: (erreur) => toast.error('Impression impossible', { description: erreur.message }),
  });
}

/** Le bouton d'impression sous le nom d'un stagiaire, dans le tableau du registre. */
export function BoutonImprimerPv({ impression, matricule, nom, libelle }) {
  const enCours = impression.isPending && impression.variables?.matricule === matricule;
  return (
    <button
      type="button"
      disabled={impression.isPending}
      onClick={() => impression.mutate({ matricule, nom, libelle })}
      title={`Imprimer le PV : ${libelle}`}
      className="mt-1 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
    >
      {enCours ? <Loader2 className="size-3 animate-spin" /> : <Printer className="size-3" />}
      Imprimer PV · {libelle}
    </button>
  );
}

/** Le petit bouton d'impression collé à la pastille d'un stagiaire. */
export function BoutonImprimerPvCompact({ impression, matricule, nom, libelle }) {
  const enCours = impression.isPending && impression.variables?.matricule === matricule;
  return (
    <button
      type="button"
      disabled={impression.isPending}
      onClick={() => impression.mutate({ matricule, nom, libelle })}
      title={`Imprimer le PV : ${libelle}`}
      aria-label={`Imprimer le PV de ${nom} : ${libelle}`}
      className="flex items-center gap-1 self-stretch border-l px-1.5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
    >
      {enCours ? <Loader2 className="size-3 animate-spin" /> : <Printer className="size-3" />}
      <span className="text-[0.65rem] font-medium">PV</span>
    </button>
  );
}
