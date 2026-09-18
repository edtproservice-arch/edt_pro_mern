import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useImportEnote, DialogueRemplacementEnote } from './importEnote';

/**
 * Importer une base e-note, depuis n'importe quel écran.
 * (Demande du porteur, 2026-09-01 : un bouton à côté de la phrase qui nomme le
 * fichier en cours, sur la page Avancement.)
 *
 * ═══ ⚠️ CE N'EST PAS UN SECOND FORMULAIRE D'IMPORT ═══
 * La règle — une base par semaine, remplacement explicite — vit dans
 * `useImportEnote`, partagé avec l'assistant de configuration. Ce composant
 * n'apporte QUE la mise en page compacte : un bouton et un champ de fichier
 * masqué. Deux implémentations du même geste divergeraient (§4.2), et c'est
 * précisément ce qui avait fait écarter un second point d'entrée dans le menu de
 * l'emploi du temps.
 *
 * ⚠️ ET C'EST POUR CELA QU'IL EST ICI, dans `features/configuration/`, à côté de
 * la règle qu'il emploie — et non dans `features/avancement/`, qui n'est que son
 * premier appelant.
 */
export default function BoutonImportEnote({ libelle = 'Importer une base e-note' }) {
  const champFichier = useRef(null);
  const cache = useQueryClient();

  const importation = useImportEnote({
    onImporte: (resultat) => {
      /*
       * ⚠️ TOUT EST INVALIDÉ, pas seulement l'avancement : un import réécrit la
       * base — formateurs, groupes, affectations — donc la carte, le
       * chronogramme et l'emploi du temps en dépendent. C'est la règle posée le
       * 2026-08-26 pour les écritures, appliquée ici.
       */
      cache.invalidateQueries();

      toast.success('Base e-note importée', {
        description: [
          `${resultat.effectifs.formateurs} formateur(s), ${resultat.effectifs.groupes} groupe(s), ${resultat.effectifs.affectations} affectation(s).`,
          /* Une suppression muette laisserait croire que les deux fichiers
             cohabitent dans la chronologie. */
          resultat.remplace ? `Remplace « ${resultat.remplace.nomFichier} ».` : null,
        ]
          .filter(Boolean)
          .join(' '),
      });
    },
    /* ⚠️ L'ÉCHEC PART EN TOAST : ce bouton vit au fil du texte, il n'a pas de
       bloc où poser une alerte sans repousser le reste de la page. */
    onErreur: (erreur) => toast.error('Import impossible', { description: erreur.message }),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={importation.enCours}
        onClick={() => champFichier.current?.click()}
      >
        {/* Le vert est la couleur du tableur dans toute l'application. */}
        <FileSpreadsheet className="size-3.5 text-success" />
        {importation.enCours ? 'Import en cours…' : libelle}
      </Button>

      <input
        ref={champFichier}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(evenement) => {
          const fichier = evenement.target.files?.[0];
          /* ⚠️ LE CHAMP EST VIDÉ : sans cela, rechoisir LE MÊME fichier après un
             refus ne déclenche aucun `change`, et le bouton paraît mort. */
          evenement.target.value = '';
          if (fichier) importation.lancer(fichier);
        }}
      />

      <DialogueRemplacementEnote
        conflit={importation.conflit}
        enCours={importation.enCours}
        onConfirmer={importation.confirmerRemplacement}
        onAnnuler={importation.annulerRemplacement}
      />
    </>
  );
}
