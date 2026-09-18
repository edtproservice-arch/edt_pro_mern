import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { CANEVAS_FORMATEURS, fusionnerFormateurs } from 'shared/domain';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Alerte from '@/components/common/Alerte';
import { analyserFormateurs } from '../api';

/**
 * Import Excel des formateurs, précédé du canevas.
 * ← la modale `#aff-canevas-overlay` de public/partials/affectation-carte.html
 *
 * Le canevas est montré AVANT le choix du fichier, et le choix du fichier vit
 * dans la même boîte : le directeur voit le format attendu au moment où il
 * sélectionne. C'était déjà l'organisation d'origine, et elle évite l'aller-
 * retour « fichier refusé → où était le format déjà ? ».
 */
export default function ImportFormateurs({ formateurs, groupes, onFusion }) {
  const [ouvert, setOuvert] = useState(false);
  const [fichier, setFichier] = useState(null);
  const [mode, setMode] = useState('completer');
  /** Arbitrage en attente : des absents du fichier portent encore des affectations. */
  const [arbitrage, setArbitrage] = useState(null);
  const champFichier = useRef(null);

  const analyse = useMutation({
    mutationFn: analyserFormateurs,
    onSuccess: (reponse) => {
      const lus = reponse.formateurs;
      const affectes = formateursAffectes(groupes);

      const conserver = fusionnerFormateurs(formateurs, lus, {
        remplacer: mode === 'remplacer',
        proteges: affectes,
      });

      // Des formateurs absents du fichier portent encore des affectations :
      // les retirer les effacerait. L'existant tranchait tout seul — dans un
      // sens (remplacement brut) puis dans l'autre. C'est au directeur de dire.
      if (conserver.conserves.length > 0) {
        setArbitrage({
          lus,
          conserver,
          retirer: fusionnerFormateurs(formateurs, lus, { remplacer: true, proteges: [] }),
          colonnes: reponse.colonnesReconnues,
        });
        return;
      }

      appliquer(conserver, lus.length, reponse.colonnesReconnues);
    },
    onError: (erreur) => toast.error('Fichier illisible', { description: erreur.message }),
  });

  /** Applique la fusion, referme la boîte, et résume dans un toast. */
  function appliquer(resultat, lues, colonnes) {
    onFusion(resultat.formateurs);

    toast.success(`${lues} formateur(s) lu(s)`, {
      description:
        `${resultat.ajoutes} ajouté(s), ${resultat.misAJour} mis à jour` +
        (resultat.retires.length > 0 ? `, ${resultat.retires.length} retiré(s)` : '') +
        '.',
    });

    // Ce que la boîte disait et que sa fermeture emporterait : reporté en
    // toast, sinon l'information serait perdue sans avoir été lue.
    if (resultat.conserves.length > 0) {
      toast.info(`${resultat.conserves.length} formateur(s) conservé(s)`, {
        description: `${resultat.conserves.slice(0, 4).join(', ')} — encore affecté(s).`,
      });
    }

    const manquantes = [
      !colonnes.matricule && 'matricule',
      !colonnes.masseHoraire && 'masse horaire',
    ].filter(Boolean);

    if (manquantes.length > 0) {
      toast.info(`Colonne(s) non trouvée(s) : ${manquantes.join(', ')}`, {
        description: 'Ces valeurs sont restées vides. Vous pouvez les saisir à la main.',
      });
    }

    fermer(false);
  }

  function fermer(etat) {
    setOuvert(etat);
    if (!etat) {
      setFichier(null);
      setArbitrage(null);
      analyse.reset();
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOuvert(true)}>
        <FileSpreadsheet className="h-4 w-4 text-success" />
        Importer depuis Excel
      </Button>

      <Dialog open={ouvert} onOpenChange={fermer}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Canevas d&apos;import des formateurs</DialogTitle>
            <DialogDescription>
              Voici exactement le format attendu. La masse horaire doit être la masse{' '}
              <strong className="text-foreground">statutaire annuelle</strong>, pas le total des
              heures affectées.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-transparent">
                  {CANEVAS_FORMATEURS.colonnes.map((colonne) => (
                    <TableHead key={colonne}>{colonne}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {CANEVAS_FORMATEURS.exemples.map((ligne) => (
                  <TableRow key={ligne[0]}>
                    {ligne.map((cellule) => (
                      <TableCell key={cellule} className="text-muted-foreground">
                        {cellule}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Les colonnes sont reconnues par leur intitulé, pas par leur position : un fichier dont
            l&apos;ordre diffère reste lisible. Seul « Nom &amp; Prénom » est indispensable.
          </p>

          <div className="space-y-2">
            <Label>Fichier Excel</Label>
            <button
              type="button"
              onClick={() => champFichier.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors hover:bg-muted"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                {fichier ? fichier.name : 'Cliquez pour choisir un fichier'}
              </span>
              {!fichier && <span className="text-xs text-muted-foreground">.xlsx ou .xls</span>}
            </button>
            <input
              ref={champFichier}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(evenement) => {
                setFichier(evenement.target.files?.[0] ?? null);
                setArbitrage(null);
                analyse.reset();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Que faire de la liste actuelle ?</Label>
            <RadioGroup value={mode} onValueChange={setMode} className="gap-2">
              <ChoixMode
                valeur="completer"
                titre="Compléter la liste"
                description="Ajoute et met à jour. Ne supprime jamais personne."
              />
              <ChoixMode
                valeur="remplacer"
                titre="Remplacer la liste"
                description="Retire les formateurs absents du fichier. Si certains portent encore une affectation, vous serez consulté avant."
              />
            </RadioGroup>
          </div>

          {analyse.isError && (
            <Alerte type="erreur" titre="Fichier illisible">
              {analyse.error.message}
            </Alerte>
          )}

          {arbitrage && (
            <Alerte
              type="info"
              titre={`${arbitrage.conserver.conserves.length} formateur(s) absent(s) du fichier portent encore des affectations`}
            >
              {arbitrage.conserver.conserves.slice(0, 6).join(', ')}
              {arbitrage.conserver.conserves.length > 6 && '…'} — les retirer libérerait leurs
              modules, qui redeviendraient non affectés.
            </Alerte>
          )}

          <DialogFooter>
            {arbitrage ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    appliquer(arbitrage.retirer, arbitrage.lus.length, arbitrage.colonnes)
                  }
                >
                  Les retirer quand même
                </Button>
                <Button
                  onClick={() =>
                    appliquer(arbitrage.conserver, arbitrage.lus.length, arbitrage.colonnes)
                  }
                >
                  Les conserver
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => fermer(false)}>
                  Annuler
                </Button>
                <Button
                  disabled={!fichier || analyse.isPending}
                  onClick={() => analyse.mutate(fichier)}
                >
                  {analyse.isPending ? 'Lecture…' : 'Importer'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoixMode({ valeur, titre, description }) {
  return (
    <Label
      htmlFor={`mode-${valeur}`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[:checked]:border-primary has-[:checked]:bg-primary/5"
    >
      <RadioGroupItem value={valeur} id={`mode-${valeur}`} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{titre}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}


/** Noms encore portés par au moins une affectation de la carte. */
function formateursAffectes(groupes) {
  const noms = new Set();

  for (const groupe of groupes) {
    for (const module of groupe.modules ?? []) {
      if (module.formateurPresentiel) noms.add(module.formateurPresentiel);
      if (module.formateurSynchrone) noms.add(module.formateurSynchrone);
    }
  }

  return [...noms];
}
