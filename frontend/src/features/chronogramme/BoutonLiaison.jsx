import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { cn } from '@/lib/utils';

import { libelleSemaine } from 'shared/domain';

import { chargerCompletude, chargerLiaison, definirLiaison, reporterVersChronogramme } from './api';

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
/**
 * Les semaines dont la grille ne couvre pas exactement le chronogramme.
 * ← `completudeDeLAnnee` : seules les semaines où quelque chose est prévu ou posé.
 */
function semainesIncompletes(completude) {
  return (completude?.semaines ?? []).filter((semaine) => semaine.taux !== null && semaine.taux < 100);
}

/** « S7 (82 %, manque 17,5 h), S9 (95 %, 2,5 h en trop)… » — les six premières. */
function resumer(semaines) {
  const parties = semaines.slice(0, 6).map((semaine) => {
    const ecarts = [
      semaine.manquant > 0 ? `manque ${semaine.manquant} h` : null,
      semaine.enTrop > 0 ? `${semaine.enTrop} h en trop` : null,
    ].filter(Boolean);
    return `${libelleSemaine(semaine.semaine, { court: true })} (${semaine.taux} %${ecarts.length ? `, ${ecarts.join(', ')}` : ''})`;
  });
  return parties.join(', ') + (semaines.length > 6 ? ` et ${semaines.length - 6} autre(s)` : '');
}

