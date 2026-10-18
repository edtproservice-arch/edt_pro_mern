import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { File, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { facettesDesGroupes, filtrerGroupes, semaineAOuvrir } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChoixSujets, FiltreGroupes } from '@/features/edition/FiltresDetaillee';
import { chargerContexte, chargerSemaines } from '@/features/emploi/api';
import { chargerStagiaires } from './api';
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
 * @param {(options: {format, groupes, semaine?, valeurs?}) => Promise} telecharger
 * @param {string[]} formats — parmi `docx`, `pdf`, `xlsx`
 * @param {(groupe: string) => boolean} [groupesAdmis] — les groupes que le
 *   document concerne (la convocation à l'EFF : 2ᵉ et 3ᵉ année, 2026-10-11) ;
 *   les autres ne sont pas proposés.
 * @param {string} [videGroupes] — ce que dit la fenêtre quand aucun groupe n'est admis.
 * @param {Array<{nom, libelle, type?, defaut?, placeholder?}>} [champs] — des
 *   valeurs communes à tous les stagiaires (date, horaire de l'épreuve…),
 *   rendues à `telecharger` dans `valeurs`.
 * @param {boolean} [parStagiaire] — un document PAR STAGIAIRE (attestation,
 *   convention, carte…) : une fois des groupes cochés, leurs stagiaires se
 *   choisissent aussi (2026-10-17, demande du porteur : « un filtre par
 *   stagiaire si je sélectionne le groupe, sauf les documents liste »).
 *   Aucun coché = tous ; rendus à `telecharger` dans `matricules`.
 * @param {(format: string) => Promise} [vierge] — « Imprimer vierge » (2026-10-18,
 *   demande du porteur : l'option pour TOUS les documents) : cochée, la case
 *   télécharge le document VIDE — aucun groupe, aucun stagiaire, seul
 *   l'établissement écrit ; le choix des groupes, des stagiaires et des champs
 *   disparaît alors, il n'aurait plus d'effet.
 */
export default function DialogueChoixGroupes({
  ouvert,
  onFermer,
  titre,
  description,
  avecSemaine = false,
  formats,
  telecharger,
  groupesAdmis = null,
  videGroupes = 'Aucun groupe n’est concerné par ce document.',
  champs = null,
  parStagiaire = false,
  vierge = null,
}) {
  const [enVierge, setEnVierge] = useState(false);
  const [valeurs, setValeurs] = useState(() =>
    Object.fromEntries((champs ?? []).map((champ) => [champ.nom, champ.defaut ?? '']))
  );
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

  const groupes = (contexte.data?.groupes ?? []).filter((groupe) => !groupesAdmis || groupesAdmis(groupe));
  const groupesIdentites = contexte.data?.groupesIdentites ?? {};
  const facettes = useMemo(() => facettesDesGroupes(groupes, groupesIdentites), [groupes, groupesIdentites]);
  const retenus = useMemo(() => {
    const parIdentite = filtrerGroupes(groupes, groupesIdentites, filtreGroupes);
    return choisis.length > 0 ? parIdentite.filter((g) => choisis.includes(g)) : parIdentite;
  }, [groupes, groupesIdentites, filtreGroupes, choisis]);

  /*
   * ═══ LE FILTRE PAR STAGIAIRE (2026-10-17) ═══ Proposé dès qu'un groupe est
   * COCHÉ — pas sur « tous les groupes » : la liste de toute l'école ne se
   * parcourt pas. Les stagiaires des groupes cochés, chargés groupe par groupe.
   * ⚠️ Un stagiaire coché dont on décoche ensuite le groupe ne compte plus :
   * seuls ceux des groupes encore retenus partent au serveur.
   */
  const [stagiairesChoisis, setStagiairesChoisis] = useState([]);
  const filtreStagiaires = parStagiaire && choisis.length > 0;
  const groupesDesStagiaires = filtreStagiaires ? retenus : [];
  const listes = useQueries({
    queries: groupesDesStagiaires.map((groupe) => ({
      queryKey: ['stagiaires', 'liste', { groupe }],
      queryFn: () => chargerStagiaires({ groupe }),
      enabled: ouvert,
      staleTime: 60_000,
    })),
  });
  // Quelques centaines au plus : recalculées à chaque rendu, sans mémo.
  const parMatricule = new Map();
  for (const liste of listes) {
    for (const stagiaire of liste.data?.stagiaires ?? []) parMatricule.set(stagiaire.matricule, stagiaire);
  }
  const stagiaires = [...parMatricule.values()].sort((a, b) =>
    `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr')
  );
  // Le matricule dans le libellé : deux homonymes restent distincts, et se cherchent aussi par lui.
  const nomDe = new Map(
    stagiaires.map((s) => [s.matricule, `${`${s.nom ?? ''} ${s.prenom ?? ''}`.trim() || s.matricule} — ${s.matricule}`])
  );
  const matricules = filtreStagiaires ? stagiairesChoisis.filter((m) => nomDe.has(m)) : [];

  const telechargement = useMutation({
    mutationFn: (format) =>
      enVierge && vierge
        ? vierge(format)
        : telecharger({
            format,
            groupes: retenus,
            ...(avecSemaine ? { semaine } : {}),
            ...(champs ? { valeurs } : {}),
            ...(matricules.length > 0 ? { matricules } : {}),
          }),
    onSuccess: onFermer,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const pret =
    !telechargement.isPending && (enVierge || ((!avecSemaine || Boolean(semaine)) && retenus.length > 0));

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          {/* ⚠️ MASQUÉE À L'ÉCRAN (2026-10-18, demande du porteur : « supprime la description depuis
              tous les modals ») — gardée pour les lecteurs d'écran, qui annoncent ainsi la fenêtre. */}
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>

        {contexte.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement des groupes…</p>
        ) : (
          <div className="space-y-4">
            {vierge && (
              <label className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
                <Checkbox className="mt-0.5" checked={enVierge} onCheckedChange={(coche) => setEnVierge(coche === true)} />
                <span>
                  Imprimer vierge
                  <span className="block text-xs text-muted-foreground">
                    Un exemplaire vide, sans groupe ni stagiaire — seul l’établissement est écrit.
                  </span>
                </span>
              </label>
            )}

            {!enVierge && (
              <>
                {groupes.length === 0 && (contexte.data?.groupes ?? []).length > 0 && (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{videGroupes}</p>
                )}
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

                {filtreStagiaires && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Stagiaires</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ChoixSujets
                        sujets={stagiaires.map((s) => s.matricule)}
                        choisis={matricules}
                        libelle={(matricule) => nomDe.get(matricule) ?? matricule}
                        entete="Stagiaire"
                        onChanger={setStagiairesChoisis}
                      />
                      <span className="text-xs text-muted-foreground">
                        {listes.some((l) => l.isLoading)
                          ? 'Chargement…'
                          : `${matricules.length || stagiaires.length} sur ${stagiaires.length}`}
                      </span>
                    </div>
                  </div>
                )}

                {champs && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {champs.map((champ) =>
                      champ.type === 'checkbox' ? (
                        // Une option à cocher (2026-10-11 : renouveler les QR des cartes de stagiaire).
                        <label key={champ.nom} className="flex items-start gap-2 text-sm sm:col-span-2">
                          <Checkbox
                            className="mt-0.5"
                            checked={Boolean(valeurs[champ.nom])}
                            onCheckedChange={(coche) => setValeurs((actuelles) => ({ ...actuelles, [champ.nom]: coche === true }))}
                          />
                          <span>
                            {champ.libelle}
                            {champ.aide && <span className="block text-xs text-muted-foreground">{champ.aide}</span>}
                          </span>
                        </label>
                      ) : (
                      <div key={champ.nom} className={champ.large ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
                        <Label htmlFor={`champ-${champ.nom}`} className="text-xs font-medium text-muted-foreground">
                          {champ.libelle}
                        </Label>
                        <Input
                          id={`champ-${champ.nom}`}
                          type={champ.type ?? 'text'}
                          value={valeurs[champ.nom] ?? ''}
                          placeholder={champ.placeholder}
                          className="h-9"
                          onChange={(evenement) =>
                            setValeurs((actuelles) => ({ ...actuelles, [champ.nom]: evenement.target.value }))
                          }
                        />
                      </div>
                      )
                    )}
                  </div>
                )}

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
              </>
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
                    {telechargement.isPending && telechargement.variables === format ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Icone className={`size-3.5 ${couleur}`} />
                    )}
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
