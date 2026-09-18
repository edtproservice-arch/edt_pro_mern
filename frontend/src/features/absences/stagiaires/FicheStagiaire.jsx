import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Alerte from '@/components/common/Alerte';
import { nombre } from '@/lib/nombres';
import { chargerFiche } from './api';
import BadgeSanction from './BadgeSanction';
import RegistreStagiaires from './RegistreStagiaires';
import { SaisieComportement } from './SaisieComportement';

/**
 * La fiche de discipline d'UN stagiaire : sa note, ses absences et retards à
 * justifier, ses indisciplines.
 *
 * ⚠️ LE CORPS DÉFILE, PAS LA MODALE : `DialogContent` est une grille, et un
 * enfant de grille a `min-width: auto` — d'où la colonne flex en
 * `overflow-hidden` et le `min-h-0 min-w-0` du corps (piège payé trois fois).
 */
export default function FicheStagiaire({ matricule, onFermer }) {
  const fiche = useQuery({
    queryKey: ['absences-stagiaires', 'fiche', matricule],
    queryFn: () => chargerFiche(matricule),
    enabled: Boolean(matricule),
    retry: false,
  });
  const donnees = fiche.data;

  return (
    <Dialog open={Boolean(matricule)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-4xl flex-col gap-3 overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{donnees?.nom ?? 'Fiche de discipline'}</DialogTitle>
          <DialogDescription>
            {donnees ? `${donnees.matricule} · ${donnees.groupe}` : 'Chargement…'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {fiche.error && <Alerte type="erreur" titre="Fiche indisponible">{fiche.error.message}</Alerte>}
          {donnees && (
            <>
              <Synthese note={donnees.note} />
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Absences et retards</h3>
                <RegistreStagiaires encadrement matricule={donnees.matricule} compact />
              </section>
              <SaisieComportement fiche={donnees} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Synthese({ note }) {
  const tuiles = [
    { titre: 'Assiduité', valeur: `${nombre(note.assiduite.note)} / 10`, detail: `−${nombre(note.assiduite.pointsRetires)} point(s)`, sanction: note.assiduite.sanction },
    { titre: 'Comportement', valeur: `${note.comportement.note} / 5`, detail: `${note.comportement.indisciplines} indiscipline(s)`, sanction: note.comportement.sanction },
    {
      titre: 'Note de discipline',
      valeur: `${nombre(note.note15)} / 15`,
      // 1ʳᵉ année : passage (/20). 2ᵉ et 3ᵉ : fin de formation, la note reste sur 15.
      detail:
        note.examen?.type === 'fin'
          ? 'Examen de fin de formation : sur 15'
          : `Examen de passage : ${nombre(note.note20)} / 20`,
    },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
      {tuiles.map((t) => (
        <div key={t.titre} className="space-y-1 bg-card p-3">
          <p className="text-xs text-muted-foreground">{t.titre}</p>
          <p className="text-lg font-bold tabular-nums">{t.valeur}</p>
          <p className="text-xs text-muted-foreground">{t.detail}</p>
          {t.sanction !== undefined && <BadgeSanction sanction={t.sanction} />}
        </div>
      ))}
    </div>
  );
}
