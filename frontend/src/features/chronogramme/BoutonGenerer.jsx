import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DERNIERES_SEMAINES,
  FIN_SEMESTRE_1,
  HEURES_PAR_JOUR_CIBLE,
  PAS,
  PLAFOND_MODULE_SEMAINE,
  PLANCHER_HEBDOMADAIRE,
  PLANCHER_MASSE_MOYENNE,
  RESERVE_REGIONALE,
  SEUIL_PETITE_MASSE,
  SEUIL_PLANCHER_ABSOLU,
} from 'shared/domain';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';

import { genererChronogramme } from './api';

/**
 * Génération automatique du chronogramme (2026-10-04, demande du porteur).
 *
 * ═══ SIMULER, PUIS APPLIQUER ═══
 * La génération réécrit les plannings de TOUS les groupes. Le directeur voit
 * d'abord le bilan — heures planifiées, ce qui ne trouve pas de place, la
 * charge obtenue par formateur — et n'écrit qu'ensuite. C'est la même
 * simulation que l'écriture, au caractère près : le serveur exécute le même
 * calcul et s'arrête avant d'écrire.
 *
 * ⚠️ « APPLIQUER » EXIGE UNE SIMULATION DU MODE COURANT : changer de mode
 *    après avoir simulé effacerait le bilan lu, et l'on confirmerait autre
 *    chose que ce qu'on a vu.
 */
const MODES = [
  {
    valeur: 'remplacer',
    titre: 'Tout refaire',
    detail:
      'Les cases des modules affectés sont recalculées pour tous les groupes. Les modules sans affectation ne sont pas touchés.',
  },
  {
    valeur: 'completer',
    titre: 'Compléter l’existant',
    detail:
      'Rien n’est effacé : seules les heures qui manquent encore sont réparties, autour de ce qui est déjà saisi.',
  },
];

