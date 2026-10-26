import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileCheck2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import BoutonFormat from '@/components/common/BoutonFormat';
import { FeuilleDocument } from '@/features/documents/CartesDocuments';
import ChoixSeance from './ChoixSeance';
import { Choix } from './DocumentPresenceCcEfm';
import { telechargerEnteteExamen } from './api';

const DOCUMENTS = {
  cc: { titre: 'En-tête de contrôle continu', resume: 'Première page du sujet', icone: FileText },
  efm: { titre: 'En-tête d’EFM', resume: 'Évaluation de fin de module', icone: FileCheck2 },
};

const NUMEROS = [1, 2, 3, 4, 5, 6].map((n) => ({ valeur: n, libelle: String(n) }));
const PORTEES = [
  { valeur: 'local', libelle: 'Locale' },
  { valeur: 'regional', libelle: 'Régionale' },
];
const EPREUVES = [
  { valeur: 'th', libelle: 'Théorique' },
  { valeur: 'tp', libelle: 'Pratique' },
  { valeur: 'sy', libelle: 'Synthèse' },
];
const DUREES = ['1H', '1H30', '2H', '2H30', '3H', '5H'].map((d) => ({ valeur: d, libelle: d }));
const BAREMES = [20, 40].map((b) => ({ valeur: b, libelle: `/ ${b}` }));

/**
 * ═══ L'EN-TÊTE D'UNE ÉPREUVE — CONTRÔLE CONTINU OU EFM (2026-10-26, demande du porteur) ═══
 * La première page du sujet, pour que le formateur n'ait plus qu'à écrire ses questions.
 * Comme la feuille de présence CC/EFM : il choisit UNE de ses séances — elle donne la filière,
 * le niveau, l'année, le module et son intitulé, la date —, puis coche le reste. « Nom et
 * prénom », « Groupe » et « V » restent vides : le stagiaire les remplit sur sa copie.
 * Une case laissée vide ici garde, sur la feuille, les options à entourer.
 */
export default function DocumentEnteteExamen({ type }) {
  const document = DOCUMENTS[type];
  const [ouvert, setOuvert] = useState(false);
  const [seance, setSeance] = useState(null);
  const [numero, setNumero] = useState(null);
  const [portee, setPortee] = useState(null);
  const [epreuve, setEpreuve] = useState(null);
  const [duree, setDuree] = useState(null);
  const [bareme, setBareme] = useState(40);

  // Ce qui est choisi — et rien de ce qui est resté vide.
  const options = () => ({
    type,
    ...(type === 'cc' && numero && { numero }),
    ...(type === 'efm' && portee && { portee }),
    ...(epreuve && { epreuve }),
    ...(duree && { duree }),
    ...(bareme && { bareme }),
  });

  const telechargement = useMutation({
    mutationFn: (format) => telechargerEnteteExamen({ format, seanceId: seance.id, ...options() }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });
  // Vierge : sans séance — les choix faits restent écrits, le reste à la main.
  const vierge = useMutation({
    mutationFn: (format) => telechargerEnteteExamen({ format, ...options() }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const fermer = () => {
    setOuvert(false);
    setSeance(null);
    setNumero(null);
    setPortee(null);
    setEpreuve(null);
    setDuree(null);
    setBareme(40);
  };

  const pret = Boolean(seance) && !telechargement.isPending;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={`Remplir : ${document.titre}`}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FeuilleDocument document={document} pied="Word · PDF" className="cursor-pointer hover:border-border-strong" />
      </button>

      <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && fermer()}>
        {/* Bornée à l'écran, comme la feuille CC/EFM — voir `DocumentPresenceCcEfm`. */}
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>{document.titre}</DialogTitle>
            <DialogDescription>
              Choisissez la séance : la filière, le niveau, l’année, le module et la date se remplissent d’eux-mêmes.
              Le nom, le groupe et la variante restent à remplir par le stagiaire.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4">
            <ChoixSeance seance={seance} onChoisir={setSeance} cleGuidage={`entete-${type}`} />

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {type === 'cc' ? (
                <Choix libelle="N° du contrôle" options={NUMEROS} valeur={numero} onChanger={setNumero} facultatif />
              ) : (
                <Choix libelle="Portée" options={PORTEES} valeur={portee} onChanger={setPortee} facultatif />
              )}
              <Choix libelle="Épreuve" options={EPREUVES} valeur={epreuve} onChanger={setEpreuve} facultatif />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Choix libelle="Durée" options={DUREES} valeur={duree} onChanger={setDuree} facultatif />
              <Choix libelle="Barème" options={BAREMES} valeur={bareme} onChanger={setBareme} />
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
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
