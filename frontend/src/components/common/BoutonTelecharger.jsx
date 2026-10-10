import { ChevronDown, Download, File, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * ═══ LE BOUTON « TÉLÉCHARGER » DE TOUTE L'APPLICATION ═══ (2026-10-10, demande
 * du porteur : « la même logique pour tous les boutons Télécharger — lorsqu'un
 * fichier tarde, un loader s'affiche dans le bouton, comme en Stages et
 * Formations ».)
 *
 * Un bouton, un menu Word / PDF / Excel (les formats que l'écran propose), et
 * PENDANT la préparation du fichier :
 *   - l'icône devient un indicateur qui tourne ;
 *   - le bouton se désactive — un second clic relancerait la même conversion,
 *     et LibreOffice met parfois vingt secondes à rendre un PDF.
 *
 * ⚠️ UN SEUL FORMAT = PAS DE MENU : le bouton télécharge directement. Un menu
 * d'une seule entrée n'est qu'un clic de plus.
 *
 * @param {(format: 'docx'|'pdf'|'xlsx') => void} onChoisir
 * @param {boolean} enCours — `mutation.isPending`, en général.
 * @param {string[]} [formats]
 * @param {'sm'|'xs'} [taille] — `xs` pour les barres de filtre serrées (h-7).
 * @param {import('react').ElementType} [icone] — l'icône au repos (Download par défaut).
 */
export const FORMATS_TELECHARGEMENT = {
  docx: { libelle: 'Télécharger en Word', icone: FileText, teinte: 'text-blue-600' },
  pdf: { libelle: 'Télécharger en PDF', icone: File, teinte: 'text-red-600' },
  xlsx: { libelle: 'Télécharger en Excel', icone: FileSpreadsheet, teinte: 'text-green-600' },
};

export default function BoutonTelecharger({
  onChoisir,
  enCours = false,
  formats = ['docx', 'pdf', 'xlsx'],
  libelle = 'Télécharger',
  icone: Icone = Download,
  taille = 'sm',
  disabled = false,
  variant = 'outline',
  align = 'end',
  className,
  title,
  'aria-label': ariaLabel,
}) {
  const classes = cn(taille === 'xs' ? 'h-7' : 'h-8', 'gap-1.5 text-xs', className);
  const icone = enCours ? <Loader2 className="size-3.5 animate-spin" /> : <Icone className="size-3.5" />;
  const inactif = disabled || enCours;

  if (formats.length === 1) {
    return (
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={classes}
        disabled={inactif}
        aria-busy={enCours || undefined}
        title={title}
        aria-label={ariaLabel}
        onClick={() => onChoisir(formats[0])}
      >
        {icone}
        {libelle}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          className={classes}
          disabled={inactif}
          aria-busy={enCours || undefined}
          title={title}
          aria-label={ariaLabel}
        >
          {icone}
          {libelle}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {formats.map((format) => {
          const { libelle: entree, icone: IconeFormat, teinte } = FORMATS_TELECHARGEMENT[format];
          return (
            <DropdownMenuItem key={format} onSelect={() => onChoisir(format)}>
              <IconeFormat className={cn('size-3.5', teinte)} />
              {entree}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
