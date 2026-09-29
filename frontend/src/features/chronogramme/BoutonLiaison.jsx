import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { cn } from '@/lib/utils';

import { chargerLiaison, definirLiaison, reporterVersChronogramme } from './api';

/**
 * Associer ou dissocier l'emploi du temps et le chronogramme.
 * ← le commutateur de `emploi.html` + `set_liaison_chronogramme.php`
 *
 * ═══ CE QUE LE CHOIX CHANGE ═══
 * **LIÉ** (défaut) : le chronogramme fixe les volumes ; la saisie manuelle qui
 * les modifierait sera refusée, et la génération automatique produit la grille
 * à partir de lui.
 * **DISSOCIÉ** : l'emploi du temps est tenu à la main, librement.
 *
 * ═══ ⚠️ « LIÉ » N'EST PAS « VERROUILLÉ » ═══
 * Le verrou ne mord que si le chronogramme est AUSSI planifié. Un
 * établissement qui n'a rien planifié est « lié » et pourtant libre — l'afficher
 * comme verrouillé ferait chercher une contrainte qui n'existe pas. Le serveur
 * rend `verrouActif` tout calculé : l'écran ne le recalcule jamais, sinon les
 * deux finiraient par ne plus dire la même chose.
 *
 * ═══ ⚠️ LE VERROU LUI-MÊME N'EXISTE PAS ENCORE ═══ (2026-09-27)
 * Ce réglage est livré AVANT la livraison (c) qui l'applique : il est stocké et
 * lu, mais **ne refuse rien pour l'instant**. Le dire vaut mieux que de laisser
 * croire à une protection absente.
 */
