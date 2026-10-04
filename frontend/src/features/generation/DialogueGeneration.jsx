import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Settings2, Sparkles, Telescope } from 'lucide-react';
import { toast } from 'sonner';

import { MOTEURS } from 'shared/constants';
import { libelleSemaine } from 'shared/domain';

import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ThinkingOrb } from 'thinking-orbs';

import { chargerSemainesFigees, generer, previsualiser } from './api';
import RapportGeneration from './RapportGeneration';
import {
  bilanRemplacement,
  dureeMaximale,
  FIN_SEMESTRE_1,
  raccourci,
  semainesDeLAnnee,
  valeurDe,
} from './selectionSemaines';

/**
 * Génération automatique — sélection, lancement, rapport.
 * ← la modale `#autoGenModal` de emploi.html
 *
 * ═══ ⚠️ LES CONTRAINTES DES FORMATEURS NE SE SAISISSENT PAS ICI ═══
 * L'ancienne modale portait un tableau complet — heures, séances TEAMS, salles,
 * créneaux indisponibles — lu directement depuis le DOM au moment de générer.
 * Ces réglages vivent désormais dans « Paramètres → Formateurs », où ils sont
 * PERSISTÉS et partagés avec la grille (salle proposée d'office, créneaux à
 * éviter signalés). Les rééditer ici en ferait un second jeu à tenir cohérent —
 * la cause n°1 d'instabilité du §4.2. On y renvoie, on ne les recopie pas.
 */
/** Le motif d'une semaine figée, tel que la case le dit. */
const LIBELLES_FIGEE = { vacances: 'vacances', ferie: 'fériés' };

