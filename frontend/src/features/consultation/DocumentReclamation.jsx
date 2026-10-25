import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileWarning, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import BoutonFormat from '@/components/common/BoutonFormat';
import { FeuilleDocument } from '@/features/documents/CartesDocuments';
import { cn } from '@/lib/utils';
import {
  chargerStagiairesDeSeance,
  telechargerDocumentVierge,
  telechargerReclamationDeSeance,
} from '@/features/absences/stagiaires/api';
import ChoixSeance from './ChoixSeance';
import {
  chargerStagiairesReclamation,
  envoyerFicheReclamation,
  telechargerFicheReclamation,
} from './api';

const DOCUMENT = { titre: 'Fiche de réclamation', resume: 'Incident signalé en séance', icone: FileWarning };

/**
 * Action non disciplinaire, dégâts immobiliers : 256 caractères au plus (2026-10-26,
 * demande du porteur) — la même borne au serveur. Ils tiennent ainsi sur leur ligne
 * de la fiche imprimée.
 */
const MAX_SAISIE = 256;

/** « 120 / 256 », qui passe en rouge à la limite — sans lui, la frappe s'arrête sans raison visible. */
function Compteur({ valeur }) {
  const longueur = valeur.length;
  return (
    <p className={cn('text-right text-xs tabular-nums text-muted-foreground', longueur >= MAX_SAISIE && 'text-destructive')}>
      {longueur} / {MAX_SAISIE}
    </p>
  );
}

/**
 * ═══ LA FICHE DE RÉCLAMATION, REMPLIE PAR LE FORMATEUR (2026-10-25, demande du
 * porteur) ═══ Une séance (date, heure, lieu), un ou plusieurs stagiaires de ce
 * cours, l'action non disciplinaire et les dégâts immobiliers. Le serveur écrit
 * le reste : le formateur connecté, et la partie « Surveillant » tirée du dossier
 * de chaque stagiaire. Une page par stagiaire.
 */
/*
 * ═══ `direction` : LA MÊME FENÊTRE POUR LE DIRECTEUR ET LE GESTIONNAIRE (2026-10-26) ═══
 * Toute séance de l'établissement, choisie formateur par formateur, et la fiche
 * nomme le formateur DE LA SÉANCE. Pas de bouton « Envoyer » : ce sont eux qui
 * recevraient la fiche — ils l'impriment directement.
 */
const telechargerReclamationVierge = telechargerDocumentVierge('reclamation');

