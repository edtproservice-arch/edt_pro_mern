import { File, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** L'icône et la teinte de chaque format — bleu Word, rouge PDF, vert Excel, comme partout dans l'application. */
export const FORMATS_DOCUMENT = {
  docx: { libelle: 'Word', Icone: FileText, couleur: 'text-blue-600' },
  pdf: { libelle: 'PDF', Icone: File, couleur: 'text-red-600' },
  xlsx: { libelle: 'Excel', Icone: FileSpreadsheet, couleur: 'text-green-600' },
};

/**
 * Le bouton d'un format de document — « Word » à l'icône bleue, « PDF » à l'icône
 * rouge —, celui de la fenêtre des documents (`DialogueChoixGroupes`). Extrait le
 * 2026-10-26 (demande du porteur : « mets les boutons avec ce style ») pour que la
 * fiche de réclamation et sa carte de message ne le recopient pas.
 *
 * `enCours` remplace l'icône par un indicateur, sur LE bouton qui télécharge.
 */
export default function BoutonFormat({ format, libelle, enCours = false, className, ...proprietes }) {
  const { libelle: parDefaut, Icone, couleur } = FORMATS_DOCUMENT[format];
  return (
    <Button variant="outline" size="sm" className={cn('gap-1.5', className)} {...proprietes}>
      {enCours ? <Loader2 className="size-3.5 animate-spin" /> : <Icone className={cn('size-3.5', couleur)} />}
      {libelle ?? parDefaut}
    </Button>
  );
}
