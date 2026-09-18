import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Table as TableIcon } from 'lucide-react';
import { JOURS, ROLES } from 'shared/constants';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import NavigationSemaine from '@/features/emploi/NavigationSemaine';
import { useSemaineSuivie } from '@/features/emploi/useSemaineSuivie';
import GrilleDetaillee from '@/features/edition/GrilleDetaillee';
import VueAgenda from './VueAgenda';
import { recupererSession } from '@/features/auth/api';
import { useAnneeActive } from '@/lib/anneeActive';
import { cn } from '@/lib/utils';
import {
  chargerGroupesConsultation,
  chargerSemaineConsultation,
  chargerSemainesConsultation,
} from './api';

/**
 * « Mon emploi du temps » — sessions consultatives formateur & stagiaire (F14).
 * ← `emploiFormateur.html`, `emploiStagiaire.html`
 *
 * ═══ ⚠️ AUCUNE NOUVELLE GRILLE : `GrilleDetaillee` EST DÉJÀ CE QU'IL FAUT ═══
 * C'est le tableau read-only de la page « Édition », UN sujet par tableau,
 * jours en lignes — exactement ce qu'un formateur ou un stagiaire vient
 * consulter ici, réduit à SA seule ligne. En écrire une seconde version, ce
 * serait deux présentations d'une même semaine à tenir cohérentes (§4.2).
 *
 * ⚠️ RIEN NE S'Y SAISIT — ni ici, ni dans `GrilleDetaillee` elle-même : cette
 * session ne peut que CONSULTER. La saisie reste le geste du directeur, dans
 * « Emploi ».
 *
 * ═══ DEUX VUES, « AGENDA » PAR DÉFAUT (2026-09-04, demande du porteur) ═══
 * « Agenda » reprend la forme de l'ancien produit (`emploiStagiaire.html`) —
 * un jour après l'autre, en cartes — pour qui vient consulter au jour le jour,
 * sur mobile en particulier : c'est la question la plus fréquente sur cet
 * écran, elle s'ouvre donc en premier. « Tableau » reste accessible pour qui
 * veut voir la semaine ENTIÈRE d'un regard. Voir `VueAgenda.jsx` pour ce que
 * cette forme reprend, et ce qu'elle NE reprend PAS (aucune heure d'horloge,
 * ce projet n'en modélise pas).
 *
 * ⚠️ LE SÉLECTEUR DE SEMAINE REPREND CELUI DU DIRECTEUR — `NavigationSemaine`,
 * PARTAGÉ avec « Emploi » et « Édition » (demande du porteur : « le bouton
 * calendrier je veux qu'il être comme celui en page Emploi et Édition en
 * session directeur »). Un simple bouton de calendrier, sans les deux flèches
 * ni le retour à « aujourd'hui », se réapprend à chaque écran.
 *
 * ⚠️ MÊME DISPOSITION QUE « ÉDITION » : le sélecteur de semaine CENTRÉ
 * (`xl:absolute xl:left-1/2 xl:-translate-x-1/2` — un bloc dont les deux
 * flèches ont la même largeur, centrer le bloc revient à centrer le bouton),
 * et la bascule Tableau/Agenda au coin DROIT (`ml-auto`), comme l'axe de
 * lecture sur « Édition ».
 */
