import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import EtapeFormateurs from '@/features/configuration/etapes/EtapeFormateurs';
import { corrigerFormateurs } from '@/features/configuration/api';
import { declarerAnnulable, empilerAvantEnregistrement, oublierAnnulation } from '@/lib/annulation';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import CadreReglage from './CadreReglage';

/**
 * Réglage des formateurs : adresses et masses horaires.
 * ← le panneau « formateurs » de profile.html
 *
 * `EtapeFormateurs` charge la base lui-même et remonte les CORRECTIONS, pas la
 * liste entière : on n'envoie que ce qui a changé. Une masse horaire corrigée
 * par l'établissement survit ainsi aux réimports e-note.
 */
export default function PageFormateurs() {
  const cache = useQueryClient();
  const { pathname } = useLocation();
  const [corrections, setCorrections] = useState({});

  /*
   * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ Un invité « peut modifier »
   * corrige, « peut consulter » lit. Pas de version optimiste ICI : la page
   * n'envoie que les champs CORRIGÉS, pas la liste entière — deux collègues sur
   * deux formateurs différents ne s'écrasent pas. C'est la carte d'affectations
   * qui serait écrasée par une correction, et c'est elle que la version protège :
   * une correction avance la version de la base.
   */
  const { lectureSeule } = useDroitPage('formateurs');

  const nombre = Object.keys(corrections).length;

  /*
   * ═══ POURQUOI CETTE PAGE GÈRE « DÉFAIRE » ELLE-MÊME ═══
   * Les autres écrans confient à `CadreReglage` leur ÉTAT COMPLET : il lui
   * suffit d'en garder une copie d'avant. Ici la page ne tient qu'un DIFF —
   * « ces trois formateurs prennent ces nouvelles valeurs ». Restaurer un diff
   * précédent ne reviendrait sur rien : ce serait renvoyer d'autres
   * corrections, pas défaire celles-ci.
   *
   * Le point de retour est donc l'INVERSE : ce que la base porte AUJOURD'HUI
   * pour les formateurs qu'on s'apprête à modifier. Le rejouer les y ramène.
   */
  const valeursActuelles = () => {
    const formateurs = cache.getQueryData(['base'])?.base?.formateurs ?? [];
    const parMatricule = new Map(formateurs.map((f) => [String(f.matricule).trim(), f]));

    const inverse = {};
    for (const matricule of Object.keys(corrections)) {
      const formateur = parMatricule.get(matricule);
      // Un matricule absent de la base ne peut pas être ramené en arrière : on
      // ne fabrique pas une valeur de retour qui n'a jamais existé.
      if (!formateur) continue;

      inverse[matricule] = {
        email: formateur.email ?? '',
        masseHoraire: formateur.masseHoraire ?? 0,
      };
    }
    return inverse;
  };

  useEffect(() => {
    declarerAnnulable(pathname, setCorrections);
    return () => oublierAnnulation(pathname);
  }, [pathname]);

  const enregistrement = useMutation({
    mutationFn: () => corrigerFormateurs(corrections),
    onSuccess: () => {
      setCorrections({});
      cache.invalidateQueries({ queryKey: ['base'] });
      toast.success(`${nombre} formateur(s) corrigé(s)`);
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const ecriture = lectureSeule
    ? {}
    : {
        modifie: nombre > 0,
        enCours: enregistrement.isPending,
        echec: enregistrement.isError,
        onEnregistrer: () => {
          // ⚠️ AVANT l'envoi : après, la base aura déjà les nouvelles valeurs et
          // l'inverse serait identique aux corrections — « Défaire » ne ferait
          // que les réappliquer.
          empilerAvantEnregistrement(pathname, valeursActuelles());
          enregistrement.mutate();
        },
      };

  return (
    <>
      <EnTetePartage page="formateurs" clesARelire={[['base']]} />
      <CadreReglage titre="Formateurs" {...ecriture}>
        <EtapeFormateurs onModification={setCorrections} lectureSeule={lectureSeule} avecContraintes />
      </CadreReglage>
    </>
  );
}
