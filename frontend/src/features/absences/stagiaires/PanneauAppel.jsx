import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import Alerte from '@/components/common/Alerte';
import { chargerAppel } from './api';
import ListeAppel from './ListeAppel';

/**
 * La liste d'appel d'UN cours, chargée depuis le serveur.
 * `cours` = `{ seance, periode, groupe }` — le libellé de groupe de la SÉANCE, tel
 * qu'écrit (« GM101 GM102 » pour une fusion).
 */
export function ChargementAppel({ date, cours, dansPanneau = false }) {
  const appel = useQuery({
    queryKey: ['absences-stagiaires', 'appel', date, `${cours.seance}|${cours.periode}|${cours.groupe}`],
    queryFn: () => chargerAppel({ date, seance: cours.seance, periode: cours.periode, groupe: cours.groupe }),
    retry: false,
  });

  if (appel.isLoading) return <p className="text-sm text-muted-foreground">Chargement de la liste…</p>;
  if (appel.error) return <Alerte type="erreur" titre="Liste indisponible">{appel.error.message}</Alerte>;
  return <ListeAppel appel={appel.data} dansPanneau={dansPanneau} />;
}

/**
 * ═══ LE PANNEAU D'APPEL, À DROITE ═══ — le même pour l'agenda du formateur et
 * pour la grille de l'encadrement (2026-09-14). Écrit une fois : deux panneaux
 * auraient fini par ne plus dire la même chose du même cours.
 *
 * Dépliée dans une carte, la liste allongeait la page de trente lignes ; le
 * panneau prend toute la hauteur, et ce qu'on regardait reste visible derrière.
 *
 * @param {{date: string, cours: {seance, periode, groupe}, sousTitre: string}|null} choix
 */
export default function PanneauAppel({ choix, onFermer }) {
  return (
    <Sheet open={Boolean(choix)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b p-4 pr-10 text-left">
          <SheetTitle>Appel · {choix?.cours.seance}</SheetTitle>
          <SheetDescription>{choix?.sousTitre}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {choix && <ChargementAppel dansPanneau date={choix.date} cours={choix.cours} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
