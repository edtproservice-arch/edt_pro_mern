import { createContext, useContext, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ChevronDown,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  UserX,
} from 'lucide-react';
import { ROLES } from 'shared/constants';
import { DUREE_RATTRAPAGE, dateDuJour, droitSuffit, dureeSeance, enJour, horaireCreneau, libelleSemaine } from 'shared/domain';
import { formatterDuree, formatterHeure } from '@/features/consultation/VueAgenda';
import { useHorairesCourants } from '@/features/horaires/useHorairesCourants';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import TableauTriable from '@/components/common/TableauTriable';
import Alerte from '@/components/common/Alerte';
import { MARGE_PAGE, PASTILLE_RATTRAPAGE } from '@/components/common/apparenceGrille';
import CadreReglage from '@/features/parametres/CadreReglage';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { cn } from '@/lib/utils';
import { annulerRattrapage, chargerAbsences, exporterAbsences, modifierAbsence, placerRattrapage } from './api';
import RattrapageChronogramme from './RattrapageChronogramme';
import RattrapageEmploi from './RattrapageEmploi';
import { grouperParFormateur } from './regroupement';
import OngletStagiaires from './stagiaires/OngletStagiaires';
import { recupererSession } from '@/features/auth/api';
import ListeRepliable from './ListeRepliable';
import { empreinte, useEtatPartage } from '@/features/guidage/useEtatPartage';
import BoutonTelecharger from '@/components/common/BoutonTelecharger';

/**
 * Ce que la personne peut faire ici (Phase 5bis, étape d2) — lu par les champs,
 * profondément imbriqués dans les deux vues.
 *
 * ⚠️ `lectureSeule` : un invité « peut consulter » VOIT observations et dates,
 * sans champ où les modifier — un champ qui se laisse remplir puis que le
 * serveur refuse est pire qu'un texte.
 *
 * ⚠️ `peutPlacer` : placer un rattrapage ÉCRIT dans l'emploi du temps (la séance)
 * autant que dans le registre — il faut pouvoir modifier les DEUX pages, comme
 * le serveur l'exige (2026-09-14). Être invité aux absences ne suffit pas.
 *
 * ⚠️ `voitChronogramme` : consulter suffit pour VOIR l'onglet Chronogramme de la
 * modale ; `modifieChronogramme` (2026-09-28, demande du porteur : « pour le
 * rattrapage je veux qu'il puisse poser en chronogramme, pas seulement la
 * lecture ») ouvre la saisie — le même droit que sur la page Chronogramme.
 */
const DroitsAbsences = createContext({
  lectureSeule: false,
  peutPlacer: false,
  voitChronogramme: false,
  modifieChronogramme: false,
});

/**
 * Registre des absences de formateurs et de leurs rattrapages (F8).
 * ← le panneau « Absences » de public/absence.html + api/data/get_absences.php
 *
 * ═══ ⚠️ CET ÉCRAN NE CRÉE PAS D'ABSENCE ═══
 * Une absence naît dans la GRILLE, en marquant une séance — c'est là qu'on sait
 * quel créneau n'a pas été assuré. Ici on ne fait qu'ajouter ce que la séance ne
 * sait pas dire : le motif, et la date à laquelle le cours sera rattrapé.
 * L'annoncer évite de chercher un bouton « Ajouter » qui n'existe pas.
 */
