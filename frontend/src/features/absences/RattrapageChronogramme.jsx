import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DUREE_RATTRAPAGE, analyserSemaine, reporterRattrapage, separerFusion } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import { chargerChronogrammeFormateur } from '@/features/chronogramme/api';
import { LegendeRattrapage } from '@/features/chronogramme/GrilleChronogramme';
import VueFormateur from '@/features/chronogramme/VueFormateur';
import { lignesDeLAbsence, planningsAvecAjout } from './ajoutChronogramme';

/**
 * La ligne du chronogramme concernée par une absence.
 * ← demandes du porteur : 2026-09-03 (« filtrer seulement la ligne du groupe et
 *   du module de la séance absentée »), 2026-09-14 (« je ne veux pas
 *   l'enregistrement automatique … afficher la séance absente aussi en
 *   chronogramme … avec un style rattrapage »).
 *
 * ═══ SAISIE ROUVERTE (2026-09-28) ═══
 * « Pour le rattrapage je veux qu'il puisse poser en chronogramme, pas seulement
 * la lecture », puis « je clique, ça s'ajoute automatiquement, sans
 * sélectionner, comme en emploi », puis « un seul bouton pour enregistrer
 * rattrapage et chronogramme ». Avec le droit de modifier le chronogramme, un
 * CLIC sur une semaine y pose la séance de rattrapage — 2,5 h, dans le type de
 * la case. Un clic sur une autre semaine l'y déplace, sur la même la retire.
 *
 * ⚠️ CONTRÔLÉE PAR LA MODALE : la semaine choisie (`semaineAjout`) vit dans
 * `RattrapagePlacement`, dont le bouton unique « Enregistrer le rattrapage »
 * l'écrit comme DATE de rattrapage : le serveur marque l'absence rattrapée et
 * reporte les 2,5 h au chronogramme ensemble. Rien ne part automatiquement.
 *
 * ⚠️ `VueFormateur` TEL QUEL, réduit par un filtre d'AFFICHAGE : l'API rend
 * toutes les lignes du formateur, on n'en garde que celle(s) de l'absence — une
 * fusion synchrone en porte une par groupe.
 */
export default function RattrapageChronogramme({
  absence,
  choisi,
  semaineAjout = null,
  onSemaineAjout,
  modifiable = false,
}) {
  const requete = useQuery({
    queryKey: ['chronogramme-formateur', absence.formateurMatricule],
    queryFn: () => chargerChronogrammeFormateur(absence.formateurMatricule),
    enabled: Boolean(absence.formateurMatricule),
    retry: false,
  });

  const membres = useMemo(() => separerFusion(absence.groupe), [absence.groupe]);

  const requeteAffichee = useMemo(() => {
    if (!requete.data) return requete;
    return {
      ...requete,
      data: { ...requete.data, lignes: lignesDeLAbsence(requete.data.lignes, absence) },
    };
  }, [requete, absence]);

  const initiaux = requete.data?.plannings;
  const lignes = requeteAffichee.data?.lignes;

  // Le planning affiché DÉRIVE du serveur : une relecture n'efface pas le choix.
  const plannings = useMemo(
    () => planningsAvecAjout(initiaux, lignes, semaineAjout?.numero),
    [initiaux, lignes, semaineAjout]
  );

  const poser = (ligne, semaine) => {
    if (semaine.numero === semaineAjout?.numero) {
      onSemaineAjout?.(null);
      return;
    }
    const essai = reporterRattrapage({
      planning: initiaux?.[ligne.groupe] ?? {},
      module: ligne.code,
      numeroSemaine: semaine.numero,
      delta: DUREE_RATTRAPAGE,
    });
    if (essai.etat === 'cellule_pleine') {
      toast.warning(`S${semaine.numero} est déjà pleine : la séance ne peut pas s’y ajouter.`);
      return;
    }
    onSemaineAjout?.({ numero: semaine.numero, debut: semaine.debut });
  };

  /*
   * Les repères du serveur, plus le créneau CHOISI — sur chaque groupe de
   * l'absence, puisque le report se fera dans chacun de leurs chronogrammes.
   */
  const marques = useMemo(() => {
    const base = requete.data?.marques ?? {};
    // Le créneau choisi dans l'emploi du temps, ou la semaine cliquée ici.
    const numeros = [choisi ? analyserSemaine(choisi.semaine)?.numero : null, semaineAjout?.numero].filter(
      Boolean
    );
    if (numeros.length === 0) return base;

    const suivantes = { ...base };
    for (const groupe of membres) {
      const cle = `${groupe}||${absence.module}`.toUpperCase();
      const ligne = { ...(suivantes[cle] ?? {}) };
      for (const numero of numeros) {
        ligne[numero] = { absences: 0, rattrapages: 0, ...(ligne[numero] ?? {}), brouillon: true };
      }
      suivantes[cle] = ligne;
    }
    return suivantes;
  }, [requete.data?.marques, choisi, semaineAjout, membres, absence.module]);

  if (requete.data && requeteAffichee.data.lignes.length === 0) {
    return (
      <Alerte type="avertissement" titre="Module introuvable dans le chronogramme">
        {absence.groupe} · {absence.module} ne figure pas parmi les affectations connues de ce
        formateur. Le rattrapage se place tout de même dans l’emploi du temps ; vérifiez la carte
        d’affectations.
      </Alerte>
    );
  }

  return (
    <div className="space-y-2">
      <LegendeRattrapage avecBrouillon />
      <VueFormateur
        requete={requeteAffichee}
        plannings={plannings}
        lectureSeule={!modifiable}
        marques={marques}
        onClicDirect={poser}
        onChanger={() => {}}
      />
    </div>
  );
}
