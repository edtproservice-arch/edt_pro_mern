import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Moon, Sun, Users, UserRound } from 'lucide-react';
import { AXES_CONSULTATION, SEANCES_JOUR, SEANCE_SOIR, enJour, groupesDuSoir, semaineAOuvrir } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import Alerte from '@/components/common/Alerte';
import { chargerContexte, chargerSemaine, chargerSemaines } from '@/features/emploi/api';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useSemaineSuivie } from '@/features/emploi/useSemaineSuivie';
import GrilleConsultation from '@/features/edition/GrilleConsultation';
import { useAnneeActive } from '@/lib/anneeActive';
import PanneauAppel from './PanneauAppel';

/**
 * ═══ FAIRE L'APPEL DEPUIS LA GRILLE ═══ (2026-09-14, demande du porteur : « au
 * lieu de sélectionner la date et le groupe, afficher la grille de l'emploi du
 * temps comme Emploi ou Édition ; un clic sur une séance affiche la liste ».)
 * REMPLACE le choix « date + groupe + cours » livré le matin même.
 *
 * ⚠️ AUCUNE NOUVELLE GRILLE : c'est `GrilleConsultation`, la lecture de « Édition »,
 * avec ses cases rendues cliquables. Même semaine, mêmes clés de cache — déjà
 * chargées si l'on vient d'« Emploi » ou d'« Édition ».
 * ⚠️ PAR GROUPE D'ABORD : l'appel porte sur une classe. L'axe formateur reste à
 * un clic, pour qui cherche « le cours de M. X ».
 * ⚠️ UN COURS À VENIR OU DONT LE FORMATEUR ÉTAIT ABSENT NE S'OUVRE PAS, et un
 * message dit pourquoi — le serveur refuserait de toute façon l'un et l'autre.
 */
const AXES = [
  { cle: 'groupe', libelle: 'Par groupe', Icone: Users },
  { cle: 'formateur', libelle: 'Par formateur', Icone: UserRound },
];

export default function AppelParGrille() {
  const anneeChoisie = useAnneeActive();
  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false });
  const semaines = useQuery({ queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false });
  const anneeScolaire = anneeChoisie ?? contexte.data?.anneeScolaire ?? null;

  const [semaine, setSemaine] = useSemaineSuivie({
    courante: semaines.data?.courante,
    repli: !semaines.isLoading && anneeScolaire ? semaineAOuvrir(anneeScolaire) : null,
    cle: ['emploi', 'semaines'],
  });
  const grille = useQuery({
    queryKey: ['emploi', 'semaine', semaine],
    queryFn: () => chargerSemaine(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  const [axe, setAxe] = useState('groupe');
  const [periode, setPeriode] = useState('jour');
  const [choix, setChoix] = useState(null);

  const formateurs = contexte.data?.formateurs ?? [];
  const groupes = contexte.data?.groupes ?? [];
  const aDuSoir = groupesDuSoir(groupes).length > 0;
  const nomsFormateurs = useMemo(() => new Map(formateurs.map((f) => [f.matricule, f.nom])), [formateurs]);
  const sujets = useMemo(() => {
    if (axe === 'groupe') return periode === 'soir' ? groupesDuSoir(groupes) : groupes;
    return formateurs.map((f) => f.matricule);
  }, [axe, periode, groupes, formateurs]);

  const choisir = useCallback(
    ({ cellule, date }) => {
      const seance = cellule.seances.find((s) => s.statut !== 'absent');
      if (!seance) {
        toast.info('Le formateur était absent : ce cours n’a pas d’appel.');
        return;
      }
      if (!date || date > enJour(new Date())) {
        toast.info('Ce cours est à venir : l’appel se fait le jour même ou après.');
        return;
      }
      setChoix({
        date,
        cours: { seance: cellule.seance, periode, groupe: seance.groupe },
        sousTitre: `${date.slice(8, 10)}/${date.slice(5, 7)} · ${seance.groupe} · ${seance.module}`,
      });
    },
    [periode]
  );

  if (contexte.error || grille.error) {
    return <Alerte type="erreur" titre="Emploi du temps indisponible">{(contexte.error ?? grille.error).message}</Alerte>;
  }

  return (
    <div className="space-y-3">
      <div className="relative flex flex-wrap items-center gap-3">
        <ButtonGroup>
          {AXES.map(({ cle, libelle, Icone }) => (
            <Button
              key={cle}
              type="button"
              variant={axe === cle ? 'default' : 'outline'}
              size="sm"
              aria-pressed={axe === cle}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setAxe(cle)}
            >
              <Icone className="size-3.5" />
              {libelle}
            </Button>
          ))}
        </ButtonGroup>

        <NavigationSemaine
          className="xl:absolute xl:left-1/2 xl:-translate-x-1/2"
          semaine={semaine}
          onChanger={setSemaine}
          anneeScolaire={anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
        />

        {/* Le soir ne concerne que les groupes « CDS » : sans eux, rien à basculer. */}
        {aDuSoir && (
          <ButtonGroup className="ml-auto">
            {[
              { cle: 'jour', libelle: 'Jour', Icone: Sun },
              { cle: 'soir', libelle: 'Soir', Icone: Moon },
            ].map(({ cle, libelle, Icone }) => (
              <Button
                key={cle}
                type="button"
                variant={periode === cle ? 'default' : 'outline'}
                size="sm"
                aria-pressed={periode === cle}
                className="h-8 gap-1.5 text-xs"
                onClick={() => setPeriode(cle)}
              >
                <Icone className="size-3.5" />
                {libelle}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Cliquez sur un cours pour faire l’appel de ses stagiaires.</p>

      {grille.isLoading || contexte.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement de l’emploi du temps…</p>
      ) : (
        <GrilleConsultation
          sujets={sujets}
          libelle={(sujet) => (axe === 'formateur' ? nomsFormateurs.get(sujet) ?? sujet : sujet)}
          seances={grille.data?.seances ?? []}
          axe={axe}
          lignes={AXES_CONSULTATION[axe].lignes}
          periode={periode}
          creneaux={periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR}
          jours={grille.data?.jours ?? []}
          nomsFormateurs={nomsFormateurs}
          entete={AXES_CONSULTATION[axe].libelle}
          onChoisirCase={choisir}
        />
      )}

      <PanneauAppel choix={choix} onFermer={() => setChoix(null)} />
    </div>
  );
}