export default function PageAbsences() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const role = session.data?.utilisateur?.role;
  const { droitSur } = usePartagesAvecMoi();

  /*
   * ═══ DEUX ONGLETS, SELON LE RÔLE ═══ (F9, 2026-09-14)
   * « Formateurs » se garde par le droit sur la page, comme avant ; « Stagiaires »
   * est ouvert à l'encadrement par son RÔLE. Le gestionnaire n'a que le second :
   * la demande lui ouvre la saisie des absences de stagiaires, pas le registre
   * des formateurs, que l'écran ne lui montrait plus depuis le 2026-09-03.
   */
  const voitFormateurs = droitSuffit(droitSur('absences'), 'consulter');
  const encadrement = role === ROLES.DIRECTEUR || role === ROLES.GESTIONNAIRE;
  const [parametresPage] = useSearchParams();
  const [onglet, setOnglet] = useState(null);
  /* ⚠️ `?groupe=…` FORCE L'ONGLET STAGIAIRES (2026-09-29, demande du porteur :
     « si je clique envoie directement en groupe en page absence ») — sans ça,
     un directeur qui voit aussi « Formateurs » atterrirait sur le mauvais
     onglet et le lien depuis l'accueil ne mènerait nulle part d'utile. */
  const actif = onglet ?? (parametresPage.get('groupe') ? 'stagiaires' : voitFormateurs ? 'formateurs' : 'stagiaires');

  return (
    <>
      <EnTetePartage page="absences" clesARelire={[['absences'], ['absences-stagiaires']]} />
      <CadreReglage titre="Absences" large chargement={session.isLoading}>
        {voitFormateurs && encadrement && (
          <ButtonGroup>
            {ONGLETS_PAGE.map(({ cle, libelle, Icone }) => (
              <Button
                key={cle}
                type="button"
                variant={actif === cle ? 'default' : 'outline'}
                size="sm"
                aria-pressed={actif === cle}
                className="h-8 gap-1.5 text-xs"
                onClick={() => setOnglet(cle)}
              >
                <Icone className="size-3.5" />
                {libelle}
              </Button>
            ))}
          </ButtonGroup>
        )}
        {actif === 'formateurs' ? <RegistreFormateurs /> : <OngletStagiaires encadrement={encadrement} />}
      </CadreReglage>
    </>
  );
}

/** ⚠️ Un choix exclusif : c'est la seule forme que la charte réserve à `ButtonGroup`. */
const ONGLETS_PAGE = [
  { cle: 'formateurs', libelle: 'Formateurs', Icone: UserX },
  { cle: 'stagiaires', libelle: 'Stagiaires', Icone: GraduationCap },
];

