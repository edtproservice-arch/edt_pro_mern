import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerAppelsEnAttente } from './api';
import PanneauAppel from './PanneauAppel';

/**
 * ═══ LE RAPPEL AU FORMATEUR ═══ (2026-10-25, demande du porteur) : les cours
 * des deux dernières semaines dont l'appel n'a pas été validé, en tête de
 * « Faire l'appel ».
 *
 * ⚠️ UN CLIC OUVRE L'APPEL DE CE COURS, sans chercher la bonne semaine dans la
 * grille : c'est le même `PanneauAppel` que la grille, avec le même choix.
 *
 * ⚠️ DEUX LECTURES DE LA MÊME LISTE : le formateur voit SES cours ; l'encadrement
 * voit ceux de tous, rangés par formateur — c'est lui qui relance.
 * Rien à rappeler : rien ne s'affiche.
 */
export default function RappelAppels({ encadrement }) {
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState(null);
  const enAttente = useQuery({
    queryKey: ['absences-stagiaires', 'appel', 'en-attente'],
    queryFn: chargerAppelsEnAttente,
    retry: false,
  });
  const cours = enAttente.data ?? [];

  const parFormateur = useMemo(() => {
    const groupes = new Map();
    for (const c of cours) {
      const nom = c.formateur || 'Sans formateur';
      groupes.set(nom, [...(groupes.get(nom) ?? []), c]);
    }
    return [...groupes].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
  }, [cours]);

  if (cours.length === 0) return null;

  const ouvrirAppel = (c) =>
    setChoix({
      date: c.date,
      cours: { seance: c.seance, periode: c.periode, groupe: c.groupe },
      sousTitre: `${jourMois(c.date)} · ${c.groupe} · ${c.module}`,
    });

  return (
    <section className="rounded-lg border border-warning/50 bg-warning/5 p-3">
      <button
        type="button"
        onClick={() => setOuvert((actuel) => !actuel)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <BellRing className="size-4 shrink-0 text-accent-orange-deep" />
        <span className="flex-1">
          <span className="font-medium">
            {encadrement
              ? `${nombre(cours.length)} appel(s) non validé(s) — ${nombre(parFormateur.length)} formateur(s)`
              : `Vous avez ${nombre(cours.length)} appel(s) à faire`}
          </span>
          <span className="block text-xs text-muted-foreground">
            Cours des deux dernières semaines dont l’appel n’a pas été validé
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert && (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto scrollbar-fine">
          {encadrement ? (
            parFormateur.map(([nom, liste]) => (
              <div key={nom}>
                <p className="mb-1 text-xs font-semibold">
                  {nom} <span className="font-normal text-muted-foreground">· {nombre(liste.length)}</span>
                </p>
                <ListeCours cours={liste} onOuvrir={ouvrirAppel} />
              </div>
            ))
          ) : (
            <ListeCours cours={cours} onOuvrir={ouvrirAppel} />
          )}
        </div>
      )}

      <PanneauAppel choix={choix} onFermer={() => setChoix(null)} />
    </section>
  );
}

function ListeCours({ cours, onOuvrir }) {
  return (
    <ul className="divide-y rounded-md border bg-background">
      {cours.map((c) => (
        <li key={`${c.date}|${c.seance}|${c.periode}|${c.groupe}`} className="flex items-center gap-3 px-3 py-1.5 text-xs">
          <span className="w-24 shrink-0 tabular-nums">
            {c.jour.slice(0, 3)} {jourMois(c.date)} <span className="text-muted-foreground">· {c.seance}</span>
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{c.groupe}</span>
            <span className="text-muted-foreground"> · {c.module || 'sans module'}</span>
          </span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-[0.7rem]" onClick={() => onOuvrir(c)}>
            Faire l’appel
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** « 2026-09-23 » → « 23/09 ». */
const jourMois = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
