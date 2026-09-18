import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Plus, Trash2, X } from 'lucide-react';
import { NOTE_COMPORTEMENT_MAX, anneeScolaireCourante, enJour, sanctionComportement } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDecorationCalendrier } from '@/components/common/decorationCalendrier';
import { useAnneeActive } from '@/lib/anneeActive';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import { chargerFiche, declarerIndiscipline, retirerIndiscipline } from './api';
import BadgeSanction from './BadgeSanction';

/**
 * ═══ LA SAISIE DU COMPORTEMENT ═══ (F9, 2026-09-15, demande du porteur : « une
 * entrée pour le comportement, une sanction ou plus, avec la saisie du motif ».)
 * Grille « Comportement / 5 points » : la n-ième indiscipline porte le total
 * retiré à n — mise en garde (SG), avertissement (D), blâme, exclusion de
 * 2 jours, exclusion définitive (CD).
 *
 * Partagée par la FICHE du stagiaire et par la boîte « Comportement » du tableau
 * des notes : deux formulaires auraient divergé au premier ajustement.
 *
 * ⚠️ PLUSIEURS INDISCIPLINES D'UN COUP, CHACUNE AVEC SON MOTIF ET SA DATE : elles
 * partent EN SÉRIE, dans l'ordre chronologique — le rang (donc la sanction) se
 * déduit de l'ordre des dates côté serveur, et deux écritures parallèles le
 * rendraient imprévisible pour deux indisciplines du même jour.
 * ⚠️ LA SANCTION ANNONCÉE PAR LIGNE EST UN APERÇU : elle suppose les nouvelles
 * après les existantes. Une date antérieure à une indiscipline déjà déclarée
 * décale les rangs — la liste, relue après l'envoi, dit alors le vrai.
 */
const ligneVide = () => ({ cle: crypto.randomUUID(), date: enJour(new Date()), motif: '' });

