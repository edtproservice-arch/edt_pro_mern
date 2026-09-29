import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronDown, Circle, Lock, Network } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Button } from '@/components/ui/button';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { useEnregistrementAuto } from '@/components/common/enregistrementAuto';
import { recupererSession } from '@/features/auth/api';
import { chargerProgressionConfiguration, enregistrerNomAbrege } from './api';
import EtapeBase from './etapes/EtapeBase';
import EtapeNomAbrege from './etapes/EtapeNomAbrege';

/**
 * Verrou d'une page qui dépend d'étapes de la configuration restées à faire.
 * ← demande du porteur (2026-09-20) : « permettre de terminer la configuration, mais
 * qu'à l'entrée dans la session des pages comme l'emploi du temps soient verrouillées,
 * avec la liste des étapes qui ne sont pas terminées ».
 *
 * ═══ POURQUOI VERROUILLER LA PAGE ET NON LA SESSION ═══
 * Terminer une configuration incomplète ouvre l'application — sinon on ne pourrait pas y
 * finir ce qui manque : les pages de Paramètres restent libres, ce sont elles qui la
 * complètent. Seules les pages qui TRAVAILLENT sur ces données (l'emploi du temps sans
 * espace ni groupe, un avancement sans carte) sont fermées, avec dessous de quoi les
 * rouvrir : les étapes manquantes, chacune avec son lien.
 *
 * ⚠️ LE VERROU TIENT JUSQU'À CE QUE TOUTES LES ÉTAPES SOIENT FAITES (2026-09-20, demande du
 * porteur : « la carte doit disparaître si je termine toutes les étapes »). Une première
 * version n'exigeait de chaque page que SES étapes — l'emploi du temps s'ouvrait dès
 * espaces, formateurs et carte faits, alors que le nom abrégé restait à saisir, et la
 * liste disparaissait avant d'être vide. La liste montre toutes les étapes ; elle ne
 * s'efface que lorsqu'elles sont toutes cochées.
 *
 * ⚠️ RELU À CHAQUE OUVERTURE tant qu'il manque quelque chose : dès que l'étape est faite,
 * la page s'ouvre, sans recharger. Une configuration complète est mémorisée cinq minutes —
 * elle ne change plus, et interroger le serveur à chaque page pour rien coûterait cher.
 *
 * ⚠️ ELLE NE VAUT QUE POUR LE DIRECTEUR : la progression est la sienne (l'établissement
 * qu'il a configuré). Un gestionnaire, un formateur ou un invité ne configurent rien.
 * Et en cas d'ÉCHEC de la lecture (réseau), la page s'ouvre : mieux vaut une grille vide
 * un instant qu'un directeur enfermé par une coupure.
 */


/** Où compléter chaque étape : la page de Paramètres qui la porte, sinon l'assistant. */
const ETAPES = {
  identite: { titre: 'Nom abrégé', aide: 'Il figure sur les documents imprimés.', vers: '/configuration' },
  espaces: { titre: 'Espaces', aide: 'Au moins un espace où recevoir, en plus de TEAMS.', vers: '/app/parametres/espaces' },
  base: { titre: 'Point de départ', aide: 'Import de la base e-note, ou création de la carte.', vers: '/configuration' },
  formateurs: { titre: 'Formateurs', aide: 'Au moins un formateur.', vers: '/app/parametres/formateurs' },
  carte: { titre: 'Carte', aide: 'Au moins un groupe, généré depuis la répartition DRIF.', vers: '/app/parametres/carte' },
};

/** Ce qu'il faut relire dès qu'une étape vient d'être faite ici, sans quitter la page. */
function useRafraichirApresEtape() {
  const cache = useQueryClient();
  return () => {
    cache.invalidateQueries({ queryKey: ['configuration-progression'] });
    cache.invalidateQueries({ queryKey: ['etablissement-courant'] });
    cache.invalidateQueries({ queryKey: ['base'] });
    cache.invalidateQueries({ queryKey: ['base-resume'] });
  };
}

/**
 * ═══ LE NOM ABRÉGÉ SE SAISIT DANS LA LISTE, AVEC LE MÊME COMPOSANT QUE L'ASSISTANT ═══
 * (2026-09-20, demande du porteur : « sans retourner dans la page de configuration », puis
 * « utiliser le même composant ».) C'est `EtapeNomAbrege` lui-même : le nom officiel
 * rappelé, le champ, ses bornes et ses avertissements. Une seconde saisie recopiée ici
 * finirait par accepter ce que l'étape refuse.
 *
 * Il est PILOTÉ (`valeur` / `onChange`) : c'est ici qu'on l'enregistre, comme l'assistant —
 * 0,8 s après la dernière frappe, pas de bouton à oublier. Enregistré, l'étape se coche et
 * la page s'ouvre si c'était la dernière qui la retenait.
 */
