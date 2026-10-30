import { ArrowDownToLine, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { estApplicationAndroid, estApplicationTauri, suiviMiseAJour, useMiseAJourDesktop } from '@/lib/miseAJourDesktop';

/**
 * ═══ LA MISE À JOUR DE L'APPLICATION DE BUREAU, À LA MANIÈRE DES GRANDES APPLICATIONS ═══
 * (2026-10-30, demande du porteur : « un modal au lancement, ou une icône en haut dans la
 * barre ».) Les deux : la FENÊTRE s'ouvre d'elle-même quand une version est trouvée ; l'ICÔNE
 * reste dans la barre du haut tant qu'elle n'est pas installée, et la rouvre.
 *
 * ⚠️ DANS L'APPLICATION SEULEMENT (précision du porteur) : dans un navigateur, le site est à
 *    jour à chaque déploiement — ni icône ni fenêtre, quoi qu'il arrive.
 * ⚠️ SUR ANDROID (2026-10-30), « Mettre à jour » ouvre la nouvelle APK dans le navigateur :
 *    Android n'installe pas seul une application hors Play Store, l'utilisateur confirme.
 */

/** L'icône de la barre du haut : invisible tant qu'aucune version n'attend. */
export function BoutonMiseAJour() {
  const etat = useMiseAJourDesktop();
  if (!estApplicationTauri() || etat.etat === 'aucune') return null;

  const enCours = etat.etat === 'telechargement' || etat.etat === 'redemarrage';
  const libelle = enCours ? 'Mise à jour en cours' : `Mise à jour ${etat.version} disponible`;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={suiviMiseAJour.ouvrir}
      title={libelle}
      aria-label={libelle}
      className="relative h-8 gap-1.5 px-2 text-xs font-medium text-primary hover:text-primary"
    >
      {enCours ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
      <span className="hidden sm:inline">{enCours ? 'Mise à jour…' : 'Mettre à jour'}</span>
      {!enCours && (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden="true" />
      )}
    </Button>
  );
}

/** La fenêtre : montée une fois, à la racine de l'application. */
export function FenetreMiseAJour() {
  const etat = useMiseAJourDesktop();
  if (!estApplicationTauri() || etat.etat === 'aucune') return null;

  const enCours = etat.etat === 'telechargement' || etat.etat === 'redemarrage';
  const android = estApplicationAndroid();

  return (
    <Dialog open={etat.fenetreOuverte} onOpenChange={(ouvert) => !ouvert && suiviMiseAJour.fermer()}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:max-w-md"
        // Pendant le téléchargement, on ne ferme pas par un clic à côté ni par Échap.
        onInteractOutside={(evenement) => enCours && evenement.preventDefault()}
        onEscapeKeyDown={(evenement) => enCours && evenement.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <RefreshCw className={enCours ? 'size-5 animate-spin' : 'size-5'} />
          </div>
          <DialogTitle>Nouvelle version d’EDT Pro</DialogTitle>
          <DialogDescription>
            {etat.versionActuelle ? (
              <>
                Version <strong>{etat.versionActuelle}</strong> → <strong>{etat.version}</strong>
              </>
            ) : (
              <>
                La version <strong>{etat.version}</strong> est disponible
              </>
            )}
            {etat.date && ` · publiée le ${new Date(etat.date).toLocaleDateString('fr-FR')}`}
          </DialogDescription>
        </DialogHeader>

        {etat.notes && (
          <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border bg-muted/40 p-3 text-sm">
            {etat.notes}
          </div>
        )}

        {enCours && (
          <div className="space-y-1.5">
            <Progress value={etat.progression ?? 0} />
            <p className="text-xs text-muted-foreground">
              {etat.etat === 'redemarrage'
                ? 'Installation terminée, redémarrage…'
                : etat.progression === null
                  ? 'Téléchargement…'
                  : `Téléchargement… ${etat.progression} %`}
            </p>
          </div>
        )}

        {etat.etat === 'erreur' && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            La mise à jour a échoué : {etat.erreur}. Vérifiez la connexion, puis réessayez.
          </p>
        )}

        {!enCours && (
          <p className="text-xs text-muted-foreground">
            {android
              ? 'La nouvelle version se télécharge dans votre navigateur : ouvrez le fichier pour l’installer. '
              : 'L’application redémarrera une fois la mise à jour installée. '}
            Vos données ne sont pas touchées : elles sont sur le serveur.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={suiviMiseAJour.fermer} disabled={enCours}>
            Plus tard
          </Button>
          <Button onClick={suiviMiseAJour.installer} disabled={enCours} className="gap-1.5">
            {enCours ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
            {etat.etat === 'erreur'
              ? 'Réessayer'
              : android
                ? 'Télécharger la nouvelle version'
                : 'Mettre à jour et redémarrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