export function SaisieComportement({ fiche }) {
  const cache = useQueryClient();
  const [lignes, setLignes] = useState(() => [ligneVide()]);
  const aujourdHui = enJour(new Date());
  const relire = () => cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
  const existantes = fiche.indisciplines.length;
  // L'année affichée par la barre latérale ; à défaut, celle d'aujourd'hui.
  const annee = useAnneeActive() ?? anneeScolaireCourante();
  const decoration = useDecorationCalendrier(annee);

  const aEnvoyer = lignes.filter((l) => l.motif.trim());
  const modifier = (cle, champs) => setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...champs } : l)));

  const declarer = useMutation({
    mutationFn: async () => {
      const ordonnees = [...aEnvoyer].sort((a, b) => a.date.localeCompare(b.date));
      for (const ligne of ordonnees) {
        await declarerIndiscipline({ matricule: fiche.matricule, date: ligne.date, motif: ligne.motif.trim() });
      }
      return ordonnees.length;
    },
    onSuccess: (n) => {
      setLignes([ligneVide()]);
      toast.success(n > 1 ? `${n} indisciplines déclarées` : 'Indiscipline déclarée');
    },
    onError: (erreur) => toast.error('Déclaration impossible', { description: erreur.message }),
    // Une série interrompue a pu en écrire une partie : on relit dans les deux cas.
    onSettled: relire,
  });
  const retirer = useMutation({
    mutationFn: (id) => retirerIndiscipline(id),
    onSuccess: () => {
      relire();
      toast.success('Indiscipline retirée — les suivantes remontent d’un rang');
    },
    onError: (erreur) => toast.error('Retrait impossible', { description: erreur.message }),
  });

  let rangApercu = existantes;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Comportement</h3>
        <p className="text-xs text-muted-foreground">
          {fiche.note.comportement.note} / {NOTE_COMPORTEMENT_MAX} · {existantes} indiscipline(s)
        </p>
      </div>

      <form
        className="space-y-2 rounded-lg border bg-muted/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (aEnvoyer.length) declarer.mutate();
        }}
      >
        {lignes.map((ligne, i) => {
          const rang = ligne.motif.trim() ? ++rangApercu : null;
          return (
            <div key={ligne.cle} className="flex flex-wrap items-center gap-2">
              <ChoixDate
                valeur={ligne.date}
                decoration={decoration}
                aujourdHui={aujourdHui}
                onChoisir={(date) => modifier(ligne.cle, { date })}
                libelle={`Date de l’indiscipline ${i + 1}`}
              />
              <Input
                value={ligne.motif}
                maxLength={255}
                onChange={(e) => modifier(ligne.cle, { motif: e.target.value })}
                placeholder="Motif de l’indiscipline"
                className="h-8 min-w-48 flex-1 bg-card text-xs"
                aria-label={`Motif de l’indiscipline ${i + 1}`}
              />
              <span className="min-w-28">
                {rang ? <BadgeSanction sanction={sanctionComportement(rang)} /> : null}
              </span>
              {lignes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  onClick={() => setLignes((ls) => ls.filter((l) => l.cle !== ligne.cle))}
                  aria-label={`Retirer la ligne ${i + 1}`}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setLignes((ls) => [...ls, ligneVide()])}
          >
            <Plus className="size-3.5" /> Ajouter une indiscipline
          </Button>
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={!aEnvoyer.length || declarer.isPending}>
            {aEnvoyer.length > 1 ? `Déclarer ${aEnvoyer.length} indisciplines` : 'Déclarer'}
          </Button>
        </div>
      </form>

      {existantes === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune indiscipline cette année — comportement à 5 / 5.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {fiche.indisciplines.map((ind) => (
            <li key={ind.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <span className="font-semibold">{ind.rang === 1 ? '1ère' : `${ind.rang}ème`}</span>
              <span className="text-muted-foreground">{ind.date}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{ind.motif}</span>
              <span className="font-medium tabular-nums text-destructive">−{Math.min(ind.rang, NOTE_COMPORTEMENT_MAX)}</span>
              <BadgeSanction sanction={ind.sanction} />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                disabled={retirer.isPending}
                onClick={() => retirer.mutate(ind.id)}
                aria-label={`Retirer l’indiscipline du ${ind.date}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * La date d'une indiscipline, au calendrier de shadcn (2026-09-17, demande du
 * porteur) — avec la décoration de tous les calendriers de saisie : français,
 * fériés, vacances, bornes de l'année scolaire.
 * ⚠️ LES JOURS À VENIR SONT FERMÉS : le serveur refuse une indiscipline déclarée
 * à l'avance (DATE_FUTURE). Cette borne s'AJOUTE à celles de la décoration.
 * ⚠️ La date reste une chaîne « AAAA-MM-JJ », lue à minuit LOCAL : une date de
 * minuit UTC rendrait la veille au Maroc.
 */
function ChoixDate({ valeur, decoration, aujourdHui, onChoisir, libelle }) {
  const [ouvert, setOuvert] = useState(false);
  const date = new Date(`${valeur}T00:00:00`);
  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 w-44 justify-start gap-2 bg-card text-xs font-normal"
          aria-label={libelle}
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          required
          selected={date}
          defaultMonth={date}
          onSelect={(choix) => {
            if (!choix) return;
            onChoisir(enJour(choix));
            setOuvert(false);
          }}
          {...decoration}
          disabled={[...(decoration.disabled ?? []), { after: new Date(`${aujourdHui}T00:00:00`) }]}
        />
      </PopoverContent>
    </Popover>
  );
}

/** La boîte « Comportement » ouverte depuis le tableau des notes. */
export function DialogueComportement({ matricule, onFermer }) {
  const fiche = useQuery({
    queryKey: ['absences-stagiaires', 'fiche', matricule],
    queryFn: () => chargerFiche(matricule),
    enabled: Boolean(matricule),
    retry: false,
  });

  return (
    <Dialog open={Boolean(matricule)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-2xl flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{fiche.data?.nom ?? 'Comportement'}</DialogTitle>
          <DialogDescription>
            {fiche.data ? `${fiche.data.matricule} · ${fiche.data.groupe}` : 'Chargement…'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {fiche.error && <Alerte type="erreur" titre="Fiche indisponible">{fiche.error.message}</Alerte>}
          {fiche.data && <SaisieComportement fiche={fiche.data} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