function SaisieNomAbrege() {
  const rafraichir = useRafraichirApresEtape();
  const [nom, setNom] = useState('');
  const [enregistre, setEnregistre] = useState('');
  const [echec, setEchec] = useState(false);
  const valide = nom.trim().length >= 2 && nom.trim().length <= 30;

  const ecriture = useMutation({
    // ⚠️ Une fonction explicite : voir la note de `ConfigurationPage` sur le second argument
    // que TanStack Query passe à `mutationFn`.
    mutationFn: (valeur) => enregistrerNomAbrege(valeur),
    onSuccess: (_, valeur) => {
      setEnregistre(valeur);
      toast.success('Nom abrégé enregistré');
      rafraichir();
    },
    onError: (erreur) => {
      setEchec(true);
      toast.error('Enregistrement impossible', { description: erreur.message });
    },
  });

  // Un échec coupe l'automatisme (pas de martèlement) ; une nouvelle frappe le relance.
  const changer = useCallback((valeur) => {
    setEchec(false);
    setNom(valeur);
  }, []);

  useEnregistrementAuto({
    modifie: valide && nom.trim() !== enregistre && !echec,
    valeur: nom,
    onEnregistrer: () => ecriture.mutate(nom.trim()),
    repos: 800,
    enCours: ecriture.isPending,
  });

  return (
    <div className="mt-4">
      <EtapeNomAbrege valeur={nom} onChange={changer} />
    </div>
  );
}

/**
 * ═══ LE CHOIX DU POINT DE DÉPART SE FAIT DANS LA LISTE, AVEC LE MÊME COMPOSANT ═══
 * `EtapeBase` lui-même : les deux voies, le dépôt du fichier e-note et sa règle « une base
 * par semaine, remplacement demandé ». Importée, la base existe : l'étape se coche. La voie
 * « carte » ne crée rien à elle seule — elle se poursuit dans Paramètres → Carte, d'où le
 * lien qui suit.
 */
