import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { File, FileText, Loader2, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { imprimerPvSanction, imprimerTousPvSanctions } from './api';

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
      toast.success('PV téléchargé', { description: [nom, libelle].filter(Boolean).join(' — ') });
      cache.invalidateQueries({ queryKey: ['absences-stagiaires', 'pv-sanctions'] });
    },
    onError: (erreur) => toast.error('Impression impossible', { description: erreur.message }),
  });
}

/** Imprimer TOUS les PV en attente, un par page, dans un seul fichier (2026-10-26). */
export function useImpressionTousPv(langue) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ format = 'pdf' }) => imprimerTousPvSanctions({ langue, format }),
    onSuccess: (_reponse, { nombre }) => {
      toast.success('PV téléchargés', { description: `${nombre} PV dans un seul fichier` });
      cache.invalidateQueries({ queryKey: ['absences-stagiaires', 'pv-sanctions'] });
    },
    onError: (erreur) => toast.error('Impression impossible', { description: erreur.message }),
  });
}

/* Word en bleu, PDF en rouge — le style des boutons des autres documents. */
const FORMATS_PV = [
  { format: 'docx', libelle: 'Word', Icone: FileText, classe: 'border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950' },
  { format: 'pdf', libelle: 'PDF', Icone: File, classe: 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950' },
];

/** Les boutons Word / PDF sous le nom d'un stagiaire, dans le tableau du registre. */
export function BoutonImprimerPv({ impression, matricule, nom, libelle }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[0.65rem] font-medium text-primary">PV · {libelle}</span>
      {FORMATS_PV.map(({ format, libelle: lib, Icone, classe }) => {
        const enCours =
          impression.isPending && impression.variables?.matricule === matricule && impression.variables?.format === format;
        return (
          <button
            key={format}
            type="button"
            disabled={impression.isPending}
            onClick={() => impression.mutate({ matricule, format, nom, libelle })}
            title={`Télécharger le PV en ${lib} : ${libelle}`}
            className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.65rem] font-medium transition-colors disabled:opacity-50', classe)}
          >
            {enCours ? <Loader2 className="size-3 animate-spin" /> : <Icone className="size-3" />}
            {lib}
          </button>
        );
      })}
    </span>
  );
}

/**
 * « Imprimer tous les PV (n) » : Word / PDF. Rien en attente : rien à montrer.
 * `nombre` : les PV en attente, tels que la liste les compte.
 */
export function BoutonImprimerTousPv({ impression, nombre }) {
  if (!nombre) return null;
  return (
    <span className="flex items-center gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-primary">
        <Printer className="size-3.5" />
        Tous les PV ({nombre})
      </span>
      {FORMATS_PV.map(({ format, libelle: lib, Icone, classe }) => {
        const enCours = impression.isPending && impression.variables?.format === format;
        return (
          <button
            key={format}
            type="button"
            disabled={impression.isPending}
            onClick={() => impression.mutate({ format, nombre })}
            title={`Imprimer les ${nombre} PV en attente dans un seul fichier ${lib}`}
            className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50', classe)}
          >
            {enCours ? <Loader2 className="size-3 animate-spin" /> : <Icone className="size-3" />}
            {lib}
          </button>
        );
      })}
    </span>
  );
}

/** Le petit bouton d'impression collé à la pastille d'un stagiaire. */
export function BoutonImprimerPvCompact({ impression, matricule, nom, libelle }) {
  return FORMATS_PV.map(({ format, libelle: lib, Icone, classe }) => {
    const enCours =
      impression.isPending && impression.variables?.matricule === matricule && impression.variables?.format === format;
    return (
      <button
        key={format}
        type="button"
        disabled={impression.isPending}
        onClick={() => impression.mutate({ matricule, format, nom, libelle })}
        title={`Télécharger le PV en ${lib} : ${libelle}`}
        aria-label={`PV de ${nom} en ${lib} : ${libelle}`}
        className={cn('flex items-center self-stretch border-l px-1.5 transition-colors disabled:opacity-50', classe.replace(/border-\S+/g, ''))}
      >
        {enCours ? <Loader2 className="size-3 animate-spin" /> : <Icone className="size-3" />}
      </button>
    );
  });
}
