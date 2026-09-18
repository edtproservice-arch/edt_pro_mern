import { createContext, useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, CalendarClock, CalendarX, Check, Clock, GraduationCap, UserX } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { dateDuJour, droitSuffit, dureeSeance, enJour, horaireCreneau, libelleSemaine } from 'shared/domain';
import {
  ContenuSeance,
  STYLES as STYLES_AGENDA,
  formatterDuree,
  formatterHeure,
} from '@/features/consultation/VueAgenda';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import { PASTILLE_RATTRAPAGE } from '@/components/common/apparenceGrille';
import CadreReglage from '@/features/parametres/CadreReglage';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { cn } from '@/lib/utils';
import { annulerRattrapage, chargerAbsences, modifierAbsence, placerRattrapage } from './api';
import RattrapageChronogramme from './RattrapageChronogramme';
import RattrapageEmploi from './RattrapageEmploi';
import { grouperParFormateur } from './regroupement';
import OngletStagiaires from './stagiaires/OngletStagiaires';
import { recupererSession } from '@/features/auth/api';
import ListeRepliable from './ListeRepliable';

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
 * ⚠️ `voitChronogramme` : l'onglet Chronogramme de la modale n'est plus qu'une
 * LECTURE (décision B du porteur) — consulter suffit.
 */
const DroitsAbsences = createContext({ lectureSeule: false, peutPlacer: false, voitChronogramme: false });

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
  const [onglet, setOnglet] = useState(null);
  const actif = onglet ?? (voitFormateurs ? 'formateurs' : 'stagiaires');

  return (
    <>
      <EnTetePartage page="absences" clesARelire={[['absences'], ['absences-stagiaires']]} />
      <CadreReglage titre="Absences" large={actif === 'stagiaires'} chargement={session.isLoading}>
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
  const [filtre, setFiltre] = useState('toutes');

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

  const absences = registre.data?.absences ?? [];
  const enAttente = absences.filter((absence) => !absence.dateRattrapage).length;

  const { droitSur } = usePartagesAvecMoi();
  const lectureSeule = !droitSuffit(droitSur('absences'), 'modifier');
  const droits = {
    lectureSeule,
    peutPlacer: !lectureSeule && droitSuffit(droitSur('emploi'), 'modifier'),
    voitChronogramme: droitSuffit(droitSur('chronogramme'), 'consulter'),
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
            Ouvrez la case de la séance et choisissez « Marquer absent » dans la liste des salles. Elle
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
            <div className="space-y-4">
              {formateur.jours.map((groupe, rang) => (
                <BlocJourAbsence
                  key={groupe.cle}
                  groupe={groupe}
                  enCours={enregistrer.isPending}
                  onEnregistrer={(id, champs) => enregistrer.mutate({ id, champs })}
                  separe={rang > 0}
                />
              ))}
            </div>
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
 * Le détail d'UN jour d'absence, dans la fiche dépliée d'un formateur.
 * ← le corps de l'ancienne carte groupée par jour (2026-08-26), passé par la
 * modale (2026-09-03) puis sous l'en-tête de la fiche (2026-09-14) — la MÊME
 * saisie à chaque fois.
 *
 * ═══ ⚠️ GROUPÉ, MAIS PAS FUSIONNÉ ═══
 * Trois créneaux d'affilée sont un seul bloc — on ne relit pas trois fois le
 * même nom, la même date, le même groupe — mais CHAQUE CRÉNEAU garde son
 * observation et sa date de rattrapage, parce que chacun vaut 2,5 h à
 * reprendre et peut être rattrapé un autre jour. Les écritures restent
 * indépendantes.
 */
function BlocJourAbsence({ groupe, enCours, onEnregistrer, separe }) {
  // Dans l'ordre de la journée, comme l'agenda — le registre arrive du plus récent.
  const entrees = [...groupe.entrees].sort((a, b) => String(a.seance).localeCompare(String(b.seance)));

  return (
    <div className={cn('space-y-2', separe && 'pt-2')}>
      {/* L'en-tête du jour de l'agenda : le jour en capitales, puis la date. */}
      <p className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide">{entrees[0]?.jour}</span>
        <span className="tabular-nums text-muted-foreground">{jourMois(groupe.dateAbsence)}</span>
        <span className="text-muted-foreground">· {libelleSemaine(groupe.semaine, { court: true })}</span>
      </p>
      <div className="space-y-3">
        {entrees.map((absence) => (
          <CarteAbsence key={absence.id} absence={absence} enCours={enCours} onEnregistrer={onEnregistrer} />
        ))}
      </div>
    </div>
  );
}

/**
 * ═══ UN CRÉNEAU D'ABSENCE, EN CARTE D'AGENDA ═══ (2026-09-17, demande du
 * porteur : « comme les cartes de Mon emploi du temps, avec le motif et le bouton
 * de rattrapage dedans, pour la cohérence ».) Cercle d'état, horaire officiel
 * barré, durée, badge « Absence », puis groupe / module (code et nom complet) /
 * salle — ce sont les pièces EXPORTÉES de `VueAgenda`, pas une recopie : une
 * absence se lit ici exactement comme dans l'agenda du formateur.
 *
 * ⚠️ UNE CARTE PAR CRÉNEAU, jamais fusionnée comme dans l'agenda : chacun garde
 * SON motif et SON rattrapage (2,5 h à reprendre chacun).
 * ⚠️ SANS l'`opacity-80` de la carte d'agenda : elle porte ici un champ et un
 * bouton, qu'un voile ferait paraître désactivés.
 * ⚠️ Rattrapée, le cercle porte une coche — mais RESTE ROUGE (demande du
 * porteur, 2026-09-17), la teinte de la carte.
 */
function CarteAbsence({ absence, enCours, onEnregistrer }) {
  const style = STYLES_AGENDA.absente;
  const rattrapee = Boolean(absence.dateRattrapage);
  const { debut, fin } = horaireCreneau(absence.jour, absence.seance);
  const duree = formatterDuree(dureeSeance(absence.seance));
  const bloc = {
    absente: true,
    autreSujet: absence.groupe,
    module: absence.module,
    salle: absence.salle,
    aDistance: absence.salle === 'TEAMS',
  };

  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border',
          // Toujours rouge (2026-09-17, demande du porteur) : la coche dit
          // « rattrapée », la couleur reste celle de l'absence.
          style.cercle
        )}
      >
        {rattrapee ? <Check className="size-4" /> : <Clock className="size-4" />}
      </div>

      <div className="min-w-0 flex-1 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-bold line-through', style.texte)}>
              {formatterHeure(debut)} – {formatterHeure(fin)}
            </span>
            {duree && (
              <span className={cn('rounded-full border bg-background px-2 py-0.5 text-[0.7rem] font-medium', style.texteDoux)}>
                {duree}
              </span>
            )}
            <span className="text-[0.7rem] text-muted-foreground">{absence.seance}</span>
          </div>
          <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold', style.badge)}>Absence</span>
        </div>

        <ContenuSeance bloc={bloc} axe="formateur" intitule={absence.moduleIntitule} style={style} />

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-destructive/15 pt-3">
          <div className="min-w-48 flex-1">
            <ChampObservation absence={absence} onEnregistrer={(champs) => onEnregistrer(absence.id, champs)} />
          </div>
          <RattrapagePlacement
            absence={absence}
            enCours={enCours}
            onEnregistrer={(champs) => onEnregistrer(absence.id, champs)}
          />
        </div>
      </div>
    </div>
  );
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
 * ⚠️ SANS DROIT DE PLACER — ou sans matricule, aucune ligne à isoler — il reste
 * la saisie de la date d'avant. Un rattrapage déjà PLACÉ ne s'y modifie pas :
 * le serveur refuserait une date qui contredit sa séance.
 */
