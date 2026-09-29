import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import EtapeEspaces from '@/features/configuration/etapes/EtapeEspaces';
import { enregistrerEspaces } from '@/features/configuration/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { proprietesEnregistrement } from '@/lib/useBrouillonVersionne';
import CadreReglage from './CadreReglage';
import { useEspacesMutualises } from './EspacesMutualises';
import { useListeEtablissement } from './useListeEtablissement';

/**
 * Réglage des espaces (salles).
 * ← api/profile/save_espaces.php + le panneau « espaces » de profile.html
 *
 * Réutilise `EtapeEspaces`, l'écran de l'assistant : une salle se saisit de la
 * même façon qu'on soit en configuration initiale ou en cours d'année. En
 * écrire un second créerait deux comportements à tenir cohérents.
 *
 * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ Un invité « peut modifier » y
 * écrit, « peut consulter » la lit. La liste part avec sa version : si un
 * collègue l'a enregistrée entre-temps, le serveur refuse et la page recharge
 * — voir `useBrouillonVersionne`.
 */
export default function PageEspaces() {
  const { lectureSeule } = useDroitPage('espaces');
  const liste = useListeEtablissement('espaces', enregistrerEspaces, {
    onSucces: (resultat) =>
      toast.success('Espaces enregistrés', { description: `${resultat.valeur.length} espace(s).` }),
  });

  // Les boutons vont sur la ligne « Vos espaces », l'explication et les fenêtres en dessous.
  const mutualisation = useEspacesMutualises({ lectureSeule });

  /*
   * ⚠️ « TEAMS » POSÉ D'OFFICE SUR UNE LISTE VIDE (2026-09-19, demande du porteur), UNE SEULE
   * FOIS, au chargement : l'établissement neuf a sa classe à distance sans la saisir. Une
   * liste qui se vide ENSUITE — quelqu'un retire tout — n'est pas retouchée : la garde
   * ne joue qu'à l'arrivée de la donnée.
   */
  const teamsPose = useRef(false);
  useEffect(() => {
    if (teamsPose.current || !liste.charge || lectureSeule) return;
    teamsPose.current = true;
    if ((liste.brouillon ?? []).length === 0) liste.setBrouillon(['TEAMS']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste.charge, lectureSeule]);

  return (
    <>
      <EnTetePartage page="espaces" clesARelire={[['etablissement-courant']]} />
      <CadreReglage
        titre="Espaces"
        chargement={liste.contexte.isLoading || !liste.charge}
        erreur={liste.contexte.isError ? liste.contexte.error.message : null}
        {...proprietesEnregistrement(liste, lectureSeule)}
      >
        <div className="space-y-8">
          <EtapeEspaces
            valeur={liste.brouillon ?? []}
            onChange={liste.setBrouillon}
            lectureSeule={lectureSeule}
            actionsListe={mutualisation.boutons}
            mutualises={mutualisation.liste}
          />

          {/* Partager un espace avec un autre établissement (2026-09-21). */}
          {mutualisation.section}
        </div>
      </CadreReglage>
    </>
  );
}
