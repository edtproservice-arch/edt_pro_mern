import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CircleAlert, Search } from 'lucide-react';
/*
 * ⚠️ `JOURS` VIENT DES CONSTANTES : les SIX jours ouvrés. Le domaine en
 * ré-exportait un second de sept jours, et cette page s'appuyait dessus sans le
 * savoir — le dimanche étant déjà exclu du calendrier, l'écart ne se voyait pas.
 * Le doublon a été renommé.
 */
import { JOURS } from 'shared/constants';
import {
  SEANCES_JOUR,
  anneeDuNomGroupe,
  dateRentree,
  droitSuffit,
  surveillantsPossibles,
  valeurSemaine,
} from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Alerte from '@/components/common/Alerte';
import {
  LegendeCalendrier,
  useDecorationCalendrier,
} from '@/components/common/decorationCalendrier';
import {
  chargerContexte,
  chargerModulesRegionaux,
  chargerSemaine,
  planifierEfm,
} from '@/features/emploi/api';
import { chargerCalendrierNational } from '@/features/calendrierNational/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { useAnneeActive } from '@/lib/anneeActive';
import { cn } from '@/lib/utils';
import CadreReglage from './CadreReglage';

/**
 * EFM régional (F13).
 * ← `api/profile/save_efm_regional.php` + le panneau `#panel-efm` de
 *   profile.html + `initEFMLogic()` de profil-dialogues.js
 *
 * ═══ CE QUE FAIT CET ÉCRAN ═══
 * Il ne DÉCLARE pas qu'un module est régional — `estRegional` vient de la base
 * e-note. Il PLANIFIE l'examen : groupe, module régional, date, salle,
 * créneaux, surveillants. L'enregistrement pose une séance de surveillance pour
 * CHAQUE surveillant sur CHAQUE créneau.
 *
 * ⚠️ PAS D'ENREGISTREMENT AUTOMATIQUE ICI, contrairement aux autres écrans de
 * réglages. Ceux-là modifient un réglage ; celui-ci ÉCRIT DANS L'EMPLOI DU
 * TEMPS. Une planification à moitié saisie qui partirait toute seule poserait
 * des séances qu'il faudrait ensuite retrouver pour les retirer.
 */
