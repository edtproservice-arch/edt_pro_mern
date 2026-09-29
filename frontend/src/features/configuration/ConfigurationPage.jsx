import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, SkipForward } from 'lucide-react';
import { anneeScolaireAPreparer, etapeDeReprise } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import Alerte from '@/components/common/Alerte';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  IndicateurEnregistrement,
  useEnregistrementAuto,
} from '@/components/common/enregistrementAuto';
import BarreNavigation from '@/components/layout/BarreNavigation';
import { FournirLargeurPage } from '@/components/layout/largeurPage';
import { definirAnneeActive, lireAnneeActive } from '@/lib/anneeActive';
import Etapes from './components/Etapes';
import SelecteurAnneeConfiguration from './SelecteurAnneeConfiguration';
import PageAffectations from '@/features/parametres/PageAffectations';
import EtapeBase from './etapes/EtapeBase';
import EtapeFormateurs from './etapes/EtapeFormateurs';
import EtapeEspaces from './etapes/EtapeEspaces';
import EtapeNomAbrege from './etapes/EtapeNomAbrege';
import {
  chargerEtablissementCourant,
  chargerProgressionConfiguration,
  chargerResumeBase,
  corrigerFormateurs,
  enregistrerEspaces,
  enregistrerNomAbrege,
  terminerConfiguration,
} from './api';

/**
 * Configuration initiale d'un établissement (F3).
 * ← public/setup.html
 *
 * Différence de fond avec l'existant : setup.html gardait TOUT en mémoire du
 * navigateur et n'écrivait qu'à la dernière étape, en un seul appel
 * (`complete_setup.php`, avec `excelData` complet dans le corps de la requête).
 * Une fermeture d'onglet à l'étape 3 perdait l'import. Ici chaque étape écrit
 * la sienne : revenir en arrière ou revenir demain reprend là où on s'est
 * arrêté.
 */
/*
 * ═══ L'ORDRE DES ÉTAPES (2026-09-19, demande du porteur) ═══
 *   1 Nom abrégé · 2 Espaces · 3 Point de départ (import e-note OU création de la carte)
 *   puis, DANS LES DEUX CAS : 4 Formateurs · 5 Carte · 6 Affectations.
 *
 * Ce qui tient au lieu — le nom, les espaces — passe avant ce qui tient aux données de
 * formation, qui se construisent ensemble. Le CALENDRIER n'est plus une étape : il se
 * règle dans Paramètres → Calendrier.
 *
 * ⚠️ LES ÉTAPES 5 ET 6 SONT LES PAGES « CARTE » ET « AFFECTATIONS » DE PARAMÈTRES,
 * montées telles quelles. Une seconde copie de la carte dans l'assistant aurait son
 * propre enregistrement — et deux enregistreurs de la même base finissent par se
 * refuser mutuellement (409). Elles s'enregistrent d'elles-mêmes, comme là-bas.
 */
const ETAPES = [
  { cle: 'identite', titre: 'Nom abrégé', resume: 'Nom affiché' },
  { cle: 'espaces', titre: 'Espaces', resume: 'Espaces et TEAMS' },
  { cle: 'base', titre: 'Point de départ', resume: 'Import ou carte' },
  { cle: 'formateurs', titre: 'Formateurs', resume: 'Ajout et vérification' },
  { cle: 'carte', titre: 'Carte', resume: 'Filières et groupes' },
  { cle: 'affectations', titre: 'Affectations', resume: 'Qui enseigne quoi' },
];

