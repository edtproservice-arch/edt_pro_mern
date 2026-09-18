import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import Alerte from '@/components/common/Alerte';
import { chargerBase, enregistrerStages } from '@/features/configuration/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { proprietesEnregistrement } from '@/lib/useBrouillonVersionne';
import { useAnneeActive } from '@/lib/anneeActive';
import CadreReglage from './CadreReglage';
import ListePeriodes from './ListePeriodes';
import { useListeEtablissement } from './useListeEtablissement';

/**
 * Périodes de stage, par groupe.
 * ← table `stages` + le panneau « stages » de profile.html
 *
 * Pendant un stage, le groupe est en entreprise : `estDisponible()` refuse d'y
 * placer une séance. C'est l'une des quatre causes d'indisponibilité gérées par
 * `shared/src/domain/planning/calendrier.js`.
 */
export default function PageStages() {
  /*
   * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ La liste part avec sa version :
   * si un collègue l'a enregistrée entre-temps, le serveur refuse et la page
   * recharge — voir `useBrouillonVersionne`. Un invité « peut consulter » la lit.
   */
  const { lectureSeule } = useDroitPage('stages');
  const liste = useListeEtablissement('stages', enregistrerStages, {
    onSucces: (resultat) =>
      toast.success('Stages enregistrés', { description: `${resultat.valeur.length} période(s).` }),
  });
  const { contexte, brouillon: stages, setBrouillon: setStages } = liste;

  const choisie = useAnneeActive();

  // Les groupes viennent de la base : un stage se déclare sur un groupe qui
  // existe, sous son nom exact.
  const base = useQuery({ queryKey: ['base'], queryFn: chargerBase, retry: false });


  const annee = choisie ?? contexte.data?.anneeScolaire ?? null;


  const initiaux = contexte.data?.etablissement?.stages ?? [];
  const modifie = stages !== null && JSON.stringify(stages) !== JSON.stringify(initiaux);

  const groupes = (base.data?.base?.groupes ?? []).map((nom) => ({ valeur: nom, libelle: nom }));

  return (
    <>
    <EnTetePartage page="stages" clesARelire={[['etablissement-courant'], ['base']]} />
    <CadreReglage
      titre="Stages"
      chargement={contexte.isLoading || !liste.charge}
      erreur={contexte.isError ? contexte.error.message : null}
      {...proprietesEnregistrement(liste, lectureSeule)}
    >
      {/* <Alerte type="info" titre="Déclarez les périodes de stage">
        Pendant un stage, le groupe est en entreprise : aucune séance ne lui sera placée sur la
        période.
      </Alerte> */}

      {groupes.length === 0 && (
        <Alerte type="avertissement" titre="Aucun groupe">
          Importez votre base e-note ou construisez votre carte : un stage se déclare sur un groupe
          existant.
        </Alerte>
      )}

      {/* ⚠️ GRIS, comme la grille : un écran de saisie reprend la teinte de ce
          qu'il produit. Le magenta a été abandonné le 2026-08-26 — stage et
          formation sont deux absences, et rien ne justifiait que l'une pèse plus
          que l'autre à l'écran. */}
      <ListePeriodes
        periodes={stages ?? []}
        onChange={setStages}
        lectureSeule={lectureSeule}
        sujets={groupes}
        cle={(sujet) => ({ groupe: sujet.valeur })}
        couleur="gris"
        anneeScolaire={annee}
        libelleSujet="Groupe"
        libelleVide="Aucune période de stage déclarée."
        aideVide="Tous les groupes restent disponibles toute l'année."
      />
    </CadreReglage>
    </>
  );
}