function RegistreFormateurs() {
  const cache = useQueryClient();
  /* `?filtre=attente` (2026-09-28) : depuis « À traiter » de l'accueil, le
     registre s'ouvre sur les absences sans rattrapage — celles dont on parle. */
  const [parametres] = useSearchParams();
  const [filtre, setFiltre] = useState(() =>
    FILTRES.some((choix) => choix.valeur === parametres.get('filtre'))
      ? parametres.get('filtre')
      : 'toutes'
  );

  const registre = useQuery({
    queryKey: ['absences', filtre],
    queryFn: () =>
      chargerAbsences(filtre === 'toutes' ? {} : { rattrapees: filtre === 'rattrapees' }),
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, champs }) => modifierAbsence(id, champs),
    onSuccess: (reponse) => {
      cache.invalidateQueries({ queryKey: ['absences'] });
      // Le chronogramme a bougé : ses grilles doivent être relues.
      cache.invalidateQueries({ queryKey: ['chronogramme'] });

      const { reporte, alertes } = reponse.chronogramme ?? {};

      /*
       * ⚠️ CE QUI N'A PAS PU ÊTRE REPORTÉ EST DIT. Un rattrapage posé sur un
       * groupe sans chronogramme, ou dans une cellule déjà pleine, ne s'y
       * inscrit pas — et se taire laisserait croire le contraire.
       */
      if (alertes?.length > 0) {
        toast.warning('Rattrapage enregistré, mais non reporté partout', {
          description: alertes.map(decrireAlerte).join(' · '),
        });
        return;
      }

      toast.success(
        reporte > 0
          ? `Enregistré — ${reporte} report(s) au chronogramme`
          : 'Enregistré'
      );
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  /*
   * ═══ TÉLÉCHARGER : MÊME FILTRE QUE L'ÉCRAN (2026-09-29, demande du porteur :
   * « en absence je veux ajouter qu'il être exporté en Word et PDF et Excel »)
   * ═══ « Toutes », « Sans rattrapage » ou « Rattrapées » — le registre
   * téléchargé est celui que le bouton actif montre à l'écran.
   */
  const telechargement = useMutation({
    mutationFn: (format) =>
      exporterAbsences({
        format,
        ...(filtre === 'toutes' ? {} : { rattrapees: filtre === 'rattrapees' }),
      }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  const absences = registre.data?.absences ?? [];
  const enAttente = absences.filter((absence) => !absence.dateRattrapage).length;

  const { droitSur } = usePartagesAvecMoi();
  const lectureSeule = !droitSuffit(droitSur('absences'), 'modifier');
  const droits = {
    lectureSeule,
    peutPlacer: !lectureSeule && droitSuffit(droitSur('emploi'), 'modifier'),
    voitChronogramme: droitSuffit(droitSur('chronogramme'), 'consulter'),
    modifieChronogramme: droitSuffit(droitSur('chronogramme'), 'modifier'),
  };

  if (registre.isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  // ⚠️ LE MESSAGE, PAS L'OBJET : rendu tel quel, une `Error` fait un écran blanc.
  if (registre.error) return <Alerte type="erreur" titre="Registre indisponible">{registre.error.message}</Alerte>;

  return (
    <DroitsAbsences.Provider value={droits}>
      <div className="space-y-6">
        {/* La consigne dit où SAISIR : sans objet pour qui ne fait que consulter. */}
        {/* {!droits.lectureSeule && (
          <Alerte type="info" titre="Une absence se marque dans l’emploi du temps">
            Ouvrez la case de la séance et choisissez « Marquer absent » dans la liste des espaces. Elle
            apparaît alors ici, où l’on note le motif et le rattrapage.
          </Alerte>
        )} */}

        <div className="flex flex-wrap items-center gap-2">
          {FILTRES.map((choix) => (
            <Button
              key={choix.valeur}
              variant={filtre === choix.valeur ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFiltre(choix.valeur)}
            >
              {choix.libelle}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {absences.length} absence(s)
            {enAttente > 0 && ` · ${enAttente} sans rattrapage`}
          </span>

          {/*
            ⚠️ LE MÊME FILTRE QUE LES BOUTONS CI-DESSUS : télécharger « Sans
            rattrapage » ne rend pas le registre entier.
          */}
          {absences.length > 0 && (
            <BoutonTelecharger
              taille="xs"
              enCours={telechargement.isPending}
              onChoisir={(format) => telechargement.mutate(format)}
            />
          )}
        </div>

        {/*
          ═══ UNE LISTE PAR FORMATEUR, PLUS DE TABLEAU NI DE CARTES ═══
          (2026-09-14, demande du porteur.) Le tableau est retiré ; les cartes
          deviennent des fiches repliables, la forme de la vue par formateur des
          Affectations. L'en-tête porte ce qu'on parcourt — le nom, le nombre
          d'absences, ce qui reste à rattraper — et le détail se déplie SOUS lui,
          là où la carte ouvrait une modale.
        */}
        <ListeRepliable
          elements={grouperParFormateur(absences)}
          cleDe={(formateur) => formateur.cle}
          texteRecherche={(formateur) => `${formateur.formateurNom ?? ''} ${formateur.formateurMatricule ?? ''}`}
          placeholder="Filtrer par nom ou matricule…"
          vide={
            filtre === 'toutes'
              ? 'Aucune absence marquée cette année scolaire.'
              : 'Aucune absence ne correspond à ce filtre.'
          }
          entete={(formateur) => ({
            titre: formateur.formateurNom,
            sousTitre: [formateur.formateurMatricule, `${formateur.jours.length} jour(s)`]
              .filter(Boolean)
              .join(' · '),
            marque: formateur.sansRattrapage > 0,
            droite: (
              <>
                <span className="font-semibold">{formateur.total}</span> absence(s)
                <span
                  className={cn(
                    'block text-xs',
                    formateur.sansRattrapage > 0 ? 'text-accent-orange-deep' : 'text-muted-foreground'
                  )}
                >
                  {formateur.sansRattrapage > 0
                    ? `${formateur.sansRattrapage} sans rattrapage`
                    : 'tout rattrapé'}
                </span>
              </>
            ),
          })}
          detail={(formateur) => (
            <TableauAbsencesFormateur
              absences={formateur.jours.flatMap((jour) => jour.entrees)}
              enCours={enregistrer.isPending}
              onEnregistrer={(id, champs) => enregistrer.mutate({ id, champs })}
            />
          )}
        />
      </div>
    </DroitsAbsences.Provider>
  );
}

const FILTRES = [
  { valeur: 'toutes', libelle: 'Toutes' },
  { valeur: 'attente', libelle: 'Sans rattrapage' },
  { valeur: 'rattrapees', libelle: 'Rattrapées' },
];

/**
 * Les deux champs d'un créneau d'absence, dans la fiche dépliée du formateur.
 * Chaque champ tient son propre état : il n'y a rien à remonter.
 */
function ChampObservation({ absence, onEnregistrer }) {
  const { lectureSeule } = useContext(DroitsAbsences);
  const [observation, setObservation] = useState(absence.observation);

  if (lectureSeule) {
    return <p className="text-xs">{absence.observation || <span className="text-muted-foreground">—</span>}</p>;
  }

  return (
    <Input
      value={observation}
      onChange={(evenement) => setObservation(evenement.target.value)}
      onBlur={() => observation !== absence.observation && onEnregistrer({ observation })}
      placeholder="Motif de l’absence, remarque…"
      aria-label={`Motif de l’absence du ${absence.jour} ${absence.seance}`}
      className="h-8 bg-card text-xs"
    />
  );
}

function ChampRattrapage({ absence, enCours, onEnregistrer }) {
  const { lectureSeule } = useContext(DroitsAbsences);
  const [date, setDate] = useState(absence.dateRattrapage ?? '');
  const changee = (date || null) !== absence.dateRattrapage;

  if (lectureSeule) {
    return (
      <p className="text-xs tabular-nums">
        {absence.dateRattrapage ? `Rattrapé le ${absence.dateRattrapage}` : <span className="text-muted-foreground">Sans rattrapage</span>}
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={date}
          disabled={enCours}
          onChange={(evenement) => setDate(evenement.target.value)}
          className="h-8 w-36 text-xs"
        />
        {changee && (
          <Button
            size="sm"
            className="h-8 px-2"
            disabled={enCours}
            onClick={() => onEnregistrer({ dateRattrapage: date || null })}
            title={date ? 'Reporter au chronogramme' : 'Annuler le rattrapage'}
          >
            {date ? <CalendarCheck className="size-3.5" /> : <CalendarX className="size-3.5" />}
          </Button>
        )}
      </div>
      {/* ⚠️ Le report n'est pas automatique à la frappe : il ÉCRIT dans le
          chronogramme des groupes. Une date à moitié saisie y inscrirait des
          heures à la mauvaise semaine, puis les y laisserait. */}
      {changee && (
        <span className="mt-0.5 block text-[0.65rem] text-muted-foreground">
          {date ? 'À confirmer — 2,5 h seront reportées' : 'À confirmer — les heures seront reprises'}
        </span>
      )}
    </>
  );
}

/**
 * ═══ LES SÉANCES D'UN FORMATEUR ABSENT, EN TABLEAU (2026-09-20, demande du porteur) ═══
 * « Comme le mode stagiaire, pour la cohérence » : les absences des stagiaires se
 * lisent dans un `TableauTriable` — une ligne par marquage, des colonnes triables,
 * et des cartes sous 1280 px. Celles des formateurs étaient des cartes d'agenda
 * empilées par jour : deux écrans de la même page, deux façons de lire une absence.
 * C'est désormais le MÊME composant, et la même forme de colonnes.
 *
 * ⚠️ UNE LIGNE PAR CRÉNEAU, jamais fusionnée : chacun garde SON motif et SON
 * rattrapage (2,5 h à reprendre chacun, à un autre jour si besoin). Ce sont les
 * MÊMES champs qu'avant (`ChampObservation`, `RattrapagePlacement`) — seule la
 * disposition change, aucune écriture ne bouge.
 *
 * ⚠️ TRIÉ PAR DATE DÉCROISSANTE À L'ARRIVÉE, comme le registre du serveur (le plus
 * récent d'abord) : le tri par défaut de `TableauTriable` est l'ordre reçu, et un
 * clic sur « Date » le renverse.
 */
function TableauAbsencesFormateur({ absences, enCours, onEnregistrer }) {
  // L'horaire en vigueur (hiver, été, ramadan) : l'heure barrée d'une séance en dépend.
  const horaires = useHorairesCourants();
  return (
    <TableauTriable
      cartesSous="lg"
      collant={`-${MARGE_PAGE}px`}
      colonnes={colonnesAbsencesFormateur({ enCours, onEnregistrer, horaires })}
      lignes={absences}
      cleLigne={(absence) => absence.id}
      vide="Aucune absence."
    />
  );
}

function colonnesAbsencesFormateur({ enCours, onEnregistrer, horaires }) {
  return [
    {
      id: 'date',
      entete: 'Date',
      tri: (absence) => `${absence.dateAbsence}|${absence.seance}`,
      rendu: (absence) => {
        const { debut, fin } = horaireCreneau(absence.jour, absence.seance, horaires);
        return (
          <span className="whitespace-nowrap text-xs">
            {jourMois(absence.dateAbsence)}{' '}
            <span className="text-muted-foreground">
              · {absence.jour.slice(0, 3)} {absence.seance}
            </span>
            {/* L'horaire officiel du créneau, barré : c'est la séance qui n'a pas eu lieu. */}
            <span className="mt-0.5 flex items-center gap-1.5 text-[0.7rem]">
              <span className="text-destructive line-through">
                {formatterHeure(debut)} – {formatterHeure(fin)}
              </span>
              {/* Hors du barré : la durée est celle du cours à reprendre, pas d'un cours annulé. */}
              <span className="rounded-full border bg-background px-1.5 py-0.5 text-muted-foreground">
                {formatterDuree(dureeSeance(absence.seance))}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'groupe',
      entete: 'Groupe',
      tri: (absence) => absence.groupe,
      rendu: (absence) => <span className="text-xs font-medium">{absence.groupe || '—'}</span>,
    },
    {
      id: 'cours',
      entete: 'Cours',
      tri: (absence) => absence.module,
      rendu: (absence) => (
        <span className="text-xs">
          {absence.module || '—'}
          {absence.moduleIntitule && (
            <span className="block text-muted-foreground">{absence.moduleIntitule}</span>
          )}
        </span>
      ),
    },
    {
      id: 'espace',
      entete: 'Espace',
      tri: (absence) => absence.salle,
      rendu: (absence) => <span className="whitespace-nowrap text-xs">{absence.salle || '—'}</span>,
    },
    {
      id: 'motif',
      entete: 'Motif',
      rendu: (absence) => (
        <ChampObservation absence={absence} onEnregistrer={(champs) => onEnregistrer(absence.id, champs)} />
      ),
    },
    {
      id: 'rattrapage',
      entete: 'Rattrapage',
      tri: (absence) => absence.dateRattrapage ?? '',
      rendu: (absence) => (
        <RattrapagePlacement
          absence={absence}
          enCours={enCours}
          onEnregistrer={(champs) => onEnregistrer(absence.id, champs)}
        />
      ),
    },
  ];
}

/**
 * Le rattrapage d'un créneau : un bouton, puis une grande modale où l'on place
 * la séance D'UN CLIC et où on l'enregistre par un bouton.
 * ← demandes du porteur : 2026-09-03 (grilles intégrées à la modale, réduites à
 *   ce formateur) puis 2026-09-14 : « agrandis la taille du modal … je ne veux
 *   pas l'enregistrement automatique … au lieu du bouton date en bas mets un
 *   bouton d'enregistrement … lorsque je clique sur la case la séance se place
 *   automatiquement sans sélectionner le groupe puis le module puis la salle …
 *   et plus sécurisé ». Plan validé : décisions A (salle d'origine sinon la
 *   première libre), B (chronogramme en lecture seule), C (style ↺).
 *
 * ═══ ⚠️ UN CLIC CHOISIT, LE BOUTON ENREGISTRE ═══
 * Le clic ne pose qu'un BROUILLON, local, sans rien écrire. « Enregistrer le
 * rattrapage » envoie le seul créneau et la salle ; le serveur relit groupe,
 * module et formateur dans l'absence, refait tous les contrôles, et écrit la
 * séance, la date et le report au chronogramme d'un seul tenant. C'est ce qui
 * lève le double comptage qui avait fait garder, le 2026-09-03, la grille en
 * simple vérification à côté d'un champ de date : le champ de date disparaît.
 *
 * ═══ UN SEUL BOUTON POUR LES DEUX ONGLETS (2026-09-28) ═══
 * « Un seul bouton pour enregistrer rattrapage et chronogramme » : on choisit
 * SOIT un créneau de l'emploi du temps (`choisi`), SOIT une semaine du
 * chronogramme (`semaineAjout`) — choisir l'un efface l'autre. Le créneau
 * inscrit déjà ses 2,5 h au chronogramme côté serveur : garder les deux
 * compterait la séance deux fois. « Enregistrer le rattrapage » écrit celui
 * qui est choisi.
 *
 * ⚠️ LA SEMAINE DU CHRONOGRAMME MARQUE AUSSI L'ABSENCE RATTRAPÉE (2026-09-28,
 * « oui, marquer l'absence comme rattrapée aussi ») : elle passe par la DATE de
 * rattrapage — le lundi de la semaine —, que le serveur écrit avec le report
 * de 2,5 h au chronogramme dans UNE transaction, en reprenant une date
 * précédente. Pas d'écriture du planning depuis l'écran : la date et les
 * heures ne peuvent pas se contredire.
 *
 * ⚠️ SANS DROIT DE PLACER — ou sans matricule, aucune ligne à isoler — il reste
 * la saisie de la date d'avant. Un rattrapage déjà PLACÉ ne s'y modifie pas :
 * le serveur refuserait une date qui contredit sa séance.
 */
function RattrapagePlacement({ absence, enCours, onEnregistrer }) {
  const { peutPlacer, voitChronogramme, modifieChronogramme } = useContext(DroitsAbsences);
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState('emploi');
  const [choisi, setChoisiBrut] = useState(null);
  const [semaineAjout, setSemaineAjoutBrut] = useState(null);
  /*
   * Le créneau de rattrapage choisi — dans l'emploi ou au chronogramme —,
   * partagé pendant le guidage (2026-10-04) : l'autre écran voit la même case
   * retenue avant « Placer ». Une clé PAR ABSENCE : plusieurs fenêtres peuvent
   * exister sur la page.
   */
  const cleRattrapage = `absences.rattrapage.${empreinte(String(absence.id))}`;
  useEtatPartage(`${cleRattrapage}.choisi`, choisi, setChoisiBrut);
  useEtatPartage(`${cleRattrapage}.semaine`, semaineAjout, setSemaineAjoutBrut);
  const cache = useQueryClient();
  const posee = absence.rattrapage ?? null;

  // L'un OU l'autre — voir « un seul bouton » ci-dessus.
  const setChoisi = (creneau) => {
    setChoisiBrut(creneau);
    if (creneau) setSemaineAjoutBrut(null);
  };
  // `{numero, debut}` : la semaine du chronogramme, et son lundi pour la date.
  const setSemaineAjout = (semaine) => {
    setSemaineAjoutBrut(semaine);
    if (semaine) setChoisiBrut(null);
  };

  const apresEcriture = (reponse, message) => {
    setChoisi(null);
    const { reporte, alertes } = reponse?.chronogramme ?? {};
    if (alertes?.length > 0) {
      toast.warning(`${message}, mais non reporté partout au chronogramme`, {
        description: alertes.map(decrireAlerte).join(' · '),
      });
      return;
    }
    toast.success(reporte > 0 ? `${message} — ${reporte} report(s) au chronogramme` : message);
  };

  const refus = (erreur) =>
    toast.error('Rattrapage refusé', {
      description: Array.isArray(erreur.details) && erreur.details[0]?.message
        ? erreur.details[0].message
        : erreur.message,
    });

  const placer = useMutation({
    mutationFn: () => placerRattrapage(absence.id, choisi),
    onSuccess: (reponse) => apresEcriture(reponse, 'Rattrapage enregistré'),
    onError: refus,
  });

  const poserChronogramme = useMutation({
    mutationFn: () => modifierAbsence(absence.id, { dateRattrapage: semaineAjout.debut }),
    onSuccess: async (reponse) => {
      apresEcriture(reponse, 'Rattrapage enregistré');
      cache.invalidateQueries({ queryKey: ['absences'] });
      cache.invalidateQueries({ queryKey: ['chronogramme'] });
      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      // La relecture d'abord : la grille ne repasse pas par l'ancien planning.
      await cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
      setSemaineAjoutBrut(null);
    },
    onError: refus,
  });

  const annuler = useMutation({
    mutationFn: () => annulerRattrapage(absence.id),
    onSuccess: (reponse) => apresEcriture(reponse, 'Rattrapage annulé'),
    onError: refus,
  });

  if (!absence.formateurMatricule || !peutPlacer) {
    if (posee) {
      return (
        <p className="text-xs">
          Rattrapé le {jourMois(posee.date)} — {posee.jour} {posee.seance}, placé dans l’emploi du temps
        </p>
      );
    }
    return <ChampRattrapage absence={absence} enCours={enCours} onEnregistrer={onEnregistrer} />;
  }

  const enCoursEcriture = placer.isPending || annuler.isPending || poserChronogramme.isPending;
  const ongletsVisibles = voitChronogramme ? ONGLETS_RATTRAPAGE : ONGLETS_RATTRAPAGE.slice(0, 1);
  const vueActive = ongletsVisibles.some((onglet) => onglet.cle === vue) ? vue : 'emploi';

  return (
    <>
      <Button
        type="button"
        variant={absence.dateRattrapage ? 'outline' : 'default'}
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => {
          setChoisi(null);
          setSemaineAjoutBrut(null);
          setOuvert(true);
        }}
      >
        <CalendarClock className="size-3.5" />
        {absence.dateRattrapage ? `Rattrapé le ${jourMois(absence.dateRattrapage)}` : 'Placer le rattrapage'}
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        {/*
          ═══ AGRANDIE (2026-09-14) ═══ Presque tout l'écran : la semaine entière
          de l'emploi du temps doit se lire sans se replier, et le chronogramme
          défiler sur ses 45 semaines.

          ⚠️ EN-TÊTE ET PIED FIXES, CORPS QUI DÉFILE — le correctif du matin
          (2026-09-14) : `DialogContent` de shadcn est une GRILLE, et un enfant de
          grille a `min-width: auto`. Colonne flex, en-tête / onglets / pied en
          `shrink-0`, corps en `min-h-0 min-w-0 flex-1 overflow-y-auto`, et la
          largeur ne défile que DANS la grille. Le bouton d'enregistrement vit
          dans le PIED : il reste à portée quelle que soit la hauteur de la grille.
        */}
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[110rem] flex-col gap-3 overflow-hidden sm:max-w-[110rem]">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              Rattrapage — {absence.jour} {absence.seance} ({jourMois(absence.dateAbsence)})
            </DialogTitle>
            <DialogDescription>
              {absence.formateurNom} · {absence.groupe || '—'} · {absence.module || 'sans module'}
              {absence.salle ? ` · ${absence.salle}` : ''}
            </DialogDescription>
          </DialogHeader>

          {ongletsVisibles.length > 1 && (
            <ButtonGroup className="shrink-0">
              {ongletsVisibles.map(({ cle, libelle }) => (
                <Button
                  key={cle}
                  type="button"
                  variant={vueActive === cle ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={vueActive === cle}
                  className="h-7 text-xs"
                  onClick={() => setVue(cle)}
                >
                  {libelle}
                </Button>
              ))}
            </ButtonGroup>
          )}

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {vueActive === 'chronogramme' ? (
              <RattrapageChronogramme
                absence={absence}
                choisi={choisi}
                semaineAjout={semaineAjout}
                onSemaineAjout={setSemaineAjout}
                modifiable={modifieChronogramme && !enCoursEcriture}
              />
            ) : (
              <RattrapageEmploi absence={absence} choisi={choisi} onChoisir={setChoisi} />
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t pt-3">
            <EtatRattrapage choisi={choisi} semaineAjout={semaineAjout} posee={posee} absence={absence} />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(choisi || semaineAjout) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={enCoursEcriture}
                  onClick={() => {
                    setChoisi(null);
                    setSemaineAjout(null);
                  }}
                >
                  Abandonner ce choix
                </Button>
              )}
              {posee && !choisi && !semaineAjout && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={enCoursEcriture}
                  onClick={() => annuler.mutate()}
                >
                  Annuler le rattrapage
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={(!choisi && !semaineAjout) || enCoursEcriture}
                onClick={() => (choisi ? placer.mutate() : poserChronogramme.mutate())}
              >
                {placer.isPending || poserChronogramme.isPending ? 'Enregistrement…' : 'Enregistrer le rattrapage'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** L'emploi du temps d'abord : c'est là qu'on place. */
const ONGLETS_RATTRAPAGE = [
  { cle: 'emploi', libelle: 'Emploi du temps' },
  { cle: 'chronogramme', libelle: 'Chronogramme' },
];

/**
 * Où en est le rattrapage — le seul accusé de réception de la modale, puisqu'il
 * n'y a plus d'enregistrement automatique : ce qui est choisi et pas encore
 * enregistré doit se lire comme tel.
 */
function EtatRattrapage({ choisi, semaineAjout, posee, absence }) {
  if (semaineAjout) {
    return (
      <p className="text-sm">
        <span className={cn(PASTILLE_RATTRAPAGE, 'mr-1.5 align-middle')}>↺</span>
        <span className="font-medium">
          Chronogramme · S{semaineAjout.numero} ({jourMois(semaineAjout.debut)}) · +{DUREE_RATTRAPAGE} h
        </span>
        <span className="ml-1.5 text-muted-foreground">— pas encore enregistré</span>
      </p>
    );
  }

  if (choisi) {
    const date = enJour(dateDuJour(choisi.semaine, choisi.jour));
    return (
      <p className="text-sm">
        <span className={cn(PASTILLE_RATTRAPAGE, 'mr-1.5 align-middle')}>↺</span>
        <span className="font-medium">
          {choisi.jour} {jourMois(date)} · {choisi.seance} · {choisi.salle}
        </span>
        <span className="ml-1.5 text-muted-foreground">
          ({libelleSemaine(choisi.semaine, { court: true })})
          {!choisi.salleDOrigine && absence.salle ? ` — ${absence.salle} est pris, autre espace libre` : ''}
          {' — '}pas encore enregistré
        </span>
      </p>
    );
  }

  if (posee) {
    return (
      <p className="text-sm">
        <span className={cn(PASTILLE_RATTRAPAGE, 'mr-1.5 align-middle')}>↺</span>
        Rattrapage enregistré :{' '}
        <span className="font-medium">
          {posee.jour} {jourMois(posee.date)} · {posee.seance} · {posee.salle}
        </span>
        <span className="ml-1.5 text-muted-foreground">
          — cliquez une autre case pour le déplacer
        </span>
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Aucun rattrapage placé. Cliquez sur une case libre de l’emploi du temps, ou sur une
      semaine du chronogramme.
    </p>
  );
}

/** « 2026-09-21 » → « 21/09 ». */
const jourMois = (date) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '');

/** Ce qu'une alerte de report veut dire, en clair. */
function decrireAlerte(alerte) {
  if (alerte.etat === 'sans_chronogramme') return `${alerte.groupe} n’a pas de chronogramme`;
  if (alerte.etat === 'cellule_pleine') return `${alerte.groupe} : semaine déjà à 20 h`;
  if (alerte.etat === 'sans_module') return 'absence sans module — rien à reporter';
  if (alerte.etat === 'hors_annee') return 'date hors de l’année scolaire';
  return `${alerte.groupe ?? ''} : ${alerte.etat}`;
}