export default function BoutonLiaison({ lectureSeule = false, className }) {
  const [ouvert, setOuvert] = useState(false);
  /*
   * ⚠️ CE QUE LA RÉ-ASSOCIATION VA REPORTER, COMPTÉ AVANT DE DEMANDER.
   *    « Des séances vont être reportées » ferait confirmer à l'aveugle ; le
   *    chiffre est ce sur quoi le directeur décide réellement.
   */
  const [apercu, setApercu] = useState(null);
  const clientRequetes = useQueryClient();

  const etat = useQuery({ queryKey: ['chronogramme-liaison'], queryFn: chargerLiaison });

  /* Compté à l'ouverture de la fenêtre, jamais avant : inutile tant qu'on
     ne réassocie pas. */
  const preparer = async () => {
    setApercu(null);
    setOuvert(true);
    if (etat.data?.liee) return;
    try {
      setApercu(await reporterVersChronogramme(true));
    } catch {
      /* ⚠️ UN APERÇU INDISPONIBLE N'EMPÊCHE PAS DE DÉCIDER : la fenêtre
         s'ouvre sans chiffre plutôt que de refuser le geste. */
      setApercu(null);
    }
  };

  const basculer = useMutation({
    /*
     * ═══ ⚠️ RÉASSOCIER REPORTE D'ABORD ═══
     * Sans cela, réassocier laisserait deux vérités côte à côte : des séances
     * placées dans la grille que le chronogramme ignore. Le rapport de
     * complétude accuserait un manque là où le cours a bien lieu, et les taux
     * d'avancement seraient faux.
     *
     * ⚠️ LE REPORT AVANT LA LIAISON, et pas l'inverse : lier d'abord ferait
     *    mordre le verrou, et le report — qui écrit dans le CHRONOGRAMME, pas
     *    dans la grille — se ferait sur un état déjà annoncé comme conforme.
     */
    mutationFn: async (liee) => {
      const rapport = liee ? await reporterVersChronogramme(false) : null;
      const reponse = await definirLiaison(liee);
      return { ...reponse, rapport };
    },
    onSuccess: (reponse) => {
      clientRequetes.setQueryData(['chronogramme-liaison'], reponse);
      /* Le rapport de complétude lit le même plan : son cache doit repartir. */
      clientRequetes.invalidateQueries({ queryKey: ['chronogramme-completude'] });
      if (!reponse.liee) {
        toast.success('Emploi du temps délié du chronogramme.');
        return;
      }

      const r = reponse.rapport;
      toast.success('Emploi du temps de nouveau lié au chronogramme.', {
        description:
          r && r.cellulesEcrites > 0
            ? `${r.cellulesEcrites} cellule(s) reportées depuis la grille` +
              ` (${r.heures} h)` +
              (r.groupesCrees.length > 0
                ? ` · ${r.groupesCrees.length} chronogramme(s) créé(s)`
                : '') +
              /*
               * ⚠️ LES CELLULES MIXTES SONT DITES. Un module qui a du
               *    présentiel ET du distanciel la même semaine ne tient pas
               *    dans une cellule : le volume total est gardé, le type
               *    dominant retenu — et il faut le savoir pour corriger.
               */
              (r.mixtes.length > 0
                ? ` · ⚠️ ${r.mixtes.length} cellule(s) mixtes, type dominant retenu`
                : '') +
              (r.depassements?.length > 0
                ? ` · ⚠️ ${r.depassements.length} non reportée(s) : masse horaire atteinte`
                : '')
            : r?.depassements?.length > 0
              ? `${r.depassements.length} cellule(s) non reportée(s) : masse horaire atteinte.`
              : 'Le chronogramme portait déjà tout ce que la grille contient.',
      });
    },
    onError: (erreur) => toast.error(erreur?.message ?? 'Enregistrement impossible.'),
  });

  /*
   * ⚠️ RIEN TANT QU'ON NE SAIT PAS. Afficher « lié » pendant le chargement
   *    ferait clignoter l'état, et un directeur pourrait cliquer sur un bouton
   *    dont l'étiquette est encore fausse.
   */
  if (etat.isLoading || !etat.data) return null;

  const { liee, planifie, groupes, cellules, verrouActif } = etat.data;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={lectureSeule || basculer.isPending}
        onClick={preparer}
        title={
          verrouActif
            ? 'Le chronogramme fixe les volumes : la saisie qui les modifie est encadrée.'
            : 'La grille est libre — aucun chronogramme planifié, ou liaison coupée.'
        }
        className={cn('gap-2', className)}
      >
        {basculer.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : liee ? (
          <Link2 className="h-4 w-4 text-primary" />
        ) : (
          <Link2Off className="h-4 w-4 text-warning" />
        )}
        {liee ? 'Liée' : 'Déliée'}
      </Button>

      <ConfirmationAction
        ouvert={ouvert}
        onOpenChange={setOuvert}
        titre={liee ? 'Délier du chronogramme ?' : 'Lier au chronogramme ?'}
        libelleConfirmation={liee ? 'Délier' : 'Lier'}
        onConfirmer={() => basculer.mutate(!liee)}
        /*
         * ⚠️ DES `span` EN BLOC, PAS DES `p` : `AlertDialogDescription` rend
         *    déjà un `<p>`, et un paragraphe imbriqué est du HTML invalide que
         *    le navigateur défait tout seul — la mise en page saute alors sans
         *    que rien ne le signale.
         */
        description={
          liee ? (
            <>
              <span className="block">
                L’emploi du temps cessera de dépendre du chronogramme : vous pourrez ajouter,
                retirer ou changer des séances librement.
              </span>
              <span className="mt-2 block">
                {planifie
                  ? `Le chronogramme reste enregistré — ${groupes} groupe(s), ${cellules} cellule(s).
                     Il n’est pas effacé, il cesse seulement de faire loi.`
                  : 'Aucun groupe n’est planifié aujourd’hui : ce réglage ne change rien pour l’instant.'}
              </span>
            </>
          ) : (
            <>
              <span className="block">
                Le chronogramme redeviendra la référence : il fixera le volume d’heures de
                chaque module, semaine par semaine.
              </span>
              {apercu && (
                <span className="mt-2 block">
                  {apercu.cellulesEcrites > 0 ? (
                    <>
                      <strong>{apercu.cellulesEcrites} cellule(s)</strong> seront d’abord
                      reportées depuis la grille ({apercu.heures} h)
                      {apercu.groupesCrees.length > 0 &&
                        ` — dont ${apercu.groupesCrees.length} chronogramme(s) à créer`}
                      .
                    </>
                  ) : (
                    'Le chronogramme porte déjà tout ce que la grille contient : rien ne sera reporté.'
                  )}
                </span>
              )}
              {/*
                ⚠️ LA MASSE HORAIRE N'EST JAMAIS DÉPASSÉE (2026-09-27) : ces
                cellules ne seront PAS reportées. Leurs séances ressortiront en
                écart dans la fenêtre Conformité de leur semaine, d'où elles se
                suppriment. Les annoncer ICI, avant de confirmer, évite de les
                découvrir en consultant le rapport.
              */}
              {apercu?.depassements?.length > 0 && (
                <span className="mt-2 block text-warning">
                  <strong>{apercu.depassements.length} cellule(s) ne seront pas reportées</strong>{' '}
                  — elles dépasseraient la masse horaire du module :
                  {apercu.depassements.slice(0, 5).map((d) => (
                    <span key={`${d.groupe}|${d.module}|${d.semaine}`} className="block">
                      {d.groupe} · {d.module} · {d.semaine} : {d.heures} h posées, {d.dejaPlanifie} h
                      déjà planifiées pour {d.masse} h
                    </span>
                  ))}
                  {apercu.depassements.length > 5 && (
                    <span className="block">… et {apercu.depassements.length - 5} autre(s).</span>
                  )}
                  <span className="block text-muted-foreground">
                    Leurs séances apparaîtront dans la fenêtre Conformité de la semaine, à supprimer.
                  </span>
                </span>
              )}
              {/*
                ⚠️ CE QUE LA RÉ-ASSOCIATION NE FAIT PAS ENCORE. Dans l'ancien,
                elle reporte d'abord dans le chronogramme les séances posées à
                la main pendant la dissociation — c'est la livraison (d). Sans
                elle, deux vérités coexistent : des séances placées que le
                chronogramme ignore, donc un rapport qui accuse un manque là où
                le cours a bien lieu. Le taire serait pire que de le dire.
              */}
              {/*
                ⚠️ CE QUE LE REPORT NE FAIT PAS. Il n'efface RIEN : une semaine
                que la grille ne couvre pas garde sa prévision, et un module
                prévu mais pas posé aussi. C'est le rapport de complétude qui
                montre l'écart — ce n'est pas au report de trancher.
              */}
              <span className="mt-2 block text-muted-foreground">
                Rien n’est effacé : les semaines que la grille ne couvre pas gardent leur
                prévision.
              </span>
            </>
          )
        }
      />
    </>
  );
}