export default function BoutonGenerer({ lectureSeule = false }) {
  const [ouvert, setOuvert] = useState(false);
  const [mode, setMode] = useState('remplacer');
  const [bilan, setBilan] = useState(null);
  const cache = useQueryClient();

  const simulation = useMutation({
    mutationFn: () => genererChronogramme({ mode, simulation: true }),
    onSuccess: setBilan,
    onError: (erreur) => toast.error('Simulation impossible', { description: erreur.message }),
  });

  const application = useMutation({
    mutationFn: () => genererChronogramme({ mode, simulation: false }),
    onSuccess: (resultat) => {
      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      cache.invalidateQueries({ queryKey: ['chronogramme'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-completude'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-liaison'] });
      toast.success('Chronogramme généré', {
        description: `${resultat.heuresPlanifiees} h réparties sur ${resultat.groupes} groupe(s).`,
      });
      setOuvert(false);
      setBilan(null);
    },
    onError: (erreur) => toast.error('Génération impossible', { description: erreur.message }),
  });

  const changerMode = (valeur) => {
    setMode(valeur);
    setBilan(null);
  };

  const occupe = simulation.isPending || application.isPending;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        disabled={lectureSeule}
        onClick={() => {
          setBilan(null);
          setOuvert(true);
        }}
        title="Répartir automatiquement les heures de chaque module sur les semaines"
      >
        <Wand2 className="size-3.5" />
        Générer
      </Button>

      <Dialog open={ouvert} onOpenChange={(etat) => !occupe && setOuvert(etat)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Générer le chronogramme</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 text-sm text-muted-foreground">
                <span className="block">
                  Les modules sont planifiés dans l’ordre : régional S1, régional annuel, régional
                  S2, puis normal S1, annuel, S2.
                </span>
                <span className="block">
                  Chaque formateur vise sa masse affectée / 35 par semaine, jamais moins de{' '}
                  {PLANCHER_HEBDOMADAIRE} h au-delà de {SEUIL_PETITE_MASSE} h affectées — moins{' '}
                  {HEURES_PAR_JOUR_CIBLE} h par jour férié, de stage partiel, de formation ou
                  avant la rentrée.
                </span>
                <span className="block">
                  Cette charge n’est jamais dépassée de plus de {PAS} h : les heures du S1 qui
                  n’y tiennent pas passent après la S{FIN_SEMESTRE_1}, et la fin d’année peut
                  être plus légère.
                </span>
                <span className="block">
                  Minimum par semaine, fériés compris : {PLANCHER_HEBDOMADAIRE} h au-delà de{' '}
                  {SEUIL_PLANCHER_ABSOLU} h affectées, {PLANCHER_MASSE_MOYENNE} h entre{' '}
                  {SEUIL_PETITE_MASSE} h et {SEUIL_PLANCHER_ABSOLU} h. Un module ne prend pas plus
                  de {PLAFOND_MODULE_SEMAINE} h par semaine pour un groupe, sauf si sa masse
                  l’exige pour tenir dans son semestre.
                </span>
                <span className="block">
                  Un module commencé reçoit au moins un créneau chaque semaine jusqu’à sa fin. Chaque
                  module régional garde {RESERVE_REGIONALE} h non planifiées par groupe.
                </span>
                <span className="block">
                  Le module « Métier et formation » est planifié en S1, au plus tard en S2.
                </span>
                <span className="block">
                  Les séances synchrones d’un module ne tombent ni sur sa première ni sur sa
                  dernière semaine de présentiel.
                </span>
                <span className="block">
                  Fin de planification : S{DERNIERES_SEMAINES.PREMIERE} en 1ʳᵉ année, S
                  {DERNIERES_SEMAINES.DEUXIEME} en 2ᵉ année, S{DERNIERES_SEMAINES.TROISIEME_CDJ} en
                  3ᵉ année cours du jour.
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={mode} onValueChange={changerMode} className="gap-3" disabled={occupe}>
            {MODES.map((option) => (
              <Label
                key={option.valeur}
                htmlFor={`mode-generation-${option.valeur}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal',
                  mode === option.valeur && 'border-primary bg-primary/5'
                )}
              >
                <RadioGroupItem
                  id={`mode-generation-${option.valeur}`}
                  value={option.valeur}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">{option.titre}</span>
                  <span className="block text-xs text-muted-foreground">{option.detail}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          {bilan && <Bilan bilan={bilan} />}

          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={occupe} onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button variant="outline" disabled={occupe} onClick={() => simulation.mutate()}>
              {simulation.isPending && <Loader2 className="size-4 animate-spin" />}
              {bilan ? 'Simuler à nouveau' : 'Simuler'}
            </Button>
            <Button
              disabled={!bilan || occupe || bilan.heuresPlanifiees === 0}
              onClick={() => application.mutate()}
              title={bilan ? undefined : 'Simulez d’abord pour voir ce qui sera écrit'}
            >
              {application.isPending && <Loader2 className="size-4 animate-spin" />}
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ce que la génération produirait — lu AVANT d'écrire. */
function Bilan({ bilan }) {
  const complet = bilan.heuresNonPlanifiees === 0;

  return (
    <div className="space-y-3">
      <Alerte type={complet ? 'succes' : 'avertissement'}>
        <strong>{bilan.heuresPlanifiees} h</strong> réparties sur {bilan.heuresDemandees} h à
        planifier — {bilan.groupes} groupe(s), {bilan.cellules} case(s).
        {bilan.reserveRegionale > 0 &&
          ` ${bilan.reserveRegionale} h laissées en réserve sur les modules régionaux.`}
        {!complet && ` ${bilan.heuresNonPlanifiees} h ne trouvent pas de place.`}
      </Alerte>

      {bilan.mode === 'remplacer' && bilan.partsRemplacees > 0 && (
        <Alerte type="avertissement">
          {bilan.partsRemplacees} case(s) déjà saisie(s) seront remplacées par la génération.
        </Alerte>
      )}

      {bilan.debordements?.length > 0 && (
        <div className="rounded-md border border-warning/40">
          <p className="border-b bg-warning/10 px-3 py-2 text-xs font-medium">
            {bilan.heuresDebordees} h du S1 reportées après la S{FIN_SEMESTRE_1}, pour ne pas
            surcharger les formateurs
          </p>
          <ul className="max-h-40 divide-y overflow-y-auto text-xs">
            {bilan.debordements.map((ligne) => (
              <li
                key={`${ligne.groupes.join('+')}|${ligne.module}|${ligne.type}|${ligne.formateur}`}
                className="px-3 py-1.5"
              >
                <span className="font-medium">
                  {ligne.groupes.join(' + ')} · {ligne.module} (
                  {ligne.type === 'S' ? 'synchrone' : 'présentiel'}) · {ligne.heures} h
                </span>{' '}
                <span className="text-muted-foreground">
                  — {ligne.formateur}, jusqu’en S{ligne.derniereSemaine}.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bilan.nonPlanifiees.length > 0 && (
        <div className="rounded-md border">
          <p className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">
            Heures non planifiées
          </p>
          <ul className="max-h-40 divide-y overflow-y-auto text-xs">
            {bilan.nonPlanifiees.map((ligne) => (
              <li
                key={`${ligne.groupes.join('+')}|${ligne.module}|${ligne.type}|${ligne.semestre}|${ligne.formateur}`}
                className="px-3 py-1.5"
              >
                <span className="font-medium">
                  {ligne.groupes.join(' + ')} · {ligne.module} ({ligne.type === 'S' ? 'synchrone' : 'présentiel'},{' '}
                  {ligne.semestre}) · {ligne.heures} h
                </span>{' '}
                <span className="text-muted-foreground">
                  — {ligne.formateur}. {ligne.motif}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bilan.formateurs.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Formateur</th>
                <th className="px-2 py-2 text-right font-medium">Masse affectée</th>
                <th className="px-2 py-2 text-right font-medium">Cible / sem.</th>
                <th className="px-2 py-2 text-right font-medium">Moyenne obtenue</th>
                <th className="px-2 py-2 text-right font-medium" title="Semaines à plus d’un créneau sous la cible">
                  Sous la cible
                </th>
                <th className="px-2 py-2 text-right font-medium" title="Semaines à plus d’un créneau au-dessus de la cible">
                  Au-dessus
                </th>
                <th className="px-3 py-2 text-right font-medium">Dernière sem.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bilan.formateurs.map((f) => (
                <tr key={f.identifiant}>
                  <td className="px-3 py-1.5 font-medium">{f.nom}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.masseAffectee} h</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.cibleHebdomadaire} h</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.moyenne} h</td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums', f.semainesSousCible > 0 && 'text-warning')}>
                    {f.semainesSousCible}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums', f.semainesAuDessus > 0 && 'text-warning')}>
                    {f.semainesAuDessus}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {f.derniereSemaine ? `S${f.derniereSemaine}` : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
