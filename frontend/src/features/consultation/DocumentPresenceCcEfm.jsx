import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
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
import BoutonFormat from '@/components/common/BoutonFormat';
import { FeuilleDocument } from '@/features/documents/CartesDocuments';
import { telechargerCcEfmDeSeance, telechargerDocumentVierge } from '@/features/absences/stagiaires/api';
import { cn } from '@/lib/utils';
import ChoixSeance from './ChoixSeance';
import { exporterPresenceCcEfmConsultation } from './api';

const DOCUMENT = { titre: 'Feuille de présence CC/EFM', resume: 'Contrôle continu et EFM', icone: ClipboardList };

const TYPES = [
  { valeur: 'cc', libelle: 'Contrôle continu' },
  { valeur: 'efm', libelle: 'Examen fin de module' },
];
const NUMEROS = [1, 2, 3, 4, 5, 6].map((n) => ({ valeur: n, libelle: String(n) }));
const NATURES = [
  { valeur: 'ecrit', libelle: 'Écrit' },
  { valeur: 'oral', libelle: 'Oral' },
  { valeur: 'tp', libelle: 'TP' },
];
const PORTEES = [
  { valeur: 'local', libelle: 'Local' },
  { valeur: 'regional', libelle: 'Régional' },
];

const telechargerVierge = telechargerDocumentVierge('cc-efm');

/**
 * ═══ LA FEUILLE DE PRÉSENCE CC/EFM, DEPUIS UNE SÉANCE (2026-10-26, demande du
 * porteur : « le même pour CC/EFM — je sélectionne la séance et je coche ») ═══
 * La séance donne le groupe, le module (avec son intitulé), la date et l'horaire ;
 * le formateur coche l'épreuve — contrôle continu (n°, nature) ou examen de fin de
 * module (portée). Le serveur écrit aussi l'effectif dans « Inscrits » ; « Présents »
 * reste à la main. Une case laissée vide ici reste vide sur la feuille.
 */
/* `direction` (2026-10-26) : toute séance de l'établissement, formateur par formateur — voir `ChoixSeance`. */
export default function DocumentPresenceCcEfm({ direction = false }) {
  const [ouvert, setOuvert] = useState(false);
  const [seance, setSeance] = useState(null);
  const [type, setType] = useState(null);
  const [numero, setNumero] = useState(null);
  const [nature, setNature] = useState(null);
  const [portee, setPortee] = useState(null);

  const epreuve = () =>
    type === 'cc'
      ? { type, ...(numero && { numero }), ...(nature && { nature }) }
      : { type, ...(portee && { portee }) };

  const telechargement = useMutation({
    mutationFn: (format) =>
      (direction ? telechargerCcEfmDeSeance : exporterPresenceCcEfmConsultation)({
        format,
        seanceId: seance.id,
        epreuve: epreuve(),
      }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });
  const vierge = useMutation({
    mutationFn: telechargerVierge,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const fermer = () => {
    setOuvert(false);
    setSeance(null);
    setType(null);
    setNumero(null);
    setNature(null);
    setPortee(null);
  };

  const pret = Boolean(seance) && Boolean(type) && !telechargement.isPending;

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
        {/* Bornée à l'écran, comme la fiche de réclamation — voir `DocumentReclamation`. */}
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>{DOCUMENT.titre}</DialogTitle>
            <DialogDescription>
              Choisissez la séance, puis cochez l’épreuve : le groupe, le module, la date, l’horaire et le
              nombre d’inscrits se remplissent d’eux-mêmes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4">
            <ChoixSeance
              seance={seance}
              onChoisir={setSeance}
              cleGuidage={direction ? 'presence-cc-efm-direction' : 'presence-cc-efm'}
              direction={direction}
            />

            <Choix libelle="Épreuve" options={TYPES} valeur={type} onChanger={setType} />

            {type === 'cc' && (
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Choix libelle="N° du contrôle" options={NUMEROS} valeur={numero} onChanger={setNumero} facultatif />
                <Choix libelle="Nature" options={NATURES} valeur={nature} onChanger={setNature} facultatif />
              </div>
            )}
            {type === 'efm' && (
              <Choix libelle="Portée" options={PORTEES} valeur={portee} onChanger={setPortee} facultatif />
            )}
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
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Une rangée de pastilles à choix unique — la forme des filtres par jour de
 * « Mon emploi du temps ». `facultatif` : un second clic sur la pastille choisie
 * la décoche, et la case reste vide sur la feuille.
 */
export function Choix({ libelle, options, valeur, onChanger, facultatif = false }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {libelle}
        {facultatif && <span className="font-normal text-muted-foreground"> — facultatif</span>}
      </Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const actif = option.valeur === valeur;
          return (
            <button
              key={option.valeur}
              type="button"
              aria-pressed={actif}
              onClick={() => onChanger(actif && facultatif ? null : option.valeur)}
              className={cn(
                'rounded-full border px-3.5 py-1 text-xs font-medium transition-colors',
                actif
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-input text-muted-foreground hover:border-primary/30 hover:text-primary'
              )}
            >
              {option.libelle}
            </button>
          );
        })}
      </div>
    </div>
  );
}
