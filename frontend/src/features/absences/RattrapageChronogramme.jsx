import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyserSemaine, separerFusion } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import { chargerChronogrammeFormateur } from '@/features/chronogramme/api';
import { LegendeRattrapage } from '@/features/chronogramme/GrilleChronogramme';
import VueFormateur from '@/features/chronogramme/VueFormateur';

/**
 * La ligne du chronogramme concernée par une absence — EN LECTURE SEULE.
 * ← demandes du porteur : 2026-09-03 (« filtrer seulement la ligne du groupe et
 *   du module de la séance absentée »), 2026-09-14 (« je ne veux pas
 *   l'enregistrement automatique … afficher la séance absente aussi en
 *   chronogramme … avec un style rattrapage »), décision B : lecture seule.
 *
 * ═══ ⚠️ POURQUOI PLUS AUCUNE SAISIE ICI ═══
 * Le rattrapage s'enregistre désormais d'un seul tenant — séance, date ET report
 * des heures au chronogramme. Laisser saisir des heures à la main dans cette
 * même grille, c'était exactement le double comptage qui avait fait garder, le
 * 2026-09-03, la grille en simple vérification. Elle MONTRE donc : la semaine de
 * l'absence (pastille rouge), celle du rattrapage enregistré (cadre ↺) et celle
 * du créneau choisi mais pas encore enregistré (même cadre, fond pâle).
 *
 * ⚠️ LA LIAISON FINE EMPLOI ↔ CHRONOGRAMME EST REPORTÉE (décision du porteur) :
 * ces repères disent « cette semaine », ils ne relient pas la cellule à la
 * séance.
 *
 * ⚠️ `VueFormateur` TEL QUEL, réduit par un filtre d'AFFICHAGE : l'API rend
 * toutes les lignes du formateur, on n'en garde que celle(s) de l'absence — une
 * fusion synchrone en porte une par groupe.
 */
export default function RattrapageChronogramme({ absence, choisi }) {
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
      data: {
        ...requete.data,
        lignes: requete.data.lignes.filter(
          (ligne) => membres.includes(ligne.groupe) && ligne.code === absence.module
        ),
      },
    };
  }, [requete, membres, absence.module]);

  /*
   * Les repères du serveur, plus le créneau CHOISI — sur chaque groupe de
   * l'absence, puisque le report se fera dans chacun de leurs chronogrammes.
   */
  const marques = useMemo(() => {
    const base = requete.data?.marques ?? {};
    const numero = choisi ? analyserSemaine(choisi.semaine)?.numero : null;
    if (!numero) return base;

    const suivantes = { ...base };
    for (const groupe of membres) {
      const cle = `${groupe}||${absence.module}`.toUpperCase();
      const ligne = { ...(suivantes[cle] ?? {}) };
      ligne[numero] = { absences: 0, rattrapages: 0, ...(ligne[numero] ?? {}), brouillon: true };
      suivantes[cle] = ligne;
    }
    return suivantes;
  }, [requete.data?.marques, choisi, membres, absence.module]);

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
        plannings={requete.data?.plannings ?? {}}
        lectureSeule
        marques={marques}
        onChanger={() => {}}
      />
    </div>
  );
}
