import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { anneeScolaireAPreparer } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import Alerte from '@/components/common/Alerte';
import BarreNavigation from '@/components/layout/BarreNavigation';
import { definirAnneeActive, lireAnneeActive } from '@/lib/anneeActive';
import Etapes from './components/Etapes';
import SelecteurAnneeConfiguration from './SelecteurAnneeConfiguration';
import EtapeBase from './etapes/EtapeBase';
import EtapeFormateurs from './etapes/EtapeFormateurs';
import EtapeCalendrier from './etapes/EtapeCalendrier';
import EtapeEspaces from './etapes/EtapeEspaces';
import EtapeNomAbrege from './etapes/EtapeNomAbrege';
import {
  corrigerFormateurs,
  enregistrerCalendrier,
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
const ETAPES = [
  { cle: 'base', titre: 'Base e-note', resume: 'Import ou carte' },
  { cle: 'formateurs', titre: 'Formateurs', resume: 'Adresses et masses' },
  { cle: 'calendrier', titre: 'Calendrier', resume: 'Fériés et vacances' },
  { cle: 'espaces', titre: 'Espaces', resume: 'Salles et TEAMS' },
  { cle: 'identite', titre: 'Identité', resume: 'Nom abrégé' },
];

export default function ConfigurationPage() {
  const navigate = useNavigate();
  const [courante, setCourante] = useState(1);
  const [atteinte, setAtteinte] = useState(1);

  /**
   * Une base existe-t-elle ? C'est la SEULE condition de passage du parcours :
   * les étapes 2 à 4 portent sur elle. Les étapes suivantes se franchissent
   * librement — un directeur qui n'a ni vacances ni correction à saisir ne doit
   * pas être retenu.
   */
  const [basePrete, setBasePrete] = useState(false);

  const [corrections, setCorrections] = useState({});
  const [calendrier, setCalendrier] = useState({ vacances: [] });
  const [espaces, setEspaces] = useState([]);
  const [nomAbrege, setNomAbrege] = useState('');

  const cache = useQueryClient();

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

  // Référence stable : l'étape 1 la lit dans un effet, une nouvelle fonction à
  // chaque rendu le relancerait en boucle.
  const signalerBase = useCallback((prete) => {
    setBasePrete(prete);
    if (prete) setAtteinte((precedente) => Math.max(precedente, 2));
  }, []);

  /**
   * Passage à l'étape suivante : on enregistre CE que l'étape courante a
   * produit avant de la quitter. Un échec bloque le passage — sinon le
   * directeur croirait sa saisie enregistrée.
   */
  const suivant = useMutation({
    mutationFn: async () => {
      if (courante === 2 && Object.keys(corrections).length > 0) {
        const nombre = Object.keys(corrections).length;
        await corrigerFormateurs(corrections);
        setCorrections({});
        return { corriges: nombre };
      }
      if (courante === 3) {
        await enregistrerCalendrier({ anneeScolaire: annee, ...calendrier });
        return { vacances: calendrier.vacances?.length ?? 0 };
      }
      // Les espaces s'enregistrent en QUITTANT leur étape, comme les autres :
      // ils étaient auparavant écrits au clic final, donc perdus si le
      // directeur s'arrêtait à l'étape suivante.
      if (courante === 4) {
        await enregistrerEspaces(espaces);
        return { espaces: espaces.length };
      }
      return {};
    },
    onSuccess: (resultat) => {
      if (resultat.corriges) {
        toast.success(`${resultat.corriges} formateur(s) corrigé(s)`);
      } else if (resultat.espaces !== undefined) {
        toast.success(`${resultat.espaces} espace(s) enregistré(s)`);
      } else if (resultat.vacances !== undefined) {
        toast.success('Calendrier enregistré', {
          description: `${resultat.vacances} période(s) de vacances.`,
        });
      }
      avancer(courante + 1);
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const terminer = useMutation({
    mutationFn: async () => {
      await enregistrerNomAbrege(nomAbrege.trim());
      await terminerConfiguration();
    },
    onSuccess: () => {
      toast.success('Configuration terminée', {
        description: `Votre établissement s'affichera sous « ${nomAbrege.trim()} ». Bienvenue.`,
      });
      navigate('/app');
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const enCours = suivant.isPending || terminer.isPending;
  const erreur = suivant.error ?? terminer.error;
  const derniere = courante === ETAPES.length;
  /*
   * Deux étapes conditionnent la suite : la base (sans elle rien n'existe) et
   * les espaces (le générateur de la Phase 6 ne peut rien placer sans salle).
   * Les autres se laissent traverser et se complètent plus tard.
   */
  const peutAvancer =
    (courante !== 1 || basePrete) && (courante !== 4 || espaces.length > 0);

  return (
    <>
      <BarreNavigation titre="Configuration" />

      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
          <header className="space-y-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">Configuration de votre établissement</h1>
              <p className="text-sm text-muted-foreground">
                Cinq étapes, enregistrées au fur et à mesure — vous pouvez revenir plus tard.
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
              verrouille={basePrete}
            />
          </header>

          <div className="space-y-3">
            <Etapes
              etapes={ETAPES}
              courante={courante}
              atteinte={atteinte}
              onChoisir={setCourante}
            />
            <Progress value={((courante - 1) / (ETAPES.length - 1)) * 100} className="h-1" />
          </div>

          <section className="rounded-lg border p-6">
            {courante === 1 && (
              <EtapeBase onBasePrete={signalerBase} />
            )}
            {courante === 2 && <EtapeFormateurs onModification={setCorrections} />}
            {courante === 3 && (
              <EtapeCalendrier
                anneeScolaire={annee}
                valeur={calendrier}
                onChange={setCalendrier}
              />
            )}
            {courante === 4 && <EtapeEspaces valeur={espaces} onChange={setEspaces} />}
            {courante === 5 && <EtapeNomAbrege valeur={nomAbrege} onChange={setNomAbrege} />}
          </section>

          {erreur && (
            <Alerte type="erreur" titre="Enregistrement impossible">
              {erreur.message}
            </Alerte>
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              disabled={courante === 1 || enCours}
              onClick={() => setCourante(courante - 1)}
            >
              <ArrowLeft className="h-4 w-4" />
              Précédent
            </Button>

            {derniere ? (
              <Button
                // Le nom abrégé est la saisie de CETTE étape : c'est lui qui
                // conditionne la clôture, plus les espaces de l'étape 4.
                disabled={nomAbrege.trim().length < 2 || enCours}
                onClick={() => terminer.mutate()}
              >
                {terminer.isPending ? 'Enregistrement…' : 'Terminer la configuration'}
                <Check className="h-4 w-4" />
              </Button>
            ) : (
              <Button disabled={!peutAvancer || enCours} onClick={() => suivant.mutate()}>
                {suivant.isPending ? 'Enregistrement…' : 'Suivant'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