export default function BoutonLiaison({ lectureSeule = false, className }) {
  const [ouvert, setOuvert] = useState(false);
  /*
   * ⚠️ CE QUE LA RÉ-ASSOCIATION LAISSERA SOUS 100 %, COMPTÉ AVANT DE DEMANDER
   *    (2026-10-10) : les semaines dont la grille ne couvre pas exactement le
   *    chronogramme — c'est sur ce chiffre que le directeur décide.
   */
  const [apercu, setApercu] = useState(null);
  // Ce que la liaison importera dans les chronogrammes VIDES (2026-10-30).
  const [apercuImport, setApercuImport] = useState(null);
  const clientRequetes = useQueryClient();

  const etat = useQuery({ queryKey: ['chronogramme-liaison'], queryFn: chargerLiaison });

  /* Compté à l'ouverture de la fenêtre, jamais avant : inutile tant qu'on
     ne réassocie pas. */
  const preparer = async () => {
    setApercu(null);
    setApercuImport(null);
    setOuvert(true);
    if (etat.data?.liee) return;
    /* ⚠️ UN APERÇU INDISPONIBLE N'EMPÊCHE PAS DE DÉCIDER : la fenêtre
       s'ouvre sans chiffre plutôt que de refuser le geste. */
    const [completude, importation] = await Promise.allSettled([
      chargerCompletude(),
      reporterVersChronogramme(true, { seulementVides: true }),
    ]);
    setApercu(completude.status === 'fulfilled' ? semainesIncompletes(completude.value) : null);
    setApercuImport(importation.status === 'fulfilled' ? importation.value : null);
  };

  const basculer = useMutation({
    /*
     * ═══ ⚠️ RÉASSOCIER NE TOUCHE PLUS AU CHRONOGRAMME ═══ (2026-10-10, demande
     * du porteur : « ne touche pas à la masse horaire planifiée du chronogramme
     * en aucun cas ».) Le report grille → chronogramme qui précédait la
     * liaison RÉÉCRIVAIT la planification d'après la grille : une semaine
     * importée ou retouchée pendant la dissociation devenait la nouvelle
     * référence. Désormais le chronogramme reste tel qu'il a été planifié, et
     * c'est la GRILLE qui doit le rejoindre : les semaines sous 100 % sont
     * détectées et annoncées (`semainesIncompletes`), et leurs séances
     * manquantes se placent depuis la fenêtre Conformité de chaque semaine.
     *
     * ⚠️ SAUF UN CHRONOGRAMME TOTALEMENT VIDE (2026-10-30, demande du porteur) :
     *    il n'a rien de planifié à protéger, et reçoit à la liaison les heures
     *    déjà posées dans l'emploi (`definirLiaison` → `importe`).
     */
    mutationFn: async (liee) => {
      const reponse = await definirLiaison(liee);
      const incompletes = liee ? semainesIncompletes(await chargerCompletude()) : null;
      return { ...reponse, incompletes };
    },
    onSuccess: (reponse) => {
      clientRequetes.setQueryData(['chronogramme-liaison'], reponse);
      /* Le rapport de complétude lit le même plan : son cache doit repartir. */
      clientRequetes.invalidateQueries({ queryKey: ['chronogramme-completude'] });
      if (!reponse.liee) {
        toast.success('Emploi du temps délié du chronogramme.');
        return;
      }

      /*
       * ═══ L'EMPLOI IMPORTÉ DANS LES CHRONOGRAMMES VIDES (2026-10-30) ═══
       * Les grilles ouvertes doivent relire leur planning ; et le directeur doit
       * savoir ce qui vient d'être écrit — un import muet passerait pour une
       * planification faite à la main.
       */
      const importe = reponse.importe;
      if (importe?.groupes?.length > 0) {
        clientRequetes.invalidateQueries({ queryKey: ['chronogramme'] });
        clientRequetes.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
        clientRequetes.invalidateQueries({ queryKey: ['chronogrammes'] });
        toast.success(`Emploi importé dans ${importe.groupes.length} chronogramme(s) vide(s)`, {
          duration: 10_000,
          description:
            `${importe.heures} h reprises de l’emploi du temps : ${importe.groupes.join(', ')}.` +
            (importe.depassements?.length > 0
              ? ` ${importe.depassements.length} case(s) non reprises : elles dépasseraient la masse du module.`
              : ''),
        });
      }

      const incompletes = reponse.incompletes ?? [];
      if (incompletes.length === 0) {
        toast.success('Emploi du temps de nouveau lié au chronogramme.', {
          description: 'Toutes les semaines planifiées sont à 100 % du chronogramme.',
        });
        return;
      }
      /*
       * ⚠️ UN AVERTISSEMENT QUI RESTE, PAS UN TOAST QUI FILE : c'est la liste de
       *    travail du directeur — les semaines à compléter avant de pouvoir les
       *    publier (100 % exigés tant que l'emploi est lié).
       */
      toast.warning(`Emploi lié : ${incompletes.length} semaine(s) sous 100 % du chronogramme`, {
        duration: Infinity,
        closeButton: true,
        description: `${resumer(incompletes)}. Le chronogramme n’a pas été modifié : ouvrez le taux de chaque semaine (Conformité) pour placer les séances manquantes.`,
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
              <span className="mt-2 block">
                <strong>Un chronogramme déjà planifié ne sera pas modifié</strong> : sa
                planification reste la référence, et c’est l’emploi du temps qui doit la rejoindre.
              </span>
              {/* L'import dans les chronogrammes vides (2026-10-30). */}
              {apercuImport?.groupes?.length > 0 && (
                <span className="mt-2 block">
                  <strong>
                    {apercuImport.groupes.length} chronogramme(s) vide(s) recevront les heures déjà
                    posées dans l’emploi
                  </strong>{' '}
                  ({apercuImport.heures} h) : {apercuImport.groupes.slice(0, 8).join(', ')}
                  {apercuImport.groupes.length > 8 ? ` et ${apercuImport.groupes.length - 8} autre(s)` : ''}.
                  Ces semaines seront protégées : la génération automatique ne les effacera pas.
                </span>
              )}
              {apercu && (
                <span className="mt-2 block">
                  {apercu.length === 0 ? (
                    'Toutes les semaines planifiées sont déjà à 100 % : rien à compléter.'
                  ) : (
                    <>
                      <strong>{apercu.length} semaine(s) resteront sous 100 %</strong> :{' '}
                      {resumer(apercu)}. Leurs séances manquantes se placeront depuis la
                      fenêtre Conformité de chaque semaine ; d’ici là, elles ne pourront être
                      ni publiées ni éditées.
                    </>
                  )}
                </span>
              )}
              <span className="mt-2 block text-muted-foreground">
                Rien n’est effacé : ni dans la grille, ni dans un chronogramme déjà planifié.
              </span>
            </>
          )
        }
      />
    </>
  );
}