export default function PageMonEmploi() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const role = session.data?.utilisateur?.role;
  const estStagiaire = role === ROLES.STAGIAIRE;
  const anneeChoisie = useAnneeActive();

  const [vue, setVue] = useState('agenda');
  const [filtreJour, setFiltreJour] = useState('tous');

  const semaines = useQuery({
    queryKey: ['consultation', 'emploi', 'semaines'],
    queryFn: chargerSemainesConsultation,
    enabled: Boolean(role),
    retry: false,
  });

  /* La semaine qui fait foi — suivie, et relue chaque samedi à 6 h 30. */
  const [semaine, setSemaine] = useSemaineSuivie({
    courante: semaines.data?.courante,
    cle: ['consultation', 'emploi', 'semaines'],
  });

  const grille = useQuery({
    queryKey: ['consultation', 'emploi', semaine],
    queryFn: () => chargerSemaineConsultation(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  /*
   * ⚠️ UN STAGIAIRE PEUT PORTER PLUSIEURS GROUPES — le sien, plus une
   * formation qualifiante éventuelle (2026-08-19). Chacun reçoit SON tableau :
   * les réunir en un seul ferait porter à une ligne des cours qui, pour l'un
   * des deux groupes, n'ont pas lieu.
   */
  const groupesStagiaire = useQuery({
    queryKey: ['consultation', 'groupes'],
    queryFn: chargerGroupesConsultation,
    enabled: estStagiaire,
    retry: false,
  });

  const nomsFormateurs = useMemo(
    () => new Map((grille.data?.formateurs ?? []).map((f) => [f.matricule, f.nom])),
    [grille.data?.formateurs]
  );

  if (session.isLoading || semaines.isLoading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const sujets = estStagiaire
    ? (groupesStagiaire.data?.groupes ?? [])
    : session.data?.utilisateur
      ? [session.data.utilisateur.identifiant]
      : [];

  const libelleDuSujet = (sujet) =>
    estStagiaire ? sujet : session.data?.utilisateur?.nomComplet ?? sujet;

  return (
    <CadreReglage
      large
      titre="Mon emploi du temps"
      chargement={estStagiaire && groupesStagiaire.isLoading}
      erreur={
        (estStagiaire ? groupesStagiaire.isError && groupesStagiaire.error.message : null) ||
        (semaines.isError ? semaines.error.message : null)
      }
    >
      <div className="relative flex flex-wrap items-center gap-2 sm:gap-3">
        <NavigationSemaine
          className="xl:absolute xl:left-1/2 xl:-translate-x-1/2"
          semaine={semaine}
          onChanger={setSemaine}
          anneeScolaire={anneeChoisie ?? grille.data?.anneeScolaire}
          remplies={semaines.data?.semaines ?? []}
          courante={semaines.data?.courante}
        />

        {/*
          ⚠️ AU COIN DROIT (`ml-auto`), comme l'axe de lecture sur « Édition ».
          MÊME FORME QUE LA BASCULE TABLEAU/CARTES DES ABSENCES — un seul
          `ButtonGroup`, deux vues nommées, jamais un interrupteur (une bascule
          à deux noms se réapprend, un groupe de boutons dit ce qu'il fait).
        */}
        {/*
          ⚠️ SUR TÉLÉPHONE, LES ICÔNES SEULES (demande du porteur, 2026-09-14) :
          avec leurs libellés, les deux boutons passaient sous le sélecteur de
          semaine et prenaient une ligne à eux seuls. Le libellé reste dans le
          nom accessible et dans l'infobulle.
        */}
        <ButtonGroup className="ml-auto">
          <Button
            type="button"
            variant={vue === 'tableau' ? 'default' : 'outline'}
            size="sm"
            aria-pressed={vue === 'tableau'}
            aria-label="Tableau"
            title="Tableau"
            className="h-8 gap-1.5 px-2 text-xs sm:px-3"
            onClick={() => setVue('tableau')}
          >
            <TableIcon className="size-3.5" />
            <span className="hidden sm:inline">Tableau</span>
          </Button>
          <Button
            type="button"
            variant={vue === 'agenda' ? 'default' : 'outline'}
            size="sm"
            aria-pressed={vue === 'agenda'}
            aria-label="Agenda"
            title="Agenda"
            className="h-8 gap-1.5 px-2 text-xs sm:px-3"
            onClick={() => setVue('agenda')}
          >
            <LayoutList className="size-3.5" />
            <span className="hidden sm:inline">Agenda</span>
          </Button>
        </ButtonGroup>
      </div>

      {/*
        ⚠️ LE FILTRE PAR JOUR N'A DE SENS QU'EN AGENDA : le tableau montre déjà
        les six jours d'un coup, le masquer y ferait disparaître des colonnes
        sans qu'aucun bouton ne dise pourquoi.
      */}
      {vue === 'agenda' && (
        <div className="flex flex-wrap gap-2">
          {['tous', ...JOURS].map((jour) => (
            <button
              key={jour}
              type="button"
              aria-pressed={filtreJour === jour}
              onClick={() => setFiltreJour(jour)}
              className={cn(
                'rounded-full border px-3.5 py-1 text-xs font-medium transition-colors',
                filtreJour === jour
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-input text-muted-foreground hover:border-primary/30 hover:text-primary'
              )}
            >
              {jour === 'tous' ? 'Tous' : jour}
            </button>
          ))}
        </div>
      )}

      {grille.isError ? (
        <Alerte type="erreur" titre="Semaine indisponible">
          {grille.error.message}
        </Alerte>
      ) : grille.isLoading || !grille.data ? (
        <p className="text-sm text-muted-foreground">Chargement de la semaine…</p>
      ) : sujets.length === 0 ? (
        <Alerte type="avertissement" titre="Aucun groupe connu">
          Votre compte n’est rattaché à aucun groupe pour le moment. Contactez votre établissement.
        </Alerte>
      ) : vue === 'agenda' ? (
        <div className="space-y-4">
          {sujets.map((sujet) => (
            <VueAgenda
              key={sujet}
              sujet={sujet}
              libelle={libelleDuSujet(sujet)}
              seances={grille.data.seances}
              axe={estStagiaire ? 'groupe' : 'formateur'}
              nomsFormateurs={nomsFormateurs}
              jours={grille.data.jours}
              // F9 : le formateur fait l'appel de ses séances depuis la carte.
              avecAppel={!estStagiaire}
              filtreJour={filtreJour}
              intitules={grille.data.modules}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {sujets.map((sujet) => (
            <GrilleDetaillee
              key={sujet}
              sujet={sujet}
              libelle={libelleDuSujet(sujet)}
              seances={grille.data.seances}
              axe={estStagiaire ? 'groupe' : 'formateur'}
              lignes={estStagiaire ? ['Formateur', 'Module', 'Salle'] : ['Groupe', 'Module', 'Salle']}
              jours={grille.data.jours}
              nomsFormateurs={nomsFormateurs}
            />
          ))}
        </div>
      )}
    </CadreReglage>
  );
}
