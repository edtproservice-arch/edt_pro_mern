import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { importerBaseEnote } from './api';
import DialogueGroupesRetires from './DialogueGroupesRetires';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * L'import d'une base e-note — LA définition unique du geste.
 *
 * ═══ ⚠️ POURQUOI UN CROCHET, ET PAS DEUX FORMULAIRES ═══
 * Deux écrans importent une base : l'assistant de configuration (« Paramètres →
 * Affectations ») et, depuis le 2026-09-01, le bouton posé sur la page
 * Avancement. La RÈGLE — une seule base par semaine, et un remplacement qui doit
 * être demandé explicitement — ne peut donc pas vivre dans l'un des deux : elle
 * divergerait au premier ajustement, et c'est la cause n°1 d'instabilité relevée
 * au §4.2. Elle vit ici ; les écrans ne fournissent que leur mise en page.
 */

/**
 * @param {(resultat: object) => void} [onImporte]  Appelé après un import réussi.
 * @param {(erreur: Error) => void} [onErreur]  Appelé sur un échec RÉEL — le
 *   refus hebdomadaire, lui, ouvre la confirmation et n'est pas une erreur.
 * @returns {{
 *   lancer: (fichier: File) => void,
 *   enCours: boolean,
 *   resultat: object|null,
 *   erreur: Error|null,
 *   conflit: object|null,
 *   confirmerRemplacement: () => void,
 *   annulerRemplacement: () => void,
 *   suppressions: object|null,
 *   confirmerSuppressions: () => void,
 *   annulerSuppressions: () => void,
 *   reinitialiser: () => void,
 * }}
 */
export function useImportEnote({ onImporte, onErreur } = {}) {
  /*
   * Le fichier en attente et la trace qu'il remplacerait. Tant que cet état est
   * posé, l'import n'a PAS eu lieu : c'est ce qui distingue « refusé, on
   * attend une réponse » de « échoué ».
   */
  const [conflit, setConflit] = useState(null);
  /*
   * Les groupes que le fichier fait disparaître alors qu'ils portent encore un
   * chronogramme, des séances… (2026-10-01). Même logique que `conflit` : posé,
   * l'import n'a PAS eu lieu, on attend une réponse.
   */
  const [suppressions, setSuppressions] = useState(null);

  const mutation = useMutation({
    mutationFn: ({ fichier, remplacer, confirmerSuppressions }) =>
      importerBaseEnote(fichier, remplacer, confirmerSuppressions),
    onSuccess: (resultat) => {
      setConflit(null);
      setSuppressions(null);
      onImporte?.(resultat);
    },
    onError: (erreur, variables) => {
      /*
       * ⚠️ LE 409 N'EST PAS UNE ERREUR À AFFICHER, c'est une QUESTION à poser.
       * Le rendre comme un échec laisserait le directeur devant un message qui
       * ne dit pas quoi faire, alors qu'un clic suffit — et il repartirait
       * chercher pourquoi son import « ne marche pas ».
       */
      if (erreur?.code === 'IMPORT_HEBDOMADAIRE') {
        setConflit({ fichier: variables.fichier, existant: erreur.details ?? {} });
        return;
      }
      /* Même principe : une question, pas une erreur. Le remplacement déjà
         accepté voyage avec, pour ne pas reposer la première question. */
      if (erreur?.code === 'GROUPES_ENCORE_UTILISES') {
        setConflit(null);
        setSuppressions({
          fichier: variables.fichier,
          remplacer: variables.remplacer,
          details: erreur.details ?? [],
        });
        return;
      }
      /* ⚠️ SIGNALÉE ICI, dans le gestionnaire, jamais dans le corps du rendu :
         un `toast` posé au rendu repart à chaque passage, et couperait la page
         d'un message qui se répète. */
      onErreur?.(erreur);
    },
  });

  return {
    lancer: (fichier) => {
      setConflit(null);
      setSuppressions(null);
      mutation.mutate({ fichier, remplacer: false });
    },
    enCours: mutation.isPending,
    resultat: mutation.isSuccess ? mutation.data : null,
    /* ⚠️ LE CONFLIT N'EST PAS UNE ERREUR : l'écran ne doit pas l'afficher en
       rouge SOUS la boîte qui pose déjà la question. */
    erreur:
      mutation.isError &&
      !['IMPORT_HEBDOMADAIRE', 'GROUPES_ENCORE_UTILISES'].includes(mutation.error?.code)
        ? mutation.error
        : null,
    conflit,
    confirmerRemplacement: () => {
      if (conflit) mutation.mutate({ fichier: conflit.fichier, remplacer: true });
    },
    annulerRemplacement: () => setConflit(null),
    suppressions,
    confirmerSuppressions: () => {
      if (suppressions) {
        mutation.mutate({
          fichier: suppressions.fichier,
          remplacer: suppressions.remplacer,
          confirmerSuppressions: true,
        });
      }
    },
    annulerSuppressions: () => setSuppressions(null),
    reinitialiser: () => {
      setConflit(null);
      setSuppressions(null);
      mutation.reset();
    },
  };
}

/**
 * La confirmation de remplacement, commune aux deux écrans.
 *
 * ⚠️ ELLE NOMME CE QUI VA DISPARAÎTRE — fichier et date du dépôt en place.
 * « Une base existe déjà, la remplacer ? » ne permet pas de savoir si l'on
 * s'apprête à écraser le bon fichier ou celui d'hier.
 */
export function DialogueRemplacementEnote({ conflit, enCours, onConfirmer, onAnnuler }) {
  const existant = conflit?.existant ?? {};

  return (
    <AlertDialog open={Boolean(conflit)} onOpenChange={(ouvert) => !ouvert && onAnnuler()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Une base a déjà été importée cette semaine</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Une seule base e-note est admise par semaine
                {existant.semaine ? ` (semaine S${existant.semaine})` : ''}.
              </p>
              {existant.nomFichier && (
                <p>
                  En place :{' '}
                  <span className="font-medium text-foreground">{existant.nomFichier}</span>
                  {existant.importeLe && (
                    <>
                      , déposé le{' '}
                      {new Date(existant.importeLe).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </>
                  )}
                  .
                </p>
              )}
              <p>
                Le remplacer par{' '}
                <span className="font-medium text-foreground">{conflit?.fichier?.name}</span> ?
                L’ancien dépôt disparaîtra de la chronologie.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={enCours}>Annuler</AlertDialogCancel>
          {/*
            ⚠️ ROUGE : le remplacement DÉTRUIT le dépôt précédent de la semaine.
            Un bouton neutre le ferait passer pour un simple « continuer ».
          */}
          <AlertDialogAction
            disabled={enCours}
            onClick={(evenement) => {
              /* La boîte ne se referme qu'au succès : la refermer tout de suite
                 laisserait croire l'import fait avant même qu'il ne parte. */
              evenement.preventDefault();
              onConfirmer();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {enCours ? 'Remplacement…' : 'Remplacer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * La confirmation des groupes retirés par un import (2026-10-01) — la même
 * boîte que l'enregistrement de la carte, avec la phrase propre à l'import.
 */
export function DialogueSuppressionsEnote({ importation }) {
  return (
    <DialogueGroupesRetires
      details={importation.suppressions?.details ?? null}
      explication={`Ces groupes ne figurent pas dans « ${
        importation.suppressions?.fichier?.name ?? 'le fichier'
      } », mais ils portent encore des données. Importer les supprimera définitivement.`}
      libelleConfirmation="Supprimer et importer"
      onConfirmer={importation.confirmerSuppressions}
      onAnnuler={importation.annulerSuppressions}
    />
  );
}
