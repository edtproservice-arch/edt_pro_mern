import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fichesModules } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import { chargerContexte, chargerSemaine, chargerSemaines } from '@/features/emploi/api';
import GrilleEmploi from '@/features/emploi/GrilleEmploi';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { cleCase } from '@/features/emploi/selection';
import { evaluerCase } from './placementRattrapage';

/**
 * L'emploi du temps d'UN formateur, pour PLACER le rattrapage d'un clic.
 * ← demande du porteur, 2026-09-03 (grille réduite à la ligne du formateur),
 *   puis 2026-09-14 : « lorsque je clique sur la case la séance se place
 *   automatiquement sans sélectionner le groupe puis le module puis la salle …
 *   et je ne veux pas l'enregistrement automatique ».
 *
 * ═══ ⚠️ CE COMPOSANT N'ÉCRIT RIEN ═══
 * Il DÉSIGNE un créneau : un clic sur une case libre y pose un BROUILLON — le
 * groupe, le module et la salle de l'absence, la salle d'origine si elle est
 * libre, sinon la première libre (décision A du porteur). C'est la modale qui
 * enregistre, par son bouton, et le serveur qui écrit la séance, la date et le
 * report au chronogramme d'un seul tenant. Plus de saisie ligne par ligne, plus
 * d'écriture à chaque case : c'était ce qui faisait compter les heures deux fois.
 *
 * ⚠️ MÊME GRILLE, MÊMES CLÉS DE CACHE QUE LA PAGE « EMPLOI » : `GrilleEmploi`
 * reçoit un seul sujet et le mode placement ; un directeur qui a déjà ouvert
 * l'emploi du temps ne repaie rien.
 *
 * ⚠️ LES CONFLITS SE JUGENT SUR TOUTE LA SEMAINE, pas sur la seule ligne
 * affichée : un groupe déjà en cours avec un autre formateur, une salle déjà
 * prise ne se voient que là. La ligne n'est qu'une vue.
 */
export default function RattrapageEmploi({ absence, choisi, onChoisir }) {
  const matricule = absence.formateurMatricule;
  const periode = absence.periode ?? 'jour';
  const posee = absence.rattrapage ?? null;

  // La semaine du créneau choisi, sinon celle du rattrapage déjà posé.
  const [semaine, setSemaine] = useState(choisi?.semaine ?? posee?.semaine ?? null);

  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false });
  const semaines = useQuery({ queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false });

  useEffect(() => {
    if (!semaine && semaines.data?.courante) setSemaine(semaines.data.courante);
  }, [semaine, semaines.data]);

  const grille = useQuery({
    queryKey: ['emploi', 'semaine', semaine],
    queryFn: () => chargerSemaine(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  const toutes = useMemo(() => grille.data?.seances ?? [], [grille.data]);
  const jours = grille.data?.jours ?? [];

  // Le rattrapage déjà posé va-t-il être déplacé ? Il s'efface alors de la vue
  // au profit du brouillon — deux rattrapages à l'écran se liraient comme deux.
  const deplace = Boolean(
    choisi &&
      posee &&
      !(choisi.semaine === posee.semaine && choisi.jour === posee.jour && choisi.seance === posee.seance)
  );

  const seances = useMemo(
    () =>
      toutes.filter(
        (s) =>
          s.formateurMatricule === matricule &&
          (s.periode ?? 'jour') === periode &&
          !(deplace && s.id === posee?.id)
      ),
    [toutes, matricule, periode, deplace, posee?.id]
  );

  /*
   * Le brouillon passe par `brouillons`, le canal que la grille connaît déjà :
   * elle le dessine à la place de la case, avec son style de rattrapage.
   */
  const brouillons = useMemo(() => {
    const table = new Map();
    if (choisi && choisi.semaine === semaine && (!posee || deplace)) {
      table.set(cleCase(matricule, choisi.jour, choisi.seance, periode), {
        jour: choisi.jour,
        seance: choisi.seance,
        periode,
        formateurMatricule: matricule,
        groupe: absence.groupe,
        module: absence.module,
        salle: choisi.salle,
        statut: 'rattrape',
        brouillonRattrapage: true,
      });
    }
    return table;
  }, [choisi, semaine, posee, deplace, matricule, periode, absence.groupe, absence.module]);

  const fiches = useMemo(
    () => fichesModules(contexte.data?.affectations ?? []),
    [contexte.data?.affectations]
  );
  const posees = useMemo(
    () => new Map(Object.entries(contexte.data?.posees ?? {})),
    [contexte.data?.posees]
  );

  const placer = ({ jour, creneau, seance }) => {
    // Recliquer sur le brouillon le retire.
    if (seance?.brouillonRattrapage) {
      onChoisir(null);
      return;
    }
    if (seance && seance.id === posee?.id) {
      toast.info('Le rattrapage est déjà placé sur ce créneau');
      return;
    }
    if (seance) {
      toast.error('Case occupée', { description: `${seance.groupe} · ${seance.module}` });
      return;
    }

    const verdict = evaluerCase({
      absence,
      creneau: { semaine, jour, seance: creneau },
      seancesDuCreneau: toutes.filter(
        (s) => s.jour === jour && s.seance === creneau && (s.periode ?? 'jour') === periode
      ),
      etatDuJour: jours.find((etat) => etat.jour === jour),
      salles: contexte.data?.salles ?? [],
      groupesFq: contexte.data?.groupesFq ?? [],
      ignorer: posee ? [posee.id] : [],
    });

    if (!verdict.ok) {
      toast.error('Ce créneau ne convient pas', { description: verdict.motif });
      return;
    }

    onChoisir({
      semaine,
      jour,
      seance: creneau,
      salle: verdict.salle,
      salleDOrigine: verdict.salleDOrigine,
    });
  };

  if (contexte.isError) {
    return (
      <Alerte type="erreur" titre="Emploi du temps non chargé">
        {contexte.error.message}
      </Alerte>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NavigationSemaine
          semaine={semaine}
          anneeScolaire={contexte.data?.anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
          onChanger={setSemaine}
        />
        <p className="text-xs text-muted-foreground">
          Cliquez sur une case libre : la séance s’y place avec le groupe, le module et la salle de
          l’absence.
        </p>
      </div>

      {grille.isError ? (
        <Alerte type="erreur" titre="Semaine non chargée">
          {grille.error.message}
        </Alerte>
      ) : grille.isLoading || !grille.data || contexte.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement de la semaine…</p>
      ) : (
        <GrilleEmploi
          sujets={[matricule]}
          seances={seances}
          jours={jours}
          periode={periode}
          axe="formateur"
          nomDuSujet={() => absence.formateurNom}
          contexte={contexte.data ?? {}}
          fiches={fiches}
          posees={posees}
          brouillons={brouillons}
          onPlacerCase={placer}
        />
      )}
    </div>
  );
}
