import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileWarning, Search, Send } from 'lucide-react';
import { JOURS } from 'shared/constants';
import { SEANCES_JOUR, horaireCreneau } from 'shared/domain';
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
import Alerte from '@/components/common/Alerte';
import BoutonFormat from '@/components/common/BoutonFormat';
import { FeuilleDocument } from '@/features/documents/CartesDocuments';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useHorairesCourants } from '@/features/horaires/useHorairesCourants';
import { useAnneeActive } from '@/lib/anneeActive';
import { cn } from '@/lib/utils';
import {
  chargerSemaineConsultation,
  chargerSemainesConsultation,
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

/** « 22/10 » depuis « 2026-10-22 ». */
const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/**
 * ═══ LA FICHE DE RÉCLAMATION, REMPLIE PAR LE FORMATEUR (2026-10-25, demande du
 * porteur) ═══ Une séance (date, heure, lieu), un ou plusieurs stagiaires de ce
 * cours, l'action non disciplinaire et les dégâts immobiliers. Le serveur écrit
 * le reste : le formateur connecté, et la partie « Surveillant » tirée du dossier
 * de chaque stagiaire. Une page par stagiaire.
 */
export default function DocumentReclamation() {
  const [ouvert, setOuvert] = useState(false);
  const [seance, setSeance] = useState(null);
  const seanceId = seance?.id ?? '';
  const [semaineChoisie, setSemaineChoisie] = useState(null);
  const [choisis, setChoisis] = useState(() => new Set());
  const [filtre, setFiltre] = useState('');
  const [action, setAction] = useState('');
  const [degats, setDegats] = useState('');

  /*
   * ═══ LA SÉANCE SE CHOISIT DANS SON EMPLOI DU TEMPS (2026-10-25, demande du
   * porteur) ═══ Les semaines et la grille de « Mon emploi du temps » — mêmes
   * requêtes, même cache, même sélecteur de semaine —, plutôt qu'une longue liste
   * déroulante : on retrouve un incident par le jour et le créneau où il a eu lieu.
   */
  const anneeChoisie = useAnneeActive();
  const horaires = useHorairesCourants();
  const semaines = useQuery({
    queryKey: ['consultation', 'emploi', 'semaines'],
    queryFn: chargerSemainesConsultation,
    enabled: ouvert,
    retry: false,
  });
  const semaine = semaineChoisie ?? semaines.data?.courante ?? null;
  const grille = useQuery({
    queryKey: ['consultation', 'emploi', semaine],
    queryFn: () => chargerSemaineConsultation(semaine),
    enabled: ouvert && Boolean(semaine),
    retry: false,
  });
  const stagiaires = useQuery({
    queryKey: ['consultation', 'reclamation', 'stagiaires', seanceId],
    queryFn: () => chargerStagiairesReclamation(seanceId),
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
      telechargerFicheReclamation({
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

  const fermer = () => {
    setOuvert(false);
    setSeance(null);
    setSemaineChoisie(null);
    setChoisis(new Set());
    setFiltre('');
    setAction('');
    setDegats('');
  };

  // Changer de séance change de cours : les stagiaires cochés ne sont plus les mêmes.
  const choisirSeance = (choisie) => {
    if (choisie.id === seanceId) return;
    setSeance(choisie);
    setChoisis(new Set());
    setFiltre('');
  };
  const plage = seance ? horaireCreneau(seance.jour, seance.seance, horaires) : null;
  const dateSeance = seance ? (grille.data?.jours ?? []).find((j) => j.jour === seance.jour)?.date : null;

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
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Séance</Label>
                <NavigationSemaine
                  semaine={semaine}
                  onChanger={setSemaineChoisie}
                  anneeScolaire={anneeChoisie ?? grille.data?.anneeScolaire}
                  remplies={semaines.data?.semaines ?? []}
                  courante={semaines.data?.courante}
                  semainesPermises={semaines.data?.publications ?? []}
                  cleGuidage="reclamation"
                />
              </div>

              {semaines.isError || grille.isError ? (
                <Alerte type="erreur" titre="Emploi du temps indisponible">
                  {(semaines.error ?? grille.error).message}
                </Alerte>
              ) : grille.isLoading || !grille.data ? (
                <p className="text-xs text-muted-foreground">Chargement de la semaine…</p>
              ) : grille.data.nonPubliee ? (
                <p className="text-xs text-muted-foreground">
                  L’emploi du temps de cette semaine n’a pas encore été publié.
                </p>
              ) : (
                <GrilleSeances grille={grille.data} horaires={horaires} choisie={seance} onChoisir={choisirSeance} />
              )}

              {seance && (
                <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs">
                  <span className="font-medium">
                    {seance.jour} {dateCourte(dateSeance)} · {plage.debut}–{plage.fin}
                  </span>{' '}
                  · {seance.groupe} · {seance.module}
                  {seance.salle ? ` · ${seance.salle}` : ''}
                </p>
              )}
            </div>

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
            <Button variant="outline" onClick={fermer}>
              Fermer
            </Button>
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
              <Button
                disabled={!pret}
                onClick={() => envoi.mutate()}
                className="gap-1.5"
                title="Au directeur et au gestionnaire, par la messagerie"
              >
                <Send className="size-4" />
                {envoi.isPending ? 'Envoi…' : 'Envoyer'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * La semaine du formateur, jours en lignes et créneaux en colonnes : une séance
 * se choisit d'un clic. Une case vide ne se choisit pas — il n'y avait pas cours.
 *
 * ⚠️ L'HEURE DES COLONNES EST CELLE DU LUNDI : le vendredi a les siennes. C'est
 *    pourquoi la séance choisie se redit en dessous avec SON horaire (`plage`).
 */
function GrilleSeances({ grille, horaires, choisie, onChoisir }) {
  const parCase = new Map(
    (grille.seances ?? [])
      .filter((s) => (s.periode ?? 'jour') === 'jour')
      .map((s) => [`${s.jour}|${s.seance}`, s])
  );
  const jours = grille.jours?.length ? grille.jours : JOURS.map((jour) => ({ jour }));

  if (parCase.size === 0) {
    return <p className="text-xs text-muted-foreground">Aucune séance cette semaine.</p>;
  }

  return (
    <>
      <ListeSeances jours={jours} parCase={parCase} horaires={horaires} choisie={choisie} onChoisir={onChoisir} />
      <TableauSeances jours={jours} parCase={parCase} horaires={horaires} choisie={choisie} onChoisir={onChoisir} />
    </>
  );
}

/**
 * SUR TÉLÉPHONE (`sm:hidden`) : un jour après l'autre, ses séances en boutons
 * pleine largeur — créneau et horaire DU JOUR compris, puisqu'il n'y a plus
 * d'en-tête de colonne pour les dire. Un jour sans cours n'apparaît pas.
 */
function ListeSeances({ jours, parCase, horaires, choisie, onChoisir }) {
  return (
    <div className="space-y-3 sm:hidden">
      {jours.map((j) => {
        const duJour = SEANCES_JOUR.map((creneau) => parCase.get(`${j.jour}|${creneau}`)).filter(Boolean);
        if (duJour.length === 0) return null;
        return (
          <div key={j.jour} className="space-y-1.5">
            <p className="text-xs font-semibold">
              {j.jour} <span className="font-normal text-muted-foreground">{dateCourte(j.date)}</span>
            </p>
            <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
              {duJour.map((s) => {
                const active = choisie?.id === s.id;
                const { debut, fin } = horaireCreneau(s.jour, s.seance, horaires);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChoisir(s)}
                    className={cn(
                      'min-w-0 rounded-md px-2.5 py-1.5 text-left text-xs leading-tight transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'bg-success/10 hover:bg-success/25'
                    )}
                  >
                    <span className={cn('block', !active && 'text-muted-foreground')}>
                      {s.seance} · {debut}–{fin}
                    </span>
                    <span className="block truncate font-semibold">{s.groupe}</span>
                    <span className="block truncate">
                      {s.module}
                      {s.salle ? ` · ${s.salle}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** DÈS LA TABLETTE (`sm:block`) : la semaine d'un regard, jours en lignes et créneaux en colonnes. */
function TableauSeances({ jours, parCase, horaires, choisie, onChoisir }) {
  return (
    <div className="hidden overflow-x-auto rounded-md border sm:block">
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="w-24 p-1.5 text-left font-medium">Jour</th>
            {SEANCES_JOUR.map((creneau) => {
              const { debut, fin } = horaireCreneau('Lundi', creneau, horaires);
              return (
                <th key={creneau} className="border-l p-1.5 font-medium">
                  {creneau}
                  <span className="block font-normal text-muted-foreground">
                    {debut}–{fin}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {jours.map((j) => (
            <tr key={j.jour} className="border-t">
              <td className="p-1.5">
                <span className="font-medium">{j.jour}</span>
                <span className="block text-muted-foreground">{dateCourte(j.date)}</span>
              </td>
              {SEANCES_JOUR.map((creneau) => {
                const s = parCase.get(`${j.jour}|${creneau}`);
                if (!s) return <td key={creneau} className="border-l" />;
                const active = choisie?.id === s.id;
                return (
                  <td key={creneau} className="border-l p-0.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChoisir(s)}
                      className={cn(
                        'w-full rounded px-1.5 py-1 text-center leading-tight transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-success/10 hover:bg-success/25'
                      )}
                    >
                      <span className="block truncate font-semibold">{s.groupe}</span>
                      <span className="block truncate">{s.module}</span>
                      <span className={cn('block truncate', !active && 'text-muted-foreground')}>
                        {s.salle || '—'}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