export default function DocumentReclamation({ direction = false }) {
  const [ouvert, setOuvert] = useState(false);
  const [seance, setSeance] = useState(null);
  const seanceId = seance?.id ?? '';
  const [choisis, setChoisis] = useState(() => new Set());
  const [filtre, setFiltre] = useState('');
  const [action, setAction] = useState('');
  const [degats, setDegats] = useState('');

  const stagiaires = useQuery({
    queryKey: ['reclamation', direction ? 'direction' : 'formateur', 'stagiaires', seanceId],
    queryFn: () => (direction ? chargerStagiairesDeSeance(seanceId) : chargerStagiairesReclamation(seanceId)),
    enabled: ouvert && Boolean(seanceId),
    retry: false,
  });

  const liste = stagiaires.data?.stagiaires ?? [];
  const visibles = useMemo(() => {
    const terme = filtre.trim().toLowerCase();
    return terme ? liste.filter((s) => `${s.nom} ${s.matricule}`.toLowerCase().includes(terme)) : liste;
  }, [liste, filtre]);

  const telechargement = useMutation({
    mutationFn: (format) =>
      (direction ? telechargerReclamationDeSeance : telechargerFicheReclamation)({
        format,
        seanceId,
        matricules: [...choisis],
        actionNonDisciplinaire: action,
        degats,
      }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  /*
   * ═══ ENVOYER AU DIRECTEUR ET AUX GESTIONNAIRES (2026-10-26, demande du porteur) ═══
   * Par la messagerie, la fiche jointe : ils l'impriment depuis le message. Le
   * serveur choisit les destinataires — l'écran n'a rien à en connaître.
   */
  const envoi = useMutation({
    mutationFn: () =>
      envoyerFicheReclamation({ seanceId, matricules: [...choisis], actionNonDisciplinaire: action, degats }),
    onSuccess: (bilan) => {
      toast.success('Fiche envoyée', {
        description: `Au directeur et au gestionnaire — ${bilan.envoyes} destinataire(s), par la messagerie.`,
      });
      fermer();
    },
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });
  const vierge = useMutation({
    mutationFn: telechargerReclamationVierge,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const fermer = () => {
    setOuvert(false);
    setSeance(null);
    setChoisis(new Set());
    setFiltre('');
    setAction('');
    setDegats('');
  };

  // Changer de séance change de cours : les stagiaires cochés ne sont plus les mêmes.
  const choisirSeance = (choisie) => {
    if ((choisie?.id ?? '') === seanceId) return;
    setSeance(choisie ?? null);
    setChoisis(new Set());
    setFiltre('');
  };

  const basculer = (matricule, coche) =>
    setChoisis((avant) => {
      const apres = new Set(avant);
      if (coche) apres.add(matricule);
      else apres.delete(matricule);
      return apres;
    });

  const tousCoches = visibles.length > 0 && visibles.every((s) => choisis.has(s.matricule));
  const pret = Boolean(seanceId) && choisis.size > 0 && !telechargement.isPending && !envoi.isPending;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={`Remplir : ${DOCUMENT.titre}`}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FeuilleDocument document={DOCUMENT} pied="Word · PDF" className="cursor-pointer hover:border-border-strong" />
      </button>

      <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && fermer()}>
        {/*
          ⚠️ RESPONSIVE (2026-10-26, signalé par le porteur sur téléphone) : la fenêtre
          s'élargissait à la largeur MINIMALE de la grille, et titre, semaine et
          créneaux sortaient de l'écran. Elle est bornée à l'écran, et son contenu
          peut rétrécir (`min-w-0` : un enfant de grille garde sinon sa largeur de
          contenu) ; sur téléphone, la grille cède la place à une liste par jour.
        */}
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>{DOCUMENT.titre}</DialogTitle>
            <DialogDescription>
              Une fiche par stagiaire. La partie « Surveillant » — journées d’absence, justifiées et non
              justifiées, et sanctions déjà encourues — se remplit d’après son dossier.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4">
            {/* La séance se choisit dans son emploi du temps — voir `ChoixSeance`. */}
            <ChoixSeance
              seance={seance}
              onChoisir={choisirSeance}
              cleGuidage={direction ? 'reclamation-direction' : 'reclamation'}
              direction={direction}
            />

            {seanceId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>
                    Stagiaire(s) {choisis.size > 0 && <span className="text-muted-foreground">— {choisis.size} choisi(s)</span>}
                  </Label>
                  {visibles.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => visibles.forEach((s) => basculer(s.matricule, !tousCoches))}
                    >
                      {tousCoches ? 'Tout décocher' : 'Tout cocher'}
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filtre}
                    onChange={(evenement) => setFiltre(evenement.target.value)}
                    placeholder="Nom ou matricule…"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
                  {stagiaires.isLoading && <p className="p-2 text-xs text-muted-foreground">Chargement…</p>}
                  {stagiaires.isError && <p className="p-2 text-xs text-destructive">{stagiaires.error.message}</p>}
                  {stagiaires.data && liste.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">
                      Aucun stagiaire de ce groupe dans la base Konosys de l’année.
                    </p>
                  )}
                  {visibles.map((s) => (
                    <label
                      key={s.matricule}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={choisis.has(s.matricule)}
                        onCheckedChange={(coche) => basculer(s.matricule, coche === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{s.nom}</span>
                      <span className="text-xs text-muted-foreground">{s.groupe}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reclamation-action">Action non disciplinaire</Label>
              <Textarea
                id="reclamation-action"
                value={action}
                onChange={(evenement) => setAction(evenement.target.value)}
                maxLength={MAX_SAISIE}
                rows={3}
                placeholder="Ce qui s’est passé pendant la séance…"
              />
              <Compteur valeur={action} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reclamation-degats">Dégâts immobiliers</Label>
              <Textarea
                id="reclamation-degats"
                value={degats}
                onChange={(evenement) => setDegats(evenement.target.value)}
                maxLength={MAX_SAISIE}
                rows={2}
                placeholder="Matériel ou locaux endommagés — laissez vide s’il n’y en a pas"
              />
              <Compteur valeur={degats} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={fermer}>
                Fermer
              </Button>
              <Button
                variant="ghost"
                className="text-xs text-muted-foreground"
                disabled={vierge.isPending}
                onClick={() => vierge.mutate('pdf')}
              >
                {vierge.isPending ? 'Préparation…' : 'Exemplaire vierge'}
              </Button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {['docx', 'pdf'].map((format) => (
                <BoutonFormat
                  key={format}
                  format={format}
                  disabled={!pret}
                  enCours={telechargement.isPending && telechargement.variables === format}
                  onClick={() => telechargement.mutate(format)}
                />
              ))}
              {!direction && (
                <Button
                  disabled={!pret}
                  onClick={() => envoi.mutate()}
                  className="gap-1.5"
                  title="Au directeur et au gestionnaire, par la messagerie"
                >
                  <Send className="size-4" />
                  {envoi.isPending ? 'Envoi…' : 'Envoyer'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