export default function DialogueGeneration({ ouvert, onOuvrir, anneeScolaire, semainesExistantes }) {
  const cache = useQueryClient();

  const [selection, setSelection] = useState([]);
  const [progres, setProgres] = useState(null);
  const [rapport, setRapport] = useState(null);
  /*
   * ═══ ⚠️ LE GLOUTON PAR DÉFAUT, MÊME APRÈS UNE GÉNÉRATION APPROFONDIE ═══
   * Sept minutes contre une seconde : ce n'est pas un réglage qu'on laisse
   * traîner d'une fois sur l'autre. Le directeur qui veut chercher longtemps le
   * redemande ; celui qui corrige une semaine à la volée ne doit pas attendre
   * parce qu'il a coché la case le mois dernier.
   */
  const [moteur, setMoteur] = useState(MOTEURS.GLOUTON);

  const semaines = useMemo(
    () => semainesDeLAnnee(anneeScolaire, semainesExistantes),
    [anneeScolaire, semainesExistantes]
  );

  /*
   * ⚠️ REMISE À ZÉRO À CHAQUE OUVERTURE. Rouvrir sur le rapport de la veille
   *    ferait croire qu'une génération vient d'avoir lieu — et sur une
   *    sélection oubliée, on relancerait des semaines qu'on ne regardait pas.
   */
  useEffect(() => {
    if (!ouvert) return;
    setSelection([]);
    setProgres(null);
    setRapport(null);
    setMoteur(MOTEURS.GLOUTON);
  }, [ouvert]);

  /*
   * ═══ LES SEMAINES FIGÉES (2026-10-03, demande du porteur) ═══
   * Vacances, ou fériés sur tous les jours : elles ne se cochent pas, et les
   * raccourcis les sautent. Le serveur les ignore de toute façon — la case
   * grisée dit seulement d'avance ce qu'il ferait.
   */
  const figees = useQuery({
    queryKey: ['generation', 'semaines-figees', anneeScolaire],
    queryFn: chargerSemainesFigees,
    enabled: ouvert,
    staleTime: 60_000,
  });
  const motifFige = useMemo(
    () =>
      new Map(
        (figees.data?.semaines ?? []).map(({ numero, motif }) => [
          valeurDe(anneeScolaire, numero),
          motif,
        ])
      ),
    [figees.data, anneeScolaire]
  );

  const apercu = useQuery({
    queryKey: ['generation', 'previsualisation', selection],
    queryFn: () => previsualiser(selection),
    enabled: ouvert && selection.length > 0,
    staleTime: 30_000,
  });

  const bilan = bilanRemplacement(apercu.data?.semaines ?? [], selection);

  const lancer = useMutation({
    mutationFn: ({ cibles, assouplissement, moteur: demande = moteur }) =>
      generer(
        { semaines: cibles, assouplissement, moteur: demande },
        { onProgres: (etape) => setProgres(etape) }
      ),
    /*
     * ═══ ⚠️ LE TOAST PART AU DÉMARRAGE, PAS À L'OUVERTURE DE LA FENÊTRE ═══
     * (2026-09-22) `onMutate` s'exécute juste avant l'appel : c'est l'instant
     * exact où l'écran d'attente apparaît. Plus tôt — à l'ouverture de la
     * modale — la phrase serait FAUSSE : il n'y a encore aucune génération à
     * ne pas arrêter, et le directeur n'a même pas choisi ses semaines.
     *
     * ⚠️ IL REMPLACE UN ENCART QUI OCCUPAIT L'ÉCRAN EN PERMANENCE. Une consigne
     *    qu'on lit une fois n'a pas à rester affichée un quart d'heure : le
     *    toast la donne au bon moment, puis s'efface.
     */
    onMutate: ({ moteur: demande = moteur }) => {
      toast.info('Fermer cette fenêtre n’arrêterait pas la génération.', {
        description:
          demande === MOTEURS.CPSAT
            ? 'Recherche approfondie : comptez une vingtaine de secondes par semaine incomplète.'
            : undefined,
        /*
         * ⚠️ PLUS LONG QUE LE DÉFAUT : la génération dure des minutes, et cette
         *    phrase est la seule qui dise au directeur qu'il peut partir. Quatre
         *    secondes suffisent à la manquer en regardant ailleurs.
         */
        duration: 8000,
      });
    },
    onSuccess: async (resultat) => {
      setRapport(resultat);
      setProgres(null);
      /*
       * ⚠️ TOUT LE CACHE, comme partout dans ce projet depuis le 2026-08-26 :
       *    la génération touche les séances, donc l'avancement, les absences et
       *    le chronogramme. Nommer les clés une à une, c'est en oublier une.
       */
      await cache.invalidateQueries();
      /*
       * ⚠️ ON ANNONCE CE QUE CP-SAT A RÉELLEMENT AMÉLIORÉ, PAS CE QU'ON LUI A
       *    DEMANDÉ. Mesuré sur l'année réelle : lancé sur 20 semaines, il n'en
       *    a amélioré que 9. Dire « recherche approfondie » sur les 45 ferait
       *    croire que les 45 sont optimales.
       */
      const ameliorees = resultat.total?.ameliorees ?? 0;
      toast.success(
        `${resultat.total.placees} séance(s) posée(s)` +
          (ameliorees > 0 ? ` · ${ameliorees} semaine(s) améliorée(s) par la recherche` : '')
      );
    },
    onError: (erreur) => {
      setProgres(null);
      toast.error(erreur.message ?? 'La génération a échoué');
    },
  });

  const basculer = (valeur) => {
    if (motifFige.has(valeur)) return;
    setSelection((actuelle) =>
      actuelle.includes(valeur)
        ? actuelle.filter((autre) => autre !== valeur)
        : [...actuelle, valeur]
    );
  };

  const enCours = lancer.isPending;
  const attente = dureeMaximale(selection.length, moteur);
  const approfondie = moteur === MOTEURS.CPSAT;

  return (
    <Dialog open={ouvert} onOpenChange={enCours ? undefined : onOuvrir}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Génération automatique</DialogTitle>
          <DialogDescription>
            Les séances sont placées d’après le chronogramme de chaque groupe, dans le respect des
            conflits, des salles et du calendrier.
          </DialogDescription>
        </DialogHeader>

        {/* ⚠️ `min-h-0` : sans lui, un enfant de flex refuse de devenir plus
            court que son contenu et la boîte déborde au lieu de défiler. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {rapport ? (
            <RapportGeneration
              rapport={rapport}
              onRelancer={(cibles, assouplissement, demande) => {
                setRapport(null);
                lancer.mutate({ cibles, assouplissement, moteur: demande ?? moteur });
              }}
            />
          ) : enCours ? (
            <div className="space-y-3 py-6">
              {/*
                ═══ ⚠️ UN ORBE PLUTÔT QU'UNE BARRE ═══ (2026-09-22, demande du porteur)
                `ThinkingOrb` est un canevas 2D sans dépendance, `prefers-reduced-motion`
                respecté et `theme="auto"` qui lit la classe `dark` de Tailwind — la
                convention de ce projet. Il dit « ça travaille », mieux qu'une barre qui
                n'avance que toutes les vingt secondes.

                ⚠️ CE QU'IL NE DIT PAS : **l'avancement**. Une génération d'année compte
                   45 paliers ; le chiffre juste en dessous reste donc la seule mesure
                   du chemin parcouru, et c'est lui qu'il ne faut pas retirer.
              */}
              {/*
                ⚠️ UN FOND SOUS L'ORBE : sur le blanc pur du design system, une
                   constellation de points fins se lit mal — c'est le
                   signalement du porteur. Le disque `bg-muted` lui donne le
                   contraste qui manquait, sans introduire de surface nouvelle :
                   c'est déjà la couleur des surfaces secondaires du projet.
              */}
              <div className="flex justify-center">
                {/*
                  ═══ ⚠️ LE MÊME BLEU QUE L'ENCART INFO, ET C'EST VOULU ═══
                  `bg-primary/5` est exactement le fond de `Alerte type="info"`
                  juste en dessous : les deux surfaces de cet écran d'attente
                  partagent donc une seule teinte, au lieu d'en juxtaposer deux.

                  ⚠️⚠️ **LE GLOBE NE PEUT PAS ÊTRE BLANC ICI.** Le porteur l'avait
                     demandé ; rendu au navigateur, un globe blanc sur 5 % est un
                     FANTÔME — on devine un disque, pas une animation. Mesuré sur
                     l'échelle complète : le blanc tient jusqu'à 55 %, se délave
                     à 40 %, disparaît à 25 %. Sur un fond aussi pâle, l'encre
                     doit être le bleu plein.
                */}
                <div className="rounded-full bg-primary/5 p-5">
                <ThinkingOrb
                  /*
                   * ⚠️ `solving` — LE GLOBE À BANDES, choisi sur pièce (2026-09-22).
                   *    Les neuf états ont été rendus DANS cet habillage (disque bleu
                   *    clair, encre blanche) avant de trancher : `connecting`, essayé
                   *    d'abord, est le plus MAIGRE des neuf — beaucoup de vide, peu
                   *    de matière, et sur un disque plein il paraissait creux.
                   *
                   * ⚠️ NE PAS SE FIER AUX VIGNETTES DE LA DÉMO DU PAQUET : elles
                   *    étiquettent « Solving.... » des orbes qui ne sont pas
                   *    `solving`. Le libellé y est décoratif. Se décider sur le
                   *    RENDU, jamais sur le mot.
                   */
                  state="solving"
                  size={64}
                  /*
                   * ⚠️ LE BLEU `primary`, PAS UNE COULEUR DE PLUS. Le design
                   *    system n'admet qu'un seul bleu structurel ; la valeur
                   *    est reprise de `globals.css` (`--primary`, #0075de).
                   *    ⚠️ LA LIBRAIRIE ATTEND UN `#rrggbb` LITTÉRAL : elle
                   *    peint sur un canevas, où `hsl(var(--primary))` ne
                   *    résout pas — une variable CSS n'existe pas pour
                   *    `ctx.fillStyle`. La valeur est donc RECOPIÉE ici, et
                   *    c'est la seule de tout le front dans ce cas.
                   *
                   *    ⚠️ CONSÉQUENCE SI LE THÈME SOMBRE EST UN JOUR ACTIVÉ :
                   *    `globals.css` y définit un bleu plus CLAIR
                   *    (`--primary: 209 100% 55%`, #4aa3ff), et c'est lui qu'il
                   *    faudra — vérifié au navigateur, #0075de passe sur fond
                   *    sombre mais se lit nettement moins bien. Aucun sélecteur
                   *    de thème n'existe aujourd'hui dans l'application : une
                   *    détection maison reproduirait celle que la librairie
                   *    fait déjà pour son gris, pour un mode qui n'existe pas.
                   */
                  color="#0075de"
                  aria-label={
                    progres
                      ? `Génération en cours, semaine ${progres.rang} sur ${progres.total}`
                      : 'Génération en cours'
                  }
                />
                </div>
              </div>
              {/*
                ⚠️ SCINTILLANT PARCE QUE LA DURÉE EST INCONNUE : entre deux
                   paliers, une semaine prend une vingtaine de secondes et rien
                   ne bouge. Le balayage dit « ça travaille » sans prétendre
                   mesurer — le chiffre « 3 sur 45 », lui, mesure.
              */}
              {/*
                ⚠️ LE SCINTILLEMENT VA DU BLEU PÂLE AU BLEU PLEIN, pas au noir :
                   sur un écran dominé par le disque bleu, un éclat sombre
                   jurait. Les deux teintes sont surchargées au point d'usage —
                   c'est la même animation que partout ailleurs, pas une copie.
              */}
              <p className="text-center text-base font-medium texte-scintillant [--scintille-base:var(--primary)/0.45] [--scintille-eclat:var(--primary)]">
                {progres
                  ? `Semaine ${libelleSemaine(progres.semaine, { court: true })} — ${progres.rang} sur ${progres.total}`
                  : 'Préparation…'}
              </p>
              {/*
                ⚠️ PLUS D'ENCART ICI : ces deux consignes sont parties dans un
                   TOAST, déclenché au démarrage (voir `onMutate`). Elles se
                   lisent une fois ; les laisser affichées pendant tout le calcul
                   pesait autant que l'orbe et encombrait l'écran pour rien.
              */}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  ['semestre1', `Semestre 1 (S1–S${FIN_SEMESTRE_1})`],
                  ['semestre2', `Semestre 2 (S${FIN_SEMESTRE_1 + 1}–S45)`],
                  ['tout', 'Toute l’année'],
                ].map(([cle, libelle]) => (
                  <Button
                    key={cle}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setSelection(
                        raccourci(cle, anneeScolaire).filter((valeur) => !motifFige.has(valeur))
                      )
                    }
                  >
                    {libelle}
                  </Button>
                ))}
                {selection.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelection([])}
                  >
                    Tout décocher
                  </Button>
                )}
              </div>

              <div className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto rounded-md border p-2 sm:max-h-none sm:grid-cols-5 sm:overflow-visible">
                {semaines.map((semaine) => {
                  const motif = motifFige.get(semaine.valeur);
                  return (
                  <label
                    key={semaine.valeur}
                    title={motif ? `Semaine figée : ${LIBELLES_FIGEE[motif] ?? 'fermée'}` : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded px-1.5 py-1 text-xs',
                      motif ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'
                    )}
                  >
                    <Checkbox
                      checked={selection.includes(semaine.valeur)}
                      disabled={Boolean(motif)}
                      onCheckedChange={() => basculer(semaine.valeur)}
                    />
                    <span className={cn('tabular-nums', motif && 'line-through')}>
                      S{semaine.numero}
                    </span>
                    {/*
                      ⚠️ CE QUE LA SEMAINE PORTE DÉJÀ, à côté de la case : c'est
                      ce qui sera remplacé. Sans ce nombre, on coche sans savoir.
                    */}
                    {motif ? (
                      <span className="text-[0.65rem] text-muted-foreground">
                        {LIBELLES_FIGEE[motif] ?? 'fermée'}
                      </span>
                    ) : (
                      semaine.seances > 0 && (
                        <span className="text-[0.65rem] text-muted-foreground">
                          ({semaine.seances})
                        </span>
                      )
                    )}
                  </label>
                  );
                })}
              </div>

              {bilan.remplacees > 0 && (
                <Alerte type="avertissement" titre="Des séances vont être remplacées">
                  <strong>{bilan.remplacees} séance(s)</strong> déjà posée(s) sur{' '}
                  {bilan.semainesTouchees} semaine(s) seront effacées et regénérées.
                  {bilan.preservees > 0 && (
                    <>
                      {' '}
                      {/*
                        ⚠️ CE QU'ON NE PERD PAS COMPTE AUTANT : sans cette
                        phrase, un directeur renoncerait à générer de peur de
                        détruire un examen planifié.
                      */}
                      Les <strong>{bilan.preservees}</strong> surveillance(s) d’EFM et
                      rattrapage(s) sont conservés.
                    </>
                  )}
                </Alerte>
              )}

              {/*
                ═══ ⚠️ LE CHOIX DU MOTEUR, ET POURQUOI IL EST À L'ÉCRAN ═══
                Mesuré sur l'année réelle (2026-09-21) : le glouton place
                98,70 % des séances en une seconde, CP-SAT 99,19 % en sept
                minutes. Vingt-sept séances contre quatre cents fois plus de
                temps — aucune des deux réponses n'est bonne dans l'absolu, elle
                dépend de ce que le directeur est en train de faire. Choisir à
                sa place, c'est se tromper la moitié du temps.
              */}
              <div className="rounded-md border p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <Telescope className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium">Recherche approfondie</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Reprend chaque semaine incomplète et cherche une meilleure grille.
                      Quelques séances de plus, beaucoup plus de temps.
                    </span>
                  </span>
                  <Switch
                    checked={approfondie}
                    onCheckedChange={(coche) =>
                      setMoteur(coche ? MOTEURS.CPSAT : MOTEURS.GLOUTON)
                    }
                    /* ⚠️ Sans nom explicite, le libellé ENTIER — description
                       comprise — devient le nom de l'interrupteur au lecteur
                       d'écran. Même raison qu'en avancement et en registre. */
                    aria-label="Activer la recherche approfondie"
                  />
                </label>
                {/*
                  ⚠️ LA DURÉE S'AFFICHE AVANT LE CLIC, PAS PENDANT L'ATTENTE.
                     C'est le seul moment où elle sert encore à décider.
                */}
                {attente && (
                  <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                    {selection.length} semaine(s) sélectionnée(s) — {attente}.
                  </p>
                )}
              </div>

              {(apercu.data?.groupesAbsents ?? []).length > 0 && (
                /*
                  ═══ ⚠️ LE CHRONOGRAMME A SURVÉCU À LA CARTE ═══ (2026-09-22)
                  Ces groupes n'apparaissent dans AUCUNE affectation — ils
                  n'existent pas dans la carte, pas même sans formateur.
                  Jusqu'ici ils arrivaient sous « aucun formateur ne leur est
                  affecté, corrigez la carte », et le directeur cherchait une
                  affectation pour des groupes introuvables. Mesuré sur l'année
                  réelle : les 39 cas signalés étaient TOUS de ce type — une
                  filière entière (GE…) que la carte ne porte plus.

                  ⚠️ LA CORRECTION EST L'INVERSE DE L'AUTRE : ici il faut
                     retirer ou renommer le CHRONOGRAMME, pas ajouter une
                     affectation.
                */
                <Alerte
                  type="avertissement"
                  titre="Des chronogrammes portent sur des groupes absents de la carte"
                >
                  <strong>{apercu.data.groupesAbsents.length} groupe(s)</strong> ont un
                  chronogramme mais n’apparaissent dans aucune affectation — ils
                  n’existent pas dans la carte. Leurs heures ne seront{' '}
                  <strong>jamais</strong> posées. Ce sont ces{' '}
                  <strong>chronogrammes</strong> qu’il faut retirer ou renommer, pas une
                  affectation à ajouter.
                  <ul className="mt-1.5 space-y-0.5">
                    {apercu.data.groupesAbsents.slice(0, 8).map((groupe) => (
                      <li key={groupe} className="text-xs">
                        {groupe}
                      </li>
                    ))}
                    {apercu.data.groupesAbsents.length > 8 && (
                      <li className="text-xs">
                        … et {apercu.data.groupesAbsents.length - 8} autre(s)
                      </li>
                    )}
                  </ul>
                </Alerte>
              )}

              {(apercu.data?.modulesSansAffectation ?? []).length > 0 && (
                /*
                  ═══ ⚠️ AVANT DE GÉNÉRER, PAS APRÈS ═══ (2026-09-22)
                  Un module que le chronogramme planifie mais qu'aucune
                  affectation ne porte ne devient jamais une tâche : ses heures
                  disparaissent sans même apparaître dans les « non placées »,
                  puisqu'on n'a jamais essayé de les poser. Le rapport le disait
                  déjà — mais après coup, quand le directeur cherche un réglage
                  qui n'existe pas. Mesuré : 39 couples sur l'année réelle.
                */
                <Alerte
                  type="avertissement"
                  titre="Des modules planifiés n’ont aucun formateur affecté"
                >
                  <strong>
                    {apercu.data.modulesSansAffectation.length} couple(s) groupe × module
                  </strong>{' '}
                  sont prévus au chronogramme sans affectation dans la carte. Leurs heures
                  ne seront <strong>jamais</strong> posées, quelle que soit la relance —
                  c’est la carte d’établissement qu’il faut corriger.
                  <ul className="mt-1.5 space-y-0.5">
                    {apercu.data.modulesSansAffectation.slice(0, 6).map((libelle) => (
                      <li key={libelle} className="text-xs">
                        {libelle}
                      </li>
                    ))}
                    {apercu.data.modulesSansAffectation.length > 6 && (
                      <li className="text-xs">
                        … et {apercu.data.modulesSansAffectation.length - 6} autre(s)
                      </li>
                    )}
                  </ul>
                </Alerte>
              )}

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Settings2 className="size-3.5 shrink-0" />
                <span>
                  Salles attribuées et indisponibilités se règlent dans{' '}
                  <Link
                    to="/app/parametres/formateurs"
                    className="underline underline-offset-2"
                    onClick={() => onOuvrir(false)}
                  >
                    Paramètres → Formateurs
                  </Link>
                  .
                </span>
              </p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {rapport ? (
            <Button onClick={() => onOuvrir(false)}>Fermer</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOuvrir(false)} disabled={enCours}>
                Annuler
              </Button>
              <Button
                onClick={() => lancer.mutate({ cibles: selection, assouplissement: {} })}
                disabled={selection.length === 0 || enCours}
              >
                <Sparkles className="size-4" />
                Générer {selection.length > 0 && `(${selection.length})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