export default function ConfigurationPage() {
  const navigate = useNavigate();
  const [courante, setCourante] = useState(1);
  const [atteinte, setAtteinte] = useState(1);

  /**
   * Une base existe-t-elle ? Elle conditionne le passage de l'étape « point de
   * départ » quand on a choisi l'import — et VERROUILLE l'année : une base est
   * rangée sous l'année où elle a été créée.
   */
  const [basePrete, setBasePrete] = useState(false);

  /** La voie choisie à l'étape 3 : importer un fichier, ou construire la carte. */
  const [voie, setVoie] = useState('enote');

  /**
   * Le groupe dont on ouvre l'affectation depuis son badge (étape 5) : l'étape 6 s'ouvre
   * sur son ensemble. ⚠️ Oublié dès qu'on quitte l'étape 6 — sinon un retour ultérieur
   * rouvrirait un groupe choisi il y a longtemps.
   */
  const [groupeVise, setGroupeVise] = useState(null);

  /**
   * Les étapes PASSÉES (2026-09-20, demande du porteur : « ajouter l'option de passer »).
   * Passer laisse avancer sans remplir l'étape — mais ne la dispense de rien : la
   * configuration ne se termine qu'une fois TOUTES les étapes faites, et l'espace
   * directeur reste fermé d'ici là. Cet ensemble ne sert qu'à l'AFFICHER (une étape
   * passée n'est pas cochée comme faite) ; c'est le serveur qui juge de ce qui l'est.
   */
  const [passees, setPassees] = useState([]);

  const [corrections, setCorrections] = useState({});
  /*
   * ⚠️ « TEAMS » CRÉÉ D'OFFICE (2026-09-19, demande du porteur) : la liste part avec la
   * classe à distance. Puis, une seule fois, elle reprend ce que l'établissement a déjà
   * en base — revenir plus tard dans l'assistant ne doit pas écraser ses espaces par
   * une liste réduite à « TEAMS » : l'enregistrement REMPLACE la liste entière.
   */
  const [espaces, setEspaces] = useState(['TEAMS']);
  const [espacesRepris, setEspacesRepris] = useState(false);
  // Ce que le serveur a DÉJÀ : ce qui diffère est à écrire (voir l'enregistrement automatique).
  const [nomEnregistre, setNomEnregistre] = useState('');
  const [espacesEnregistres, setEspacesEnregistres] = useState(null);
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });
  useEffect(() => {
    const enBase = etablissement.data?.etablissement?.espaces;
    if (espacesRepris || !enBase) return;
    setEspacesRepris(true);
    if (enBase.length > 0) {
      setEspaces(enBase.some((e) => e.trim().toUpperCase() === 'TEAMS') ? enBase : ['TEAMS', ...enBase]);
    }
    // Le nom abrégé aussi : repris de la base, et tenu pour ENREGISTRÉ — sinon le
    // reprendre le réécrirait aussitôt à l'identique.
    const enBaseNom = etablissement.data?.etablissement?.nomAbrege;
    if (enBaseNom) {
      setNomAbrege(enBaseNom);
      setNomEnregistre(enBaseNom);
    }
    setEspacesEnregistres(JSON.stringify(enBase));
  }, [etablissement.data, espacesRepris]);
  const [nomAbrege, setNomAbrege] = useState('');

  const cache = useQueryClient();

  /*
   * ═══ REPRENDRE LÀ OÙ L'ON S'ÉTAIT ARRÊTÉ (2026-09-20, demande du porteur) ═══
   * « Si on est déconnecté, ou si le wifi coupe, il doit retrouver ce qui est déjà fait
   * pour continuer. » L'état de l'assistant (l'étape courante…) vit dans le navigateur,
   * donc s'efface avec l'onglet ou la session — mais chaque étape a ÉCRIT sa part en
   * base. On lit donc CE QUI EST ÉCRIT (`configuration-progression`) et on ouvre
   * l'assistant à la première étape non faite, les précédentes marquées franchies.
   *
   * ⚠️ RELU À CHAQUE OUVERTURE, JAMAIS SERVI DU CACHE : `gcTime: 0` — un résultat gardé
   * d'une visite précédente ferait reprendre à une étape qui n'est plus la bonne.
   *
   * ⚠️ UNE SEULE FOIS : reprendre à chaque relecture arracherait le directeur à l'étape
   * qu'il est en train de remplir dès qu'une requête se rafraîchit.
   */
  const progression = useQuery({
    queryKey: ['configuration-progression'],
    queryFn: chargerProgressionConfiguration,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [repris, setRepris] = useState(false);

  useEffect(() => {
    if (repris || !progression.isSuccess) return;
    setRepris(true);

    const numero = etapeDeReprise(progression.data.etapes);
    if (numero > 1) {
      setCourante(numero);
      setAtteinte(numero);
      toast.info(`Reprise à l’étape ${numero}`, {
        description: 'Ce que vous aviez déjà saisi est enregistré.',
      });
    }
  }, [progression.isSuccess, progression.data, repris]);
  /*
   * L'année qu'on PRÉPARE, pas celle en cours : de juin à août, la seconde est
   * celle qui s'achève. L'écran proposait « 2025-2026 » à un directeur qui
   * saisissait sa carte pour « 2026-2027 ».
   *
   * ⚠️ La pose de l'année ACTIVE est faite dans l'initialiseur, pas dans un
   * `useEffect` : celui-ci ne s'exécute qu'APRÈS le premier rendu, donc après
   * que l'étape 1 a déjà lancé sa requête — qui serait partie sans en-tête
   * `X-Annee-Scolaire`, et aurait donc lu l'année par défaut de
   * l'établissement. L'opération est idempotente, la rejouer ne coûte rien.
   */
  const [annee, setAnnee] = useState(() => {
    /*
     * ⚠️ Une année DÉJÀ active l'emporte sur la déduction. L'assistant se
     * reprend en plusieurs fois — c'est tout l'intérêt de « chaque étape écrit
     * la sienne ». Un directeur qui choisit 2027-2028 en juin, importe sa base,
     * puis revient en septembre verrait la déduction lui proposer 2026-2027 :
     * une année vide, sa base étant rangée sous l'autre.
     *
     * Avant la configuration, cette valeur ne peut venir que d'un passage
     * précédent dans cet assistant : le sélecteur de la barre latérale est hors
     * d'atteinte tant que l'établissement n'est pas configuré.
     */
    const deduite = lireAnneeActive() ?? anneeScolaireAPreparer();
    definirAnneeActive(deduite);
    return deduite;
  });

  const changerAnnee = (nouvelle) => {
    if (nouvelle === annee) return;

    /*
     * ⚠️ L'ORDRE compte. `invalidateQueries()` relance immédiatement les
     * requêtes actives ; si l'année active n'est pas déjà posée, elles repartent
     * avec l'ancienne et remplissent le cache de données de la mauvaise année —
     * exactement ce que l'invalidation cherchait à éviter.
     */
    definirAnneeActive(nouvelle);
    setAnnee(nouvelle);
    cache.invalidateQueries();
  };

  const avancer = useCallback((numero) => {
    setCourante(numero);
    setAtteinte((precedente) => Math.max(precedente, numero));
  }, []);

  useEffect(() => {
    if (courante !== 6) setGroupeVise(null);
  }, [courante]);

  // Le badge d'un groupe, à l'étape 5 : on passe à l'étape SUIVANTE, sur ce groupe.
  const ouvrirAffectation = useCallback(
    (nom) => {
      setGroupeVise(nom);
      avancer(6);
    },
    [avancer]
  );

  // Référence stable : l'étape 3 la lit dans un effet, une nouvelle fonction à
  // chaque rendu le relancerait en boucle.
  const signalerBase = useCallback((prete) => {
    setBasePrete(prete);
  }, []);

  /**
   * Passage à l'étape suivante : on enregistre CE que l'étape courante a
   * produit avant de la quitter. Un échec bloque le passage — sinon le
   * directeur croirait sa saisie enregistrée.
   */
  const suivant = useMutation({
    mutationFn: async () => {
      // Le nom abrégé et les espaces s'enregistrent en QUITTANT leur étape, comme les
      // autres : écrits au clic final, ils étaient perdus si le directeur s'arrêtait
      // en route.
      if (courante === 1) {
        await enregistrerNomAbrege(nomAbrege.trim());
        return { nom: nomAbrege.trim() };
      }
      if (courante === 2) {
        await enregistrerEspaces(espaces);
        return { espaces: espaces.length };
      }
      if (courante === 4 && Object.keys(corrections).length > 0) {
        const nombre = Object.keys(corrections).length;
        await corrigerFormateurs(corrections);
        setCorrections({});
        return { corriges: nombre };
      }
      /*
       * ⚠️ IL FAUT AU MOINS UN GROUPE ENREGISTRÉ pour passer aux affectations : sans
       * lui, la matrice est vide et l'étape n'a rien à montrer. On le demande au
       * SERVEUR, pas à l'écran — l'enregistrement de la carte est automatique, et
       * c'est ce qui est écrit qui compte.
       */
      if (courante === 5) {
        const { resume } = await chargerResumeBase();
        if (!resume?.groupes) {
          throw new Error(
            'Aucun groupe enregistré : générez au moins un groupe (l’enregistrement est automatique, patientez un instant).'
          );
        }
      }
      return {};
    },
    onSuccess: (resultat) => {
      if (resultat.corriges) {
        toast.success(`${resultat.corriges} formateur(s) corrigé(s)`);
      } else if (resultat.espaces !== undefined) {
        toast.success(`${resultat.espaces} espace(s) enregistré(s)`);
      } else if (resultat.nom) {
        toast.success('Nom abrégé enregistré');
      }
      setPassees((precedentes) => precedentes.filter((numero) => numero !== courante));
      avancer(courante + 1);
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const terminer = useMutation({
    mutationFn: terminerConfiguration,
    onSuccess: () => {
      /*
       * ⚠️ LA SESSION EST MISE À JOUR AVANT DE QUITTER. La coquille de `/app` refuse le
       * directeur dont `configurationTerminee` est faux (voir `CoquilleApp`) : avec la
       * session mise en cache AVANT la clôture, elle le renverrait aussitôt ici — et l'on
       * tournerait entre les deux pages.
       */
      cache.setQueryData(['session'], (session) =>
        session?.utilisateur
          ? { ...session, utilisateur: { ...session.utilisateur, configurationTerminee: true } }
          : session
      );
      cache.invalidateQueries({ queryKey: ['session'] });

      toast.success('Configuration terminée', {
        description:
          manquantes.length > 0
            ? 'Certaines pages restent verrouillées jusqu’à ce que les étapes manquantes soient faites.'
            : `Votre établissement s'affichera sous « ${nomAbrege.trim()} ». Bienvenue.`,
      });
      navigate('/app');
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  /*
   * ═══ ENREGISTREMENT AUTOMATIQUE DES SAISIES DE L'ASSISTANT (2026-09-20) ═══
   * « Qu'il enregistre les données des étapes si on est déconnecté ou si le wifi coupe. »
   * Le nom abrégé, les espaces et les corrections de formateurs ne partaient qu'au clic
   * sur « Suivant » : une coupure, ou une session qui expire, avant ce clic les perdait.
   * Elles partent maintenant d'elles-mêmes, 0,8 s après la dernière modification — comme
   * les pages de Paramètres.
   *
   * ⚠️ UN ÉCHEC S'ARRÊTE, IL NE BOUCLE PAS. Hors ligne, `modifie` reste vrai : la
   * minuterie repartirait à chaque retour d'échec, en martelant un réseau absent. Le
   * drapeau d'échec coupe l'automatisme ; il se lève à la modification suivante, ou dès
   * que le navigateur annonce le retour du réseau (`online`) — l'écriture reprend alors
   * toute seule. « Suivant » écrit de toute façon, et reste bloqué s'il échoue.
   *
   * ⚠️ UNE VALEUR N'EST ÉCRITE QUE SI L'ÉTAPE LA TIENDRAIT POUR VALIDE : un nom d'une
   * lettre, ou des espaces réduits à « TEAMS », n'ont rien à faire en base.
   */
  const [echec, setEchec] = useState({ nom: false, espaces: false, corrections: false });
  /*
   * ⚠️ LE MESSAGE DIT CE QUI S'EST PASSÉ. « Connexion perdue ? » n'est vrai que si le
   * serveur n'a PAS répondu (aucun statut). Quand il a répondu — un refus, une erreur —
   * annoncer une coupure envoyait chercher le wifi pour un défaut qui n'en venait pas.
   */
  const signalerEchec = (cle, erreur) => {
    setEchec((precedent) => ({ ...precedent, [cle]: true }));
    const reseau = !erreur?.status || erreur.code === 'SERVEUR_INDISPONIBLE';
    toast.error(reseau ? 'Enregistrement en attente' : 'Enregistrement refusé', {
      id: 'assistant-enregistrement-attente',
      description: reseau
        ? 'Connexion perdue ? Vos saisies restent à l’écran et repartent dès que la connexion revient.'
        : erreur.message,
    });
  };
  const leverEchecs = useCallback(
    () => setEchec({ nom: false, espaces: false, corrections: false }),
    []
  );

  useEffect(() => {
    window.addEventListener('online', leverEchecs);
    return () => window.removeEventListener('online', leverEchecs);
  }, [leverEchecs]);

  const nomValide = nomAbrege.trim().length >= 2;
  const espacesValides = espaces.some((e) => e.trim().toUpperCase() !== 'TEAMS');
  const aDesCorrections = Object.keys(corrections).length > 0;

  // Une modification lève l'échec du champ concerné : c'est un nouvel essai.
  useEffect(() => setEchec((precedent) => ({ ...precedent, nom: false })), [nomAbrege]);
  useEffect(() => setEchec((precedent) => ({ ...precedent, espaces: false })), [espaces]);
  useEffect(() => setEchec((precedent) => ({ ...precedent, corrections: false })), [corrections]);

  /*
   * ⚠️ UNE FONCTION EXPLICITE, JAMAIS `mutationFn: enregistrerEspaces` : TanStack Query
   * appelle `mutationFn(variables, contexte)` — un SECOND argument, l'objet de contexte —
   * et `enregistrerEspaces(espaces, version)` y lisait la « version ». Elle partait dans le
   * corps de la requête : chaque écriture des espaces échouait, avec ou sans réseau, sous
   * l'annonce trompeuse « connexion perdue ».
   */
  const ecrireNom = useMutation({
    mutationFn: (nom) => enregistrerNomAbrege(nom),
    onSuccess: (_, nom) => setNomEnregistre(nom),
    onError: (erreur) => signalerEchec('nom', erreur),
  });
  const ecrireEspaces = useMutation({
    mutationFn: (liste) => enregistrerEspaces(liste),
    onSuccess: (_, liste) => setEspacesEnregistres(JSON.stringify(liste)),
    onError: (erreur) => signalerEchec('espaces', erreur),
  });
  const ecrireCorrections = useMutation({
    mutationFn: (aEnvoyer) => corrigerFormateurs(aEnvoyer),
    // Seules les corrections ENVOYÉES sont retirées : une retouche faite pendant l'envoi
    // reste à écrire.
    onSuccess: (_, envoyees) =>
      setCorrections((actuelles) =>
        Object.fromEntries(
          Object.entries(actuelles).filter(
            ([cle, valeur]) => JSON.stringify(valeur) !== JSON.stringify(envoyees[cle])
          )
        )
      ),
    onError: (erreur) => signalerEchec('corrections', erreur),
  });

  const nomAEcrire = nomValide && nomAbrege.trim() !== nomEnregistre && !echec.nom;
  const espacesAEcrire =
    espacesValides && espacesEnregistres !== null && JSON.stringify(espaces) !== espacesEnregistres && !echec.espaces;
  const correctionsAEcrire = aDesCorrections && !echec.corrections;

  useEnregistrementAuto({
    modifie: repris && nomAEcrire,
    valeur: nomAbrege,
    onEnregistrer: () => ecrireNom.mutate(nomAbrege.trim()),
    repos: 800,
    enCours: ecrireNom.isPending,
  });
  useEnregistrementAuto({
    modifie: repris && espacesAEcrire,
    valeur: espaces,
    onEnregistrer: () => ecrireEspaces.mutate(espaces),
    repos: 800,
    enCours: ecrireEspaces.isPending,
  });
  useEnregistrementAuto({
    modifie: repris && correctionsAEcrire,
    valeur: corrections,
    onEnregistrer: () => ecrireCorrections.mutate(corrections),
    repos: 800,
    enCours: ecrireCorrections.isPending,
  });

  const enregistrementAuto = {
    modifie: nomAEcrire || espacesAEcrire || correctionsAEcrire,
    enCours: ecrireNom.isPending || ecrireEspaces.isPending || ecrireCorrections.isPending,
    echec: echec.nom || echec.espaces || echec.corrections,
  };

  /*
   * ⚠️ PASSER N'ÉCRIT RIEN ET NE VALIDE RIEN : on avance, l'étape reste à faire. Ce que la
   * personne avait déjà saisi part de toute façon par l'enregistrement automatique.
   * Sans nouvelle règle de passage — un nom trop court ou des espaces vides n'empêchent
   * plus d'aller voir la suite — mais la clôture, elle, ne passe pas (voir plus bas).
   */
  const passer = () => {
    setPassees((precedentes) => (precedentes.includes(courante) ? precedentes : [...precedentes, courante]));
    toast.info(`Étape ${courante} passée`, {
      description: 'Vous devrez la compléter avant de terminer la configuration.',
    });
    avancer(courante + 1);
  };

  /*
   * ⚠️ À LA DERNIÈRE ÉTAPE, ON RELIT CE QUI RESTE À FAIRE, jamais servi du cache : c'est là
   * que l'on TERMINE, et la clôture est refusée tant qu'il manque quelque chose. Plutôt
   * que de laisser cliquer pour se voir refuser, on dit quelles étapes manquent, avec de
   * quoi y retourner.
   */
  const restantes = useQuery({
    queryKey: ['configuration-progression', 'cloture'],
    queryFn: chargerProgressionConfiguration,
    enabled: courante === ETAPES.length && repris,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const manquantes = courante === ETAPES.length ? (restantes.data?.manquantes ?? []) : [];

  const enCours = suivant.isPending || terminer.isPending;
  const erreur = suivant.error ?? terminer.error;
  const derniere = courante === ETAPES.length;
  /*
   * Trois étapes conditionnent la suite : le nom abrégé (il figure sur les documents),
   * les espaces (le générateur de la Phase 6 ne peut rien placer sans espace) et le
   * point de départ — un import réussi, ou le choix de construire la carte. Les
   * autres se laissent traverser et se complètent plus tard.
   */
  const peutAvancer =
    (courante !== 1 || nomAbrege.trim().length >= 2) &&
    // « TEAMS » est là d'office : il ne suffit pas, il faut un espace où recevoir en présentiel.
    (courante !== 2 || espaces.some((e) => e.trim().toUpperCase() !== 'TEAMS')) &&
    (courante !== 3 || voie === 'carte' || basePrete);

  return (
    <>
      <BarreNavigation titre="Configuration" />

      <main className="min-h-screen bg-background">
        {/*
          ⚠️ PLEINE LARGEUR (2026-09-19, demande du porteur) : la page n'est plus bornée
          — ni à `max-w-5xl` comme à l'origine, ni à la largeur de la barre. Les marges
          latérales de la barre sont gardées, pour que le bord du contenu reste dans
          l'alignement du logo.

          ⚠️ ET LA MÊME LARGEUR EST ANNONCÉE AUX PAGES MONTÉES DANS LES ÉTAPES 5 ET 6
          (Carte, Affectations) : leur cadre borne sinon son contenu à `max-w-4xl`, et
          la matrice se trouverait plus étroite ici que dans Paramètres.
        */}
        <FournirLargeurPage value="max-w-full">
        <div className="w-full space-y-8 px-4 py-10 sm:px-6 lg:px-8">
          <header className="space-y-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">Configuration de votre établissement</h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                Six étapes, enregistrées au fur et à mesure — vous pouvez revenir plus tard.
                <IndicateurEnregistrement {...enregistrementAuto} enregistreUneFois />
              </p>
            </div>

            {/*
              L'année ne se lit plus dans une phrase : elle se CHOISIT. De
              novembre à mai, la déduction ne peut pas distinguer un
              établissement en retard d'un établissement en avance.
            */}
            <SelecteurAnneeConfiguration
              annee={annee}
              onChange={changerAnnee}
              // Verrouillée dès qu'une base peut exister : un import, ou les formateurs
              // ajoutés à l'étape 4 — la base se range sous l'année où elle naît.
              verrouille={basePrete || atteinte > 3}
            />
          </header>

          <div className="space-y-3">
            <Etapes
              etapes={ETAPES}
              courante={courante}
              atteinte={atteinte}
              onChoisir={setCourante}
              passees={passees}
            />
            <Progress value={((courante - 1) / (ETAPES.length - 1)) * 100} className="h-1" />
          </div>

          {/*
            ⚠️ ON N'OUVRE PAS L'ASSISTANT AVANT SAVOIR OÙ REPRENDRE : l'étape 1 s'afficherait
            un instant, puis l'écran sauterait à la 4 — et un nom abrégé retapé par-dessus
            ce qui est déjà enregistré. Hors ligne, la lecture échoue : on le DIT, avec de quoi
            réessayer — ou repartir de l'étape 1 sans reprise, à ses risques.
          */}
          {!repris && progression.isLoading && (
            <div className="flex items-center justify-center gap-3 rounded-lg border p-10 text-sm text-muted-foreground">
              <IndicateurChargement />
              Recherche de ce que vous avez déjà enregistré…
            </div>
          )}

          {!repris && progression.isError && (
            <Alerte type="avertissement" titre="Impossible de retrouver votre progression">
              <p>
                {progression.error?.message} Vérifiez votre connexion : l’assistant reprend là où
                vous vous étiez arrêté dès que la lecture réussit.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => progression.refetch()}>
                  Réessayer
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRepris(true)}>
                  Commencer à l’étape 1
                </Button>
              </div>
            </Alerte>
          )}

          {repris && (
          <section className="rounded-lg border p-6">
            {courante === 1 && <EtapeNomAbrege valeur={nomAbrege} onChange={setNomAbrege} />}
            {courante === 2 && <EtapeEspaces valeur={espaces} onChange={setEspaces} />}
            {courante === 3 && (
              <EtapeBase onBasePrete={signalerBase} voie={voie} onVoieChange={setVoie} />
            )}
            {/* Le MÊME composant que Paramètres → Formateurs : ajout, filtres, et pour chaque formateur ses espaces attribués et ses créneaux d'indisponibilité — les espaces existent depuis l'étape 2. */}
            {courante === 4 && (
              <EtapeFormateurs onModification={setCorrections} avecAjout avecContraintes />
            )}
            {courante === 5 && (
              <PageAffectations variante="carte" surOuvrirGroupe={ouvrirAffectation} />
            )}
            {courante === 6 && <PageAffectations groupeVise={groupeVise} />}
          </section>
          )}

          {erreur && (
            <Alerte type="erreur" titre="Enregistrement impossible">
              {erreur.message}
            </Alerte>
          )}

          {manquantes.length > 0 && (
            <Alerte type="avertissement" titre="Des étapes ne sont pas terminées">
              <p>
                Vous pouvez terminer la configuration maintenant : les pages qui en dépendent
                (l’emploi du temps, par exemple) resteront verrouillées, avec la liste de ce qui
                manque, jusqu’à ce que ces étapes soient faites. Vous pouvez aussi y retourner :
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {manquantes.map((cle) => {
                  const numero = ETAPES.findIndex((etape) => etape.cle === cle) + 1;
                  return (
                    <Button key={cle} size="sm" variant="outline" onClick={() => setCourante(numero)}>
                      {numero}. {ETAPES[numero - 1].titre}
                    </Button>
                  );
                })}
              </div>
            </Alerte>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={courante === 1 || enCours}
              onClick={() => setCourante(courante - 1)}
            >
              <ArrowLeft className="h-4 w-4" />
              Précédent
            </Button>

            {derniere ? (
              <Button disabled={enCours} onClick={() => terminer.mutate()}>
                {terminer.isPending ? 'Enregistrement…' : 'Terminer la configuration'}
                <Check className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {/* « Passer » : avancer sans remplir l'étape. Jamais sur la dernière — on y
                    TERMINE, on n'y passe rien. */}
                <Button variant="ghost" disabled={enCours} onClick={passer}>
                  <SkipForward className="h-4 w-4" />
                  Passer
                </Button>
                <Button disabled={!peutAvancer || enCours} onClick={() => suivant.mutate()}>
                  {suivant.isPending ? 'Enregistrement…' : 'Suivant'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
        </FournirLargeurPage>
      </main>
    </>
  );
}