function ChoixPointDeDepart() {
  const rafraichir = useRafraichirApresEtape();
  const [voie, setVoie] = useState('enote');

  // Référence stable : `EtapeBase` la lit dans un effet.
  const signalerBase = useCallback(
    (prete) => {
      if (prete) rafraichir();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="mt-4 space-y-4">
      <EtapeBase onBasePrete={signalerBase} voie={voie} onVoieChange={setVoie} />
      {voie === 'carte' && (
        <Button asChild size="sm">
          <Link to="/app/parametres/carte">
            <Network className="size-4" />
            Aller à la carte
          </Link>
        </Button>
      )}
    </div>
  );
}

/** Les étapes qui se font DANS la liste : elles n'ont pas de page où renvoyer. */
const SAISIES_EN_LISTE = {
  identite: SaisieNomAbrege,
  base: ChoixPointDeDepart,
};

/**
 * @param {string} props.titre  « L'emploi du temps » — le sujet de « n'est pas encore disponible »
 */
export default function GardeEtapes({ titre, children }) {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const concerne = session.data?.utilisateur?.role === ROLES.DIRECTEUR;
  // Les saisies de la liste sont repliées : on les déplie d'un clic (clé de l'étape → ouverte).
  const [ouvertes, setOuvertes] = useState({});

  const progression = useQuery({
    queryKey: ['configuration-progression', 'garde'],
    queryFn: chargerProgressionConfiguration,
    enabled: concerne,
    retry: false,
    // Complète : on la garde cinq minutes. Incomplète : on la relit à chaque ouverture.
    staleTime: (requete) => (requete.state.data?.manquantes?.length === 0 ? 300_000 : 0),
    refetchOnWindowFocus: false,
  });

  if (!concerne) return children;

  // ⚠️ PENDANT LA RELECTURE D'UNE PROGRESSION ENCORE INCOMPLÈTE, on n'affiche pas le verrou
  // d'avant : l'étape vient peut-être d'être faite, et le verrou clignoterait.
  if (progression.isLoading || (progression.isFetching && progression.data?.manquantes?.length)) {
    return (
      <div className="flex justify-center py-16">
        <IndicateurChargement />
      </div>
    );
  }
  // Lecture impossible : on n'enferme pas.
  if (progression.isError || !progression.data) return children;

  // Toutes les étapes faites : la carte disparaît, la page s'ouvre.
  const etapesDeLaConfiguration = Object.keys(ETAPES);
  const aFaire = etapesDeLaConfiguration.filter((cle) => !progression.data.etapes?.[cle]);
  if (aFaire.length === 0) return children;

  /*
   * ═══ LA PAGE S'AFFICHE, FLOUE ET TRANSPARENTE, SOUS LA LISTE (2026-09-20, demande du
   * porteur) ═══ Elle ne disparaît pas derrière une carte vide : on VOIT ce qu'on va
   * débloquer, à travers un voile. `inert` la rend intouchable — ni clic, ni focus, ni
   * lecteur d'écran (elle n'est qu'un décor) ; `blur` et `opacity` disent qu'elle est
   * fermée. La carte, elle, reste `sticky` : sur une page haute, on la retrouve sans
   * remonter.
   *
   * ⚠️ TOUTES LES ÉTAPES SONT LISTÉES, faites (cochées) ou non : on voit d'un coup ce qui
   * reste, et la carte s'efface quand plus rien ne reste.
   */
  const etapes = etapesDeLaConfiguration;
  const restantes = aFaire;

  return (
    /*
     * ⚠️ UNE GRILLE À UNE CELLULE, PAS UN VOILE `absolute` : la page et le voile occupent la
     * MÊME cellule, dont la hauteur est celle du plus haut des deux. Posé en `absolute
     * inset-0`, le voile ne suivait que la page — et quand la carte (avec ses étapes
     * dépliées) la dépassait, elle finissait collée au bord bas, sans marge, coupée par la
     * fin de la zone.
     */
    /*
     * ═══ LA CARTE S'ADAPTE À LA HAUTEUR DE L'ÉCRAN, ET C'EST ELLE QUI DÉFILE (2026-09-20, demande
     * du porteur : « au lieu de la barre de défilement de la page entière, la mettre dans la
     * carte ») ═══ La zone tient dans la hauteur visible — `h-full` (le conteneur de la page est
     * de hauteur bornée), plafonnée à l'écran moins l'en-tête et les marges si ce conteneur ne
     * la donnait pas — et rogne la page floue derrière : elle n'est qu'un décor, elle ne doit
     * plus faire défiler. `minmax(0, 1fr)` : sans lui, la ligne prenait la hauteur de la page
     * et la carte ne se bornait plus à l'écran.
     */
    <div className="relative grid h-full max-h-[calc(100svh-6.125rem)] min-h-[24rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <div
        inert
        aria-hidden="true"
        className="pointer-events-none col-start-1 row-start-1 min-h-0 select-none overflow-hidden opacity-50 blur-sm"
      >
        {children}
      </div>

      <div className="z-10 col-start-1 row-start-1 flex min-h-0 items-center justify-center bg-background/40 p-4 backdrop-blur-[2px] sm:p-8">
        {/*
          ⚠️ LA LARGEUR EST POSÉE EN LIGNE, PAS PAR `max-w-*` (2026-09-20, demande du porteur :
          « au centre de la page, et un peu moins large »). La préférence « pleine largeur » de
          la page relâche TOUS les `max-w-*` de son contenu (`.pleine-largeur
          :where([class*='max-w-'])`) : une classe la perdait, et la carte s'étalait sur toute
          la page. Un style en ligne, lui, l'emporte — et `mx-auto` la centre même si le
          conteneur cessait de le faire.
        */}
        <section
          role="dialog"
          aria-label="Page verrouillée"
          style={{ maxWidth: '56rem' }}
          className="mx-auto flex max-h-full min-h-0 w-full flex-col rounded-lg border bg-card p-6 shadow-lg sm:p-8"
        >
          <div className="flex shrink-0 items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
              <Lock className="size-5 text-muted-foreground" />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{titre ?? 'Cette page'} n’est pas encore disponible</h1>
              <p className="text-sm text-muted-foreground">
                {restantes.length} étape(s) de la configuration ne sont pas terminées. Terminez-les
                toutes pour ouvrir cette page.
              </p>
            </div>
          </div>

          {/* Seule la liste défile : le titre en haut et le bouton en bas restent en vue. */}
          <ul className="mt-6 min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
            {etapes.map((cle) => {
              const etape = ETAPES[cle];
              const faite = Boolean(progression.data.etapes?.[cle]);
              const SaisieEnListe = SAISIES_EN_LISTE[cle];
              const ouverte = Boolean(ouvertes[cle]);

              // `items-start` : le cercle se tient en haut, à côté du titre — centré, il flottait
              // au milieu d'une ligne devenue haute dès qu'un composant s'y déplie.
              return (
                <li key={cle} className="flex items-start gap-3 p-3">
                  <span
                    className={
                      faite
                        ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground'
                        : 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground'
                    }
                  >
                    {faite ? <Check className="size-3.5" /> : <Circle className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {etape.titre}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {faite ? 'Terminée' : etape.aide}
                    </span>
                    {/*
                      Nom abrégé et point de départ : ici même, sans repasser par l'assistant, mais
                      REPLIÉS jusqu'au clic. `hidden`, pas un rendu conditionnel : replié, ce qui a
                      été saisi et son enregistrement automatique restent en vie.
                    */}
                    {!faite && SaisieEnListe && (
                      <div id={`saisie-${cle}`} hidden={!ouverte}>
                        <SaisieEnListe />
                      </div>
                    )}
                  </span>
                  {!faite && SaisieEnListe && (
                    <Button
                      type="button"
                      size="sm"
                      variant={ouverte ? 'outline' : 'default'}
                      aria-expanded={ouverte}
                      aria-controls={`saisie-${cle}`}
                      onClick={() => setOuvertes((actuelles) => ({ ...actuelles, [cle]: !actuelles[cle] }))}
                    >
                      {ouverte ? 'Réduire' : 'Compléter'}
                      <ChevronDown className={ouverte ? 'size-4 rotate-180' : 'size-4'} />
                    </Button>
                  )}
                  {!faite && !SaisieEnListe && (
                    <Button asChild size="sm">
                      <Link to={etape.vers}>Terminer</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex shrink-0 justify-end">
            <Button asChild variant="outline">
              <Link to="/configuration">Reprendre la configuration</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