export default function PageEfmRegional() {
  const cache = useQueryClient();
  const annee = useAnneeActive();
  /*
   * ⚠️ UN INVITÉ « PEUT CONSULTER » COMPOSE, IL NE PLANIFIE PAS (étape d2) : il
   * peut chercher quels surveillants sont libres un jour donné — c'est ce qu'il
   * vient voir — mais l'écriture reste au directeur et aux invités « peut
   * modifier ». Le serveur la refuse de toute façon.
   */
  const { droitSur } = usePartagesAvecMoi();
  const peutPlanifier = droitSuffit(droitSur('efm'), 'modifier');

  const [groupe, setGroupe] = useState('');
  const [module, setModule] = useState('');
  const [salle, setSalle] = useState('');
  const [date, setDate] = useState(null);
  const [creneaux, setCreneaux] = useState([]);
  const [surveillants, setSurveillants] = useState([]);
  const [filtre, setFiltre] = useState('');
  const [refus, setRefus] = useState(null);

  const contexte = useQuery({
    queryKey: ['emploi', 'contexte'],
    queryFn: chargerContexte,
    retry: false,
  });

  const semaine = date ? valeurSemaine(date) : null;

  /*
   * ⚠️ LA SEMAINE VISÉE, PAS TOUTE L'ANNÉE. La disponibilité d'un surveillant se
   * lit sur SON créneau : charger l'année entière pour répondre à une question
   * qui porte sur quatre cases serait le défaut de l'existant, qui chargeait la
   * grille complète dans le navigateur.
   */
  const grille = useQuery({
    queryKey: ['emploi', 'semaine', semaine],
    queryFn: () => chargerSemaine(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });

  const affectations = contexte.data?.affectations ?? [];
  const groupes = contexte.data?.groupes ?? [];
  const salles = contexte.data?.salles ?? [];
  const formateurs = contexte.data?.formateurs ?? [];

  /*
   * ⚠️ LES MODULES RÉGIONAUX VIENNENT DU SERVEUR, pas du calcul local sur les
   * affectations : lui seul peut y joindre l'INTITULÉ complet, qui se lit dans
   * la répartition DRIF. Le code seul — « M107 » — ne dit pas de quel examen il
   * s'agit.
   */
  const modulesRegionaux = useQuery({
    queryKey: ['emploi', 'modules-regionaux', groupe],
    queryFn: () => chargerModulesRegionaux(groupe),
    enabled: Boolean(groupe),
    retry: false,
  });

  const regionaux = modulesRegionaux.data?.modules ?? [];
  const titulaires = regionaux.find((m) => m.module === module)?.titulaires ?? [];

  /* Le jour de la semaine, en français — c'est la clé des séances. */
  const jour = date ? JOURS[(date.getDay() + 6) % 7] : null;

  const occupation = useMemo(() => {
    if (!jour) return [];
    return (grille.data?.seances ?? []).filter(
      (seance) => seance.jour === jour && seance.periode === 'jour'
    );
  }, [grille.data, jour]);

  const etats = useMemo(
    () => surveillantsPossibles(formateurs, { titulaires, creneaux }, occupation),
    [formateurs, titulaires, creneaux, occupation]
  );

  const terme = filtre.trim().toLowerCase();
  const visibles = etats.filter((etat) => etat.nom.toLowerCase().includes(terme));

  const enregistrement = useMutation({
    mutationFn: () =>
      planifierEfm(semaine, { groupe, module, salle, jour, creneaux, surveillants }),
    onSuccess: (bilan) => {
      setRefus(null);
      toast.success('EFM planifié', {
        description: `${bilan.posees} surveillance(s) posée(s) en ${bilan.semaine}.`,
      });
      /* La grille de l'emploi du temps doit relire : les séances viennent
         d'apparaître, et son cache ne le sait pas. */
      cache.invalidateQueries({ queryKey: ['emploi'] });
      setCreneaux([]);
      setSurveillants([]);
    },
    onError: (erreur) => {
      /*
       * ⚠️ LES CONFLITS RESTENT DANS LA PAGE, pas dans un toast. Ils se lisent en
       * regard de la liste des surveillants pour comprendre lequel corriger — et
       * un message qui disparaît ne le permet pas.
       */
      /*
       * ⚠️ LE TITRE SUIT LA CAUSE. Un « Ce créneau est déjà occupé » figé
       * s'affichait aussi sur une panne réseau — et envoyait chercher un
       * conflit qui n'existe pas.
       */
      setRefus({
        titre: erreur.details?.length ? 'Ce créneau est déjà occupé' : 'EFM non planifié',
        motifs: erreur.details ?? [{ message: erreur.message }],
      });
      toast.error('EFM non planifié');
    },
  });

  const anneeCalendrier = annee ?? contexte.data?.anneeScolaire;

  /*
   * ⚠️ LA MÊME DÉCORATION QUE LES STAGES ET LES FORMATIONS : français, jours
   * fériés, vacances, bornes de l'année. Sans elle le calendrier rendait
   * « September » et « Mo Tu We », et surtout ne disait pas qu'une date tombe un
   * férié ou en vacances — un examen y aurait été posé sans que rien ne
   * l'annonce.
   */
  /*
   * ⚠️ LA MÊME CLÉ DE CACHE que partout ailleurs : le calendrier national est
   * déjà chargé par les autres écrans, cette lecture ne coûte donc rien.
   */
  const calendrierNational = useQuery({
    queryKey: ['calendrier-national', anneeCalendrier],
    queryFn: () => chargerCalendrierNational(anneeCalendrier),
    enabled: Boolean(anneeCalendrier),
    retry: false,
  });

  const decoration = useDecorationCalendrier(anneeCalendrier);

  /*
   * ═══ ⚠️ ON NE PLANIFIE PAS UN EXAMEN AVANT LA RENTRÉE DU GROUPE ═══
   * (2026-09-03.) Le serveur le refuse ; sans ce garde, le refus n arrivait
   * qu APRÈS avoir choisi date, salle, créneaux et surveillants — tout un
   * formulaire à ressaisir. C est le même défaut que la grille de l emploi du
   * temps, corrigé le même jour.
   *
   * ⚠️ IL DÉPEND DU GROUPE CHOISI : tant qu il n en a pas, aucune date n est
   * gelée — les années de formation n ont pas la même rentrée, et fermer sur la
   * plus tardive interdirait des dates légitimes.
   */
  const rentreeDuGroupe = groupe
    ? dateRentree(anneeDuNomGroupe(groupe), calendrierNational.data?.rentrees ?? [])
    : null;

  const basculer = (liste, valeur, poser) =>
    poser(liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur]);

  const complet =
    groupe && module && salle && date && creneaux.length > 0 && surveillants.length > 0;

  return (
    <>
      {/* L'occupation vient de l'emploi du temps : toute séance posée ailleurs la change. */}
      <EnTetePartage page="efm" clesARelire={[['emploi']]} />
      <CadreReglage
        titre="EFM régional"
        chargement={contexte.isLoading}
        erreur={contexte.isError ? contexte.error.message : null}
      >
        {/* <Alerte type="info" titre="Planifiez un examen régional et sa surveillance">
          Chaque surveillant retenu recevra une séance sur les créneaux choisis. Seuls les modules
          <strong> évalués au niveau régional</strong> sont proposés.
        </Alerte> */}

        {groupes.length === 0 ? (
          <Alerte type="avertissement" titre="Aucun groupe dans la base">
            Importez votre base e-note ou construisez votre carte depuis « Paramètres → Affectations ».
          </Alerte>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            {/* ── L'examen ───────────────────────────────────────────────── */}
            <div className="space-y-4">
              <Champ libelle="Groupe">
                <Select
                  value={groupe}
                  onValueChange={(valeur) => {
                    setGroupe(valeur);
                    /* ⚠️ Changer de groupe OUBLIE le module : il appartenait à
                       l'autre groupe, et le serveur le refuserait. */
                    setModule('');
                    setSurveillants([]);
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Choisir un groupe…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {groupes.map((nom) => (
                      <SelectItem key={nom} value={nom}>
                        {nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Champ>

              <Champ libelle="Module régional">
                <Select value={module} onValueChange={setModule} disabled={!groupe}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue
                      placeholder={groupe ? 'Choisir un module…' : 'Choisir un groupe d’abord'}
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {regionaux.map((fiche) => (
                      <SelectItem key={fiche.module} value={fiche.module}>
                        {/*
                          ⚠️ LE CODE, PUIS L'INTITULÉ. Le code est ce qu'on
                          retrouve dans la grille et sur les documents ; l'intitulé
                          est ce qui permet de reconnaître l'examen. Le code seul
                          obligeait à ouvrir la carte d'affectations pour savoir de
                          quoi il s'agit.
                        */}
                        <span className="font-medium">{fiche.module}</span>
                        {fiche.intitule && (
                          <span className="ml-2 text-muted-foreground">{fiche.intitule}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* ⚠️ LE CAS VIDE ENVOIE AU BON ENDROIT : « régional » est une
                    colonne de la base e-note, elle ne se règle pas ici. */}
                {groupe && !modulesRegionaux.isLoading && regionaux.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Aucun module régional pour ce groupe. Le caractère régional vient de la base
                    e-note — il ne se déclare pas sur cet écran.
                  </p>
                )}
              </Champ>

              <Champ libelle="Date">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-full justify-start gap-2 text-sm font-normal">
                      <CalendarDays className="size-4 text-muted-foreground" />
                      {date
                        ? date.toLocaleDateString('fr-FR', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                          })
                        : 'Choisir une date…'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto space-y-2 p-2" align="start">
                    <Calendar
                      mode="single"
                      selected={date ?? undefined}
                      onSelect={(choix) => {
                        setDate(choix ?? null);
                        setSurveillants([]);
                      }}
                      {...decoration}
                      /*
                        ⚠️ ET PAS LE DIMANCHE : la grille ne porte que six jours
                        (`JOURS`), un examen posé là n'apparaîtrait nulle part.
                        La borne d'année vient de la décoration ; on ajoute la
                        nôtre plutôt que de la remplacer.
                      */
                      disabled={[
                        ...(decoration.disabled ?? []),
                        { dayOfWeek: [0] },
                        // Avant la rentrée du groupe : le serveur refuserait.
                        ...(rentreeDuGroupe
                          ? [{ before: new Date(`${rentreeDuGroupe}T12:00:00`) }]
                          : []),
                      ]}
                      defaultMonth={date ?? decoration.startMonth}
                    />

                    <LegendeCalendrier />
                  </PopoverContent>
                </Popover>
                {semaine && (
                  <p className="text-xs text-muted-foreground">
                    Semaine {semaine.split('-W')[1]} de l’année scolaire.
                  </p>
                )}
              </Champ>

              <Champ libelle="Salle">
                <Select value={salle} onValueChange={setSalle}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Choisir une salle…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {salles.map((nom) => (
                      <SelectItem key={nom} value={nom}>
                        {nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Champ>

              <Champ libelle="Créneaux">
                <div className="flex gap-2">
                  {SEANCES_JOUR.map((creneau) => (
                    <Button
                      key={creneau}
                      type="button"
                      variant={creneaux.includes(creneau) ? 'default' : 'outline'}
                      size="sm"
                      aria-pressed={creneaux.includes(creneau)}
                      className="h-8 flex-1 text-xs"
                      onClick={() => basculer(creneaux, creneau, setCreneaux)}
                    >
                      {creneau}
                    </Button>
                  ))}
                </div>
              </Champ>
            </div>

            {/* ── Les surveillants ───────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  Surveillants
                  {surveillants.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {surveillants.length} retenu(s)
                    </span>
                  )}
                </h3>

                {formateurs.length > 12 && (
                  <div className="relative w-56">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={filtre}
                      onChange={(evenement) => setFiltre(evenement.target.value)}
                      placeholder="Filtrer…"
                      className="h-8 pl-7 text-xs"
                    />
                  </div>
                )}
              </div>

              {/*
                ⚠️ LA DISPONIBILITÉ NE SE LIT QU'UNE FOIS LA DATE ET LES CRÉNEAUX
                CHOISIS. Avant, tout le monde paraîtrait libre — ce qui serait faux
                plutôt que neutre.
              */}
              {(!date || creneaux.length === 0) && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Choisissez une date et au moins un créneau : la disponibilité de chacun s’affichera
                  alors.
                </p>
              )}

              <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {visibles.map((etat) => (
                  <LigneSurveillant
                    key={etat.matricule}
                    etat={etat}
                    choisi={surveillants.includes(etat.matricule)}
                    disponibiliteConnue={Boolean(date) && creneaux.length > 0}
                    onBasculer={() => basculer(surveillants, etat.matricule, setSurveillants)}
                  />
                ))}
              </div>

              {visibles.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {formateurs.length === 0
                    ? 'Aucun formateur dans la base.'
                    : 'Aucun formateur ne correspond à ce filtre.'}
                </p>
              )}

              {/*
                ⚠️ LE REFUS RESTE DANS LA PAGE. Il nomme chaque créneau qui bloque,
                et se recoupe avec la liste au-dessus — ce qu'un toast ne permet
                pas.
              */}
              {refus && (
                <Alerte type="erreur" titre={refus.titre}>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {refus.motifs.map((detail, rang) => (
                      <li key={rang}>{detail.message}</li>
                    ))}
                  </ul>
                </Alerte>
              )}

              {peutPlanifier ? (
                <div className="flex justify-end border-t pt-3">
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!complet || enregistrement.isPending}
                    onClick={() => enregistrement.mutate()}
                  >
                    {enregistrement.isPending ? 'Planification…' : 'Planifier l’EFM'}
                  </Button>
                </div>
              ) : (
                <p className="border-t pt-3 text-right text-xs text-muted-foreground">
                  Vous pouvez consulter les disponibilités, pas planifier l’examen.
                </p>
              )}
            </div>
          </div>
        )}
      </CadreReglage>
    </>
  );
}

const Champ = ({ libelle, children }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold">{libelle}</Label>
    {children}
  </div>
);

/**
 * Un surveillant possible, et pourquoi il ne l'est pas.
 *
 * ⚠️ TROIS ÉTATS, PAS DEUX. « Titulaire du module » n'est pas une occupation :
 * c'est une règle — le formateur du module ne surveille pas son propre examen.
 * Les confondre ferait chercher quel cours l'en empêche.
 *
 * ⚠️ FIGÉ, PAS MASQUÉ, comme les options de la grille : une entrée qui
 * disparaît laisse chercher pourquoi la personne n'est plus proposée.
 */
function LigneSurveillant({ etat, choisi, disponibiliteConnue, onBasculer }) {
  const bloque = etat.statut === 'titulaire' || etat.statut === 'occupe';

  return (
    <Label
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-normal transition-colors',
        bloque
          ? 'cursor-not-allowed bg-muted/60 text-muted-foreground'
          : 'cursor-pointer hover:bg-muted',
        choisi && !bloque && 'border-primary/40 bg-primary/5'
      )}
    >
      <Checkbox checked={choisi && !bloque} disabled={bloque} onCheckedChange={onBasculer} />
      <span className="min-w-0 flex-1 truncate">{etat.nom}</span>

      {etat.statut === 'titulaire' && (
        <Badge variant="outline" className="shrink-0 gap-1 text-[0.6rem]">
          <CircleAlert className="size-3" />
          Titulaire
        </Badge>
      )}

      {etat.statut === 'occupe' && (
        <span className="shrink-0 truncate text-[0.6rem]" title={etat.motif}>
          {etat.motif}
        </span>
      )}

      {etat.statut === 'libre' && disponibiliteConnue && (
        <span className="shrink-0 text-[0.6rem] text-success">Libre</span>
      )}
    </Label>
  );
}