function RattrapagePlacement({ absence, enCours, onEnregistrer }) {
  const { peutPlacer, voitChronogramme } = useContext(DroitsAbsences);
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState('emploi');
  const [choisi, setChoisi] = useState(null);
  const posee = absence.rattrapage ?? null;

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

  const enCoursEcriture = placer.isPending || annuler.isPending;
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
              <RattrapageChronogramme absence={absence} choisi={choisi} />
            ) : (
              <RattrapageEmploi absence={absence} choisi={choisi} onChoisir={setChoisi} />
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t pt-3">
            <EtatRattrapage choisi={choisi} posee={posee} absence={absence} />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {choisi && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={enCoursEcriture}
                  onClick={() => setChoisi(null)}
                >
                  Abandonner ce choix
                </Button>
              )}
              {posee && !choisi && (
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
                disabled={!choisi || enCoursEcriture}
                onClick={() => placer.mutate()}
              >
                {placer.isPending ? 'Enregistrement…' : 'Enregistrer le rattrapage'}
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
function EtatRattrapage({ choisi, posee, absence }) {
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
          {!choisi.salleDOrigine && absence.salle ? ` — ${absence.salle} est prise, autre salle libre` : ''}
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
      Aucun rattrapage placé. Cliquez sur une case libre de l’emploi du temps.
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
