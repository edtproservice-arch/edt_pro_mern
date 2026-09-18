import { Toaster as Sonner } from 'sonner';

/**
 * Notifications éphémères.
 *
 * ⚠️ Deux écarts avec le composant généré par la CLI shadcn :
 *
 *  1. `next-themes` retiré. C'est une dépendance pensée pour Next.js, et sans
 *     fournisseur monté `useTheme()` rend un objet vide — le thème passé à
 *     Sonner valait « system », qui pouvait afficher un toast sombre sur une
 *     application dont le fond est blanc par décision (cf. DESIGN_SYSTEM.md).
 *     L'application est en thème clair : on le dit explicitement.
 *
 *  2. `closeButton` stylé. Par défaut Sonner le pose en cercle sombre à cheval
 *     sur l'angle du toast, sans rapport avec la palette.
 */
function Toaster(props) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground ' +
            'group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
          title: 'group-[.toast]:text-sm group-[.toast]:font-medium',
          description: 'group-[.toast]:text-sm group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          closeButton:
            'group-[.toast]:bg-card group-[.toast]:text-muted-foreground ' +
            'group-[.toast]:border-border hover:group-[.toast]:text-foreground',
          success: 'group-[.toaster]:[&_[data-icon]]:text-success',
          error: 'group-[.toaster]:[&_[data-icon]]:text-destructive',
          info: 'group-[.toaster]:[&_[data-icon]]:text-primary',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
