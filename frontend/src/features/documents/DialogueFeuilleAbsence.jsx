import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { File, FileSpreadsheet, FileText } from 'lucide-react';
import { facettesDesGroupes, filtrerGroupes, semaineAOuvrir } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChoixSujets, FiltreGroupes } from '@/features/edition/FiltresDetaillee';
import { chargerContexte, chargerSemaines } from '@/features/emploi/api';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { exporterFeuilleAbsence } from '@/features/absences/stagiaires/api';
import { useAnneeActive } from '@/lib/anneeActive';

/**
 * La feuille d'absence hebdomadaire depuis la page Documents (2026-10-01,
 * demande du porteur : « pour télécharger il faut choisir le groupe ou les
 * groupes avec quelle semaine »).
 *
 * ⚠️ LE MÊME EXPORT QUE « FAIRE L'APPEL » (`/absences-stagiaires/export`), et
 * le même choix des groupes : le sélecteur et le filtre filière/niveau/année
 * d'Édition. Aucun groupe coché = tous ceux que le filtre laisse — comme sur la
 * grille de l'appel, où le bouton télécharge tout ce qui est visible.
 */
export default function DialogueFeuilleAbsence({ ouvert, onFermer }) {
  const anneeChoisie = useAnneeActive();
  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false, enabled: ouvert });
  const semaines = useQuery({ queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false, enabled: ouvert });
  const anneeScolaire = anneeChoisie ?? contexte.data?.anneeScolaire ?? null;

  const [semaineChoisie, setSemaine] = useState(null);
  const semaine =
    semaineChoisie ?? semaines.data?.courante ?? (anneeScolaire ? semaineAOuvrir(anneeScolaire) : null);

  const [choisis, setChoisis] = useState([]);
  const [filtreGroupes, setFiltreGroupes] = useState({ filieres: [], niveaux: [], annees: [] });

  const groupes = contexte.data?.groupes ?? [];
  const groupesIdentites = contexte.data?.groupesIdentites ?? {};
  const facettes = useMemo(() => facettesDesGroupes(groupes, groupesIdentites), [groupes, groupesIdentites]);
  const retenus = useMemo(() => {
    const parIdentite = filtrerGroupes(groupes, groupesIdentites, filtreGroupes);
    return choisis.length > 0 ? parIdentite.filter((g) => choisis.includes(g)) : parIdentite;
  }, [groupes, groupesIdentites, filtreGroupes, choisis]);

  const telechargement = useMutation({
    mutationFn: (format) => exporterFeuilleAbsence({ format, groupes: retenus, semaine }),
    onSuccess: onFermer,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const pret = Boolean(semaine) && retenus.length > 0 && !telechargement.isPending;

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Feuille d’absence hebdomadaire</DialogTitle>
          <DialogDescription>Une page par groupe, pour la semaine choisie.</DialogDescription>
        </DialogHeader>

        {contexte.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement des groupes…</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Groupes</p>
              <div className="flex flex-wrap items-center gap-2">
                <ChoixSujets
                  sujets={groupes}
                  choisis={choisis}
                  libelle={(groupe) => groupe}
                  entete="Groupe"
                  onChanger={setChoisis}
                />
                <FiltreGroupes facettes={facettes} valeurs={filtreGroupes} onChanger={setFiltreGroupes} />
                <span className="text-xs text-muted-foreground">
                  {retenus.length} sur {groupes.length}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Semaine</p>
              <NavigationSemaine
                semaine={semaine}
                onChanger={setSemaine}
                anneeScolaire={anneeScolaire}
                remplies={semaines.data?.semaines ?? []}
                courante={semaines.data?.courante}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button variant="outline" size="sm" className="gap-1.5" disabled={!pret} onClick={() => telechargement.mutate('docx')}>
                <FileText className="size-3.5 text-blue-600" />
                Word
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={!pret} onClick={() => telechargement.mutate('pdf')}>
                <File className="size-3.5 text-red-600" />
                PDF
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={!pret} onClick={() => telechargement.mutate('xlsx')}>
                <FileSpreadsheet className="size-3.5 text-green-600" />
                Excel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
