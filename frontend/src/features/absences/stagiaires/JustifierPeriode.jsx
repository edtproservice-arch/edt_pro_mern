import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import SelecteurDate from '@/components/common/SelecteurDate';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nombre } from '@/lib/nombres';
import { justifierPeriode } from './api';

/**
 * ═══ JUSTIFIER UNE PÉRIODE D'UN COUP ═══ (2026-10-25, demande du porteur) :
 * un certificat de cinq jours couvrait une vingtaine de séances, à justifier
 * une par une dans le registre.
 *
 * ⚠️ LE COMPTE AVANT LE CLIC : la fenêtre dit combien de séances vont changer,
 * lu sur les marquages déjà chargés — le même filtre que le serveur
 * (`justifierPeriode`) : non justifiées, dans la période, retards sur demande.
 *
 * ⚠️ LES DATES PARTENT DES ABSENCES NON JUSTIFIÉES DU STAGIAIRE : la première
 * et la dernière — le cas courant est « tout ce qui reste », à resserrer.
 */
export default function JustifierPeriode({ absences, matriculeFixe = null }) {
  const [ouvert, setOuvert] = useState(false);
  const stagiaires = useMemo(() => {
    const parMatricule = new Map();
    for (const a of absences) {
      if (!parMatricule.has(a.matricule)) parMatricule.set(a.matricule, { matricule: a.matricule, nom: a.nomComplet });
    }
    return [...parMatricule.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [absences]);

  if (stagiaires.length === 0 || !absences.some((a) => !a.justifiee)) return null;

  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <CalendarCheck className="size-3.5" />
          Justifier une période
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {/* Remonté à chaque ouverture : le formulaire repart des absences du moment. */}
        {ouvert && (
          <Formulaire
            absences={absences}
            stagiaires={stagiaires}
            matriculeInitial={matriculeFixe ?? (stagiaires.length === 1 ? stagiaires[0].matricule : '')}
            verrouille={Boolean(matriculeFixe)}
            onTermine={() => setOuvert(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function bornesNonJustifiees(absences, matricule) {
  const dates = absences.filter((a) => a.matricule === matricule && !a.justifiee).map((a) => a.date).sort();
  return { du: dates[0] ?? '', au: dates.at(-1) ?? '' };
}

function Formulaire({ absences, stagiaires, matriculeInitial, verrouille, onTermine }) {
  const [matricule, setMatricule] = useState(matriculeInitial);
  const [{ du, au }, setPeriode] = useState(() => bornesNonJustifiees(absences, matriculeInitial));
  const [motif, setMotif] = useState('');
  const [retards, setRetards] = useState(false);
  const cache = useQueryClient();

  const concernees = absences.filter(
    (a) =>
      a.matricule === matricule &&
      !a.justifiee &&
      a.date >= du &&
      a.date <= au &&
      (retards || a.type !== 'retard')
  );
  const valide = matricule && du && au && du <= au;

  const ecriture = useMutation({
    mutationFn: () => justifierPeriode({ matricule, du, au, motif: motif.trim() || undefined, retards }),
    onSuccess: ({ justifiees }) => {
      cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
      toast.success(`${nombre(justifiees)} marquage(s) justifié(s)`);
      onTermine();
    },
    onError: (erreur) => toast.error('Justification impossible', { description: erreur.message }),
  });

  const choisirStagiaire = (valeur) => {
    setMatricule(valeur);
    setPeriode(bornesNonJustifiees(absences, valeur));
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valide && concernees.length > 0) ecriture.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Justifier une période</DialogTitle>
        <DialogDescription>
          Toutes les absences non justifiées du stagiaire entre deux dates, d’un seul geste — un certificat de
          plusieurs jours, par exemple.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label className="text-xs">Stagiaire</Label>
        <Select value={matricule} onValueChange={choisirStagiaire} disabled={verrouille}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Choisir un stagiaire" />
          </SelectTrigger>
          <SelectContent>
            {stagiaires.map((s) => (
              <SelectItem key={s.matricule} value={s.matricule} className="text-sm">
                {s.nom} <span className="text-muted-foreground">· {s.matricule}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="periode-du" className="text-xs">
            Du
          </Label>
          <SelecteurDate
            id="periode-du"
            valeur={du}
            onChange={(valeur) => setPeriode((p) => ({ ...p, du: valeur }))}
            effacable={false}
            joursDesactives={au ? { after: new Date(`${au}T00:00:00`) } : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periode-au" className="text-xs">
            Au
          </Label>
          <SelecteurDate
            id="periode-au"
            valeur={au}
            onChange={(valeur) => setPeriode((p) => ({ ...p, au: valeur }))}
            effacable={false}
            moisParDefaut={du ? new Date(`${du}T00:00:00`) : undefined}
            joursDesactives={du ? { before: new Date(`${du}T00:00:00`) } : undefined}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="periode-motif" className="text-xs">
          Motif <span className="font-normal text-muted-foreground">(facultatif)</span>
        </Label>
        <Input
          id="periode-motif"
          value={motif}
          maxLength={255}
          placeholder="Certificat médical…"
          onChange={(e) => setMotif(e.target.value)}
          className="h-9"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={retards} onCheckedChange={(valeur) => setRetards(valeur === true)} />
        Justifier aussi les retards de la période
      </label>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
        {!valide
          ? 'Choisissez un stagiaire et une période.'
          : concernees.length === 0
            ? 'Aucune séance non justifiée sur cette période.'
            : `${nombre(concernees.length)} séance(s) seront justifiées. Celles déjà justifiées gardent leur motif.`}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onTermine}>
          Annuler
        </Button>
        <Button type="submit" disabled={!valide || concernees.length === 0 || ecriture.isPending} className="gap-1.5">
          {ecriture.isPending && <Loader2 className="size-4 animate-spin" />}
          Justifier
        </Button>
      </DialogFooter>
    </form>
  );
}
