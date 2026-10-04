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
import { useAnneeActive } from '@/lib/anneeActive';
import { empreinte, useEtatPartage } from '@/features/guidage/useEtatPartage';

const FORMATS = {
  docx: { libelle: 'Word', Icone: FileText, couleur: 'text-blue-600' },
  pdf: { libelle: 'PDF', Icone: File, couleur: 'text-red-600' },
  xlsx: { libelle: 'Excel', Icone: FileSpreadsheet, couleur: 'text-green-600' },
};

/**
 * Le choix des GROUPES (et, si le document en dépend, de la SEMAINE) avant de
 * télécharger un document de la page Documents — la feuille d'absence
 * hebdomadaire (2026-10-01), la feuille de présence EFF (2026-10-02).
 *
 * ⚠️ LE MÊME CHOIX DES GROUPES QUE « FAIRE L'APPEL » : le sélecteur et le
 * filtre filière/niveau/année d'Édition. Aucun groupe coché = tous ceux que le
 * filtre laisse — comme sur la grille de l'appel, où le bouton télécharge tout
 * ce qui est visible.
 *
 * @param {(options: {format, groupes, semaine?}) => Promise} telecharger
 * @param {string[]} formats — parmi `docx`, `pdf`, `xlsx`
 */
export default function DialogueChoixGroupes({
  ouvert,
  onFermer,
  titre,
  description,
  avecSemaine = false,
  formats,
  telecharger,
}) {
  const anneeChoisie = useAnneeActive();
  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false, enabled: ouvert });
  const semaines = useQuery({
    queryKey: ['emploi', 'semaines'],
    queryFn: chargerSemaines,
    retry: false,
    enabled: ouvert && avecSemaine,
  });
  const anneeScolaire = anneeChoisie ?? contexte.data?.anneeScolaire ?? null;

  const [semaineChoisie, setSemaine] = useState(null);
  const semaine =
    semaineChoisie ?? semaines.data?.courante ?? (anneeScolaire ? semaineAOuvrir(anneeScolaire) : null);

  const [choisis, setChoisis] = useState([]);
  const [filtreGroupes, setFiltreGroupes] = useState({ filieres: [], niveaux: [], annees: [] });

  /*
   * Ce qu'on prépare avant de télécharger — la semaine, les groupes cochés, le
   * filtre —, partagé pendant le guidage (2026-10-04). Une clé PAR DOCUMENT :
   * chaque carte a sa fenêtre. Le téléchargement, lui, n'est pas rejoué : il
   * ÉCRIT (POST), et l'autre écran n'a pas à recevoir le fichier.
   */
  useEtatPartage(
    `documents.choix.${empreinte(String(titre ?? ''))}`,
    { semaine: semaineChoisie ?? null, choisis, ...filtreGroupes },
    (valeur) => {
      if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return;
      setSemaine(valeur.semaine ?? null);
      setChoisis(Array.isArray(valeur.choisis) ? valeur.choisis : []);
      setFiltreGroupes({
        filieres: Array.isArray(valeur.filieres) ? valeur.filieres : [],
        niveaux: Array.isArray(valeur.niveaux) ? valeur.niveaux : [],
        annees: Array.isArray(valeur.annees) ? valeur.annees : [],
      });
    }
  );

  const groupes = contexte.data?.groupes ?? [];
  const groupesIdentites = contexte.data?.groupesIdentites ?? {};
  const facettes = useMemo(() => facettesDesGroupes(groupes, groupesIdentites), [groupes, groupesIdentites]);
  const retenus = useMemo(() => {
    const parIdentite = filtrerGroupes(groupes, groupesIdentites, filtreGroupes);
    return choisis.length > 0 ? parIdentite.filter((g) => choisis.includes(g)) : parIdentite;
  }, [groupes, groupesIdentites, filtreGroupes, choisis]);

  const telechargement = useMutation({
    mutationFn: (format) => telecharger(avecSemaine ? { format, groupes: retenus, semaine } : { format, groupes: retenus }),
    onSuccess: onFermer,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const pret = (!avecSemaine || Boolean(semaine)) && retenus.length > 0 && !telechargement.isPending;

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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

            {avecSemaine && (
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
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              {formats.map((format) => {
                const { libelle, Icone, couleur } = FORMATS[format];
                return (
                  <Button
                    key={format}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={!pret}
                    onClick={() => telechargement.mutate(format)}
                  >
                    <Icone className={`size-3.5 ${couleur}`} />
                    {libelle}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
