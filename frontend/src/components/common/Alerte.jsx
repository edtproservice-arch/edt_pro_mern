import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/**
 * Message d'alerte — composition mince au-dessus du `Alert` de shadcn.
 *
 * Elle n'ajoute rien au composant : elle fixe seulement la correspondance
 * type → icône → variante, en un seul endroit. Sans cela, chacune des sept
 * pages choisirait son icône, et elles finiraient par diverger — c'est
 * exactement ce qui est arrivé aux messages d'erreur du site PHP
 * (`.feedback-error`, `.input-error-message`, `<span>` rouge inline…).
 *
 * L'icône est un enfant DIRECT du `Alert` : c'est ce que son CSS attend
 * (`[&>svg]:absolute [&>svg]:left-4`) pour la positionner et décaler le texte.
 */
const TYPES = {
  /*
   * Fond bleu TRÈS clair : une consigne n'est ni un succès ni un problème, mais
   * elle doit se détacher du corps de la page. 5 % d'opacité suffisent — le
   * design system proscrit les aplats saturés, et le bleu structurel reste
   * réservé aux actions.
   */
  info: {
    Icone: Info,
    variant: 'default',
    couleurIcone: 'text-primary',
    /*
     * Texte bleu aussi : le fond seul laissait un gris qui ne se distinguait pas
     * du corps de la page, et l'encart perdait sa raison d'être.
     *
     * ⚠️ `[&>svg]:text-primary` est indispensable : le composant `Alert` de
     * shadcn impose `[&>svg]:text-foreground` dans ses classes de base, une
     * règle de même spécificité qui l'emportait sur la couleur passée à l'icône
     * — elle ressortait noire au milieu d'un encart entièrement bleu.
     */
    classe: 'border-primary/20 bg-primary/5 text-primary [&>svg]:text-primary',
  },
  succes: { Icone: CircleCheck, variant: 'default', couleurIcone: 'text-success' },
  /*
   * Ce qui demande attention SANS être une erreur : une action irréversible à
   * venir, une donnée sur le point d'être remplacée. Le rouge de `erreur`
   * signale un problème et banalise l'alerte quand tout va bien.
   */
  avertissement: { Icone: TriangleAlert, variant: 'default', couleurIcone: 'text-warning' },
  // La variante `destructive` colore déjà son icône, inutile de la surcharger.
  erreur: { Icone: CircleAlert, variant: 'destructive', couleurIcone: null },
};

/**
 * ⚠️ ALIGNEMENT DE L'ICÔNE SANS TITRE.
 *
 * shadcn positionne l'icône en ABSOLU (`left-4 top-4`) et décale ses voisins
 * d'un `pl-7`. Ce réglage est calé sur une alerte AVEC titre : l'icône tombe
 * alors sur la ligne du titre. Sans titre, la description commence à la simple
 * marge haute et l'icône se retrouve 5,5 px trop bas — mesuré.
 *
 * On repasse donc en flux normal, avec un `flex items-center` qui centre les
 * deux enfants l'un sur l'autre. Corriger le `top` d'un nombre de pixels aurait
 * marché aussi, mais se serait décalé au premier changement de taille de police
 * ou d'interligne ; ici l'alignement se recalcule tout seul.
 */
const SANS_TITRE =
  'flex items-center gap-3 [&>svg]:static [&>svg]:left-auto [&>svg]:top-auto ' +
  '[&>svg~*]:pl-0 [&>svg+div]:translate-y-0';

export default function Alerte({ type = 'info', titre, children, className }) {
  const { Icone, variant, couleurIcone, classe } = TYPES[type] ?? TYPES.info;

  return (
    <Alert variant={variant} className={cn(classe, !titre && SANS_TITRE, className)}>
      <Icone className={cn('h-4 w-4 shrink-0', couleurIcone)} />
      {titre && <AlertTitle>{titre}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
