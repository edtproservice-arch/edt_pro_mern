import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import { exporterChronogramme, importerChronogramme } from './api';

/**
 * Export et import du classeur.
 * ← les boutons « Exporter » / « Importer » du chronogramme d'EDT Pro
 *
 * ═══ À QUOI SERT LE FICHIER ═══
 * Il n'est pas un document d'archive : il existe pour être RETOUCHÉ hors ligne
 * — dans le train, à plusieurs, sans accès à l'application — puis relu. C'est
 * pour cela que ses cellules portent une liste déroulante, que celles des
 * semaines fermées sont verrouillées, et que l'état de chaque semaine est écrit
 * au-dessus de sa colonne.
 *
 * ⚠️ L'IMPORT FUSIONNE, il ne remplace pas : seules les cellules que le fichier
 * NOMME bougent. C'est la seule règle sûre pour une feuille de formateur, qui ne
 * porte qu'une fraction des modules de chaque groupe.
 */
/**
 * @param {{ mode, sujets, peutImporter?: boolean }} props — l'import réécrit
 *   plusieurs groupes d'un coup : il reste au DIRECTEUR (étape d2), et le bouton
 *   n'est pas offert à un invité, que le serveur refuserait.
 */
export default function BarreClasseur({ mode, sujets, peutImporter = true }) {
  const cache = useQueryClient();
  const champFichier = useRef(null);
  const [bilan, setBilan] = useState(null);

  const exportation = useMutation({
    mutationFn: () => exporterChronogramme(mode, sujets),
    onSuccess: () =>
      toast.success(`${sujets.length} onglet(s) exporté(s)`, {
        description: 'Les cellules verrouillées sont celles que la grille refuserait.',
      }),
    onError: (erreur) => toast.error('Export impossible', { description: erreur.message }),
  });

  const importation = useMutation({
    mutationFn: importerChronogramme,
    onSuccess: (resultat) => {
      /*
       * ⚠️ LE BILAN RESTE DANS LA PAGE, il ne part pas en toast. Un import peut
       * refuser des lignes une à une : ces motifs se relisent, se recoupent avec
       * le fichier, et parfois se corrigent en plusieurs fois. Un message qui
       * disparaît au bout de cinq secondes ne le permet pas.
       */
      setBilan(resultat);

      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      cache.invalidateQueries({ queryKey: ['chronogramme'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });

      toast.success('Classeur relu', {
        description: `${resultat.ecrites} cellule(s) écrite(s), ${resultat.effacees} effacée(s).`,
      });
    },
    onError: (erreur) => {
      setBilan(null);
      toast.error('Import impossible', { description: erreur.message });
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={sujets.length === 0 || exportation.isPending}
          title={
            sujets.length === 0
              ? 'Choisissez d’abord ce que vous voulez exporter'
              : `Un onglet par ${mode} : ${sujets.join(', ')}`
          }
          onClick={() => exportation.mutate()}
        >
          {/* Le vert est la couleur d'Excel dans toute l'application. */}
          <Download className="size-3.5 text-success" />
          Exporter
          {sujets.length > 0 && <span className="text-muted-foreground">({sujets.length})</span>}
        </Button>

        {peutImporter && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={importation.isPending}
            onClick={() => champFichier.current?.click()}
          >
            <Upload className="size-3.5 text-success" />
            {importation.isPending ? 'Lecture…' : 'Importer'}
          </Button>
        )}

        {/*
          ⚠️ LA PHRASE D'EXPLICATION EST RETIRÉE (2026-08-25, demande du
          porteur). Elle occupait une ligne entière de la barre pour une règle
          qui ne se vérifie qu'APRÈS l'import — et le bilan de l'import, lui,
          reste dans la page et chiffre précisément ce qui a été écrit et ce qui
          a été refusé.
        */}

        <input
          ref={champFichier}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(evenement) => {
            const fichier = evenement.target.files?.[0];
            // Le champ est REMIS À ZÉRO : sans cela, réimporter le même fichier
            // après correction ne déclencherait aucun événement.
            evenement.target.value = '';
            if (fichier) importation.mutate(fichier);
          }}
        />
      </div>

      {bilan && <BilanImport bilan={bilan} onFermer={() => setBilan(null)} />}
    </div>
  );
}

/** Ce que l'import a fait, et ce qu'il a refusé. */
function BilanImport({ bilan, onFermer }) {
  const lues = bilan.rapport.filter((feuille) => feuille.etat === 'lue');
  const ignorees = bilan.rapport.filter((feuille) => feuille.etat === 'ignoree');
  const refus = lues.flatMap((feuille) => feuille.refus.map((motif) => `${feuille.sujet} — ${motif}`));

  return (
    <Alerte type={refus.length > 0 || ignorees.length > 0 ? 'avertissement' : 'succes'} titre="Import terminé">
      <div className="space-y-2">
        <p>
          {bilan.ecrites} cellule(s) écrite(s), {bilan.effacees} effacée(s) sur{' '}
          {bilan.groupes.length} groupe(s) : {bilan.groupes.join(', ')}.
        </p>

        {/*
          Les feuilles ÉCARTÉES et les lignes REFUSÉES sont nommées. Rejeter le
          classeur entier pour une cellule fautive obligerait à tout recommencer ;
          l'accepter en silence laisserait croire à un import complet.
        */}
        {ignorees.length > 0 && (
          <div>
            <p className="font-medium">Feuilles écartées</p>
            {ignorees.map((feuille) => (
              <p key={feuille.feuille} className="text-xs">
                {feuille.feuille} — {feuille.raison}
              </p>
            ))}
          </div>
        )}

        {refus.length > 0 && (
          <div>
            <p className="font-medium">{refus.length} ligne(s) non reprise(s)</p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
              {refus.map((motif) => (
                <li key={motif}>{motif}</li>
              ))}
            </ul>
          </div>
        )}

        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onFermer}>
          Masquer ce bilan
        </Button>
      </div>
    </Alerte>
  );
}
