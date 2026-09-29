import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { chargerAppel } from './api';
import ListeAppel from './ListeAppel';

/**
 * La liste d'appel d'UN cours, chargée depuis le serveur.
 * `cours` = `{ seance, periode, groupe }` — le libellé de groupe de la SÉANCE, tel
 * qu'écrit (« GM101 GM102 » pour une fusion).
 */
export function ChargementAppel({ date, cours, dansPanneau = false, onAvertissementFermeture, piedAppel }) {
  const appel = useQuery({
    queryKey: ['absences-stagiaires', 'appel', date, `${cours.seance}|${cours.periode}|${cours.groupe}`],
    queryFn: () => chargerAppel({ date, seance: cours.seance, periode: cours.periode, groupe: cours.groupe }),
    retry: false,
  });

  if (appel.isLoading) return <p className="text-sm text-muted-foreground">Chargement de la liste…</p>;
  if (appel.error) return <Alerte type="erreur" titre="Liste indisponible">{appel.error.message}</Alerte>;
  return (
    <ListeAppel
      appel={appel.data}
      dansPanneau={dansPanneau}
      onAvertissementFermeture={onAvertissementFermeture}
      piedAppel={piedAppel}
    />
  );
}

/**
 * ═══ LE PANNEAU D'APPEL, À DROITE ═══ — le même pour l'agenda du formateur et
 * pour la grille de l'encadrement (2026-09-14). Écrit une fois : deux panneaux
 * auraient fini par ne plus dire la même chose du même cours.
 *
 * Dépliée dans une carte, la liste allongeait la page de trente lignes ; le
 * panneau prend toute la hauteur, et ce qu'on regardait reste visible derrière.
 *
 * @param {{date: string, cours: {seance, periode, groupe}, sousTitre: string}|null} choix
 */
export default function PanneauAppel({ choix, onFermer }) {
  /*
   * ⚠️ UNE RÉFÉRENCE, PAS UN ÉTAT : mise à jour à chaque changement de marque
   * dans `ListeAppel`, elle n'a pas à faire re-rendre CE composant — seul le
   * clic sur la fermeture la consulte.
   */
  const avertirRef = useRef(false);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  /*
   * ⚠️ LE PIED DU PANNEAU, HORS DE LA ZONE QUI DÉFILE (2026-09-28, revient sur
   * `position: sticky` : « ne laisse pas le texte apparaître ou défiler en
   * dessous de la barre de validation »). Un `useState`, pas un simple
   * `useRef` : `BarreValidation` doit RE-RENDRE dès que ce nœud existe pour y
   * poser son portail — un ref seul ne déclenche aucun rendu à son attachement.
   */
  const [pied, setPied] = useState(null);

  // Un autre cours s'ouvre : l'avertissement d'un précédent ne doit pas le suivre.
  useEffect(() => {
    avertirRef.current = false;
  }, [choix]);

  const demanderFermeture = () => {
    if (avertirRef.current) {
      setConfirmationOuverte(true);
      return;
    }
    onFermer();
  };

  return (
    <>
      <Sheet open={Boolean(choix)} onOpenChange={(ouvert) => !ouvert && demanderFermeture()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b p-4 pr-10 text-left">
            <SheetTitle>Appel Absence · {choix?.cours.seance}</SheetTitle>
            <SheetDescription>{choix?.sousTitre}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {choix && (
              <ChargementAppel
                dansPanneau
                date={choix.date}
                cours={choix.cours}
                onAvertissementFermeture={(actif) => {
                  avertirRef.current = actif;
                }}
                piedAppel={pied}
              />
            )}
          </div>

          {/*
            ⚠️ CE `div`, PAS LA ZONE QUI DÉFILE CI-DESSUS, REÇOIT LE BOUTON
            « Valider l'appel » — via `createPortal`, depuis `BarreValidation`.
            Étant un frère de la zone qui défile (`shrink-0`, hors de
            `overflow-y-auto`), aucune ligne de la liste ne peut jamais se
            retrouver dessous ou au travers, quelle que soit la hauteur du
            panneau ou de la liste.
          */}
          <div ref={setPied} className="shrink-0" />
        </SheetContent>
      </Sheet>

      {/*
        ⚠️ L'AVERTISSEMENT DE FERMETURE (2026-09-28, demande du porteur : « risque
        que le valideur ne voie pas le bouton en bas — donne une solution » puis
        « ajoute aussi l'avertissement de fermeture sans validation ») : la croix
        du panneau, l'Échap et le clic hors du panneau passent tous par ce même
        point (`onOpenChange`) — un seul endroit à garder au fait, jamais trois.
      */}
      <ConfirmationAction
        ouvert={confirmationOuverte}
        onOpenChange={setConfirmationOuverte}
        titre="Fermer sans valider cet appel ?"
        description="Vos changements ne sont pas encore enregistrés — fermer maintenant les efface. Cliquez « Valider l'appel » pour les garder."
        libelleConfirmation="Fermer sans valider"
        onConfirmer={() => {
          setConfirmationOuverte(false);
          onFermer();
        }}
      />
    </>
  );
}
