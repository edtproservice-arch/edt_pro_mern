import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { JOURS } from 'shared/constants';
import { CRENEAUX_CONTRAINTES, dureeSeance, normaliserContraintes } from 'shared/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { enregistrerContraintesFormateur } from '../api';
import { estTeams } from './filtresFormateurs';

/**
 * Disponibilité et salles attribuées d'UN formateur.
 * ← les colonnes « Espaces autorisés » et « Indisponibilités » de profile.html
 *   (profil-contraintes.js)
 *
 * ═══ UNE MODALE, PAS DEUX COLONNES PERMANENTES ═══
 * L'existant montait des pastilles de salle et une grille 6 × 4 sur CHAQUE
 * ligne : sur quarante formateurs et dix salles, un millier de cases, qu'on ne
 * regarde qu'une à la fois. La leçon de la page Affectations (15 900 nœuds
 * montés d'un coup) s'applique ici.
 *
 * ═══ ENREGISTREMENT AUTOMATIQUE ═══ comme le reste de la page, 500 ms après le
 * dernier clic ; fermer la modale envoie aussitôt ce qui attend encore.
 */
const PAUSE_MS = 500;

export default function DialogueContraintes({
  ouvert,
  onOuvertChange,
  formateur,
  nom,
  salles,
  initiales,
  lectureSeule = false,
}) {
  const depart = () => ({
    espaces: initiales?.espaces ?? [],
    indisponibilites: normaliserContraintes(initiales).indisponibilites,
  });
  const [brouillon, setBrouillon] = useState(depart);
  const [etat, setEtat] = useState('repos');
  const minuterie = useRef(null);
  const enAttente = useRef(null);
  // ⚠️ LE GLISSEMENT ENCHAÎNE LES MODIFICATIONS plus vite que React ne rend :
  // chacune part de ce ref, pas de l'état capturé au dernier rendu.
  const courant = useRef(brouillon);
  // { type: 'creneau' | 'salle', valeur } tant que le bouton est enfoncé.
  const glisse = useRef(null);

  // À chaque ouverture, on repart de ce que la base porte.
  useEffect(() => {
    if (ouvert) {
      const initial = depart();
      courant.current = initial;
      setBrouillon(initial);
      setEtat('repos');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  // Relâcher n'importe où (même hors de la grille) termine le glissement.
  useEffect(() => {
    const finir = () => {
      glisse.current = null;
    };
    window.addEventListener('pointerup', finir);
    window.addEventListener('pointercancel', finir);
    return () => {
      window.removeEventListener('pointerup', finir);
      window.removeEventListener('pointercancel', finir);
    };
  }, []);

  const ecriture = useMutation({
    mutationFn: enregistrerContraintesFormateur,
    onMutate: () => setEtat('envoi'),
    onSuccess: () => setEtat('ok'),
    onError: (erreur) => {
      setEtat('erreur');
      toast.error('Disponibilité non enregistrée', { description: erreur.message });
    },
  });

  const envoyer = () => {
    clearTimeout(minuterie.current);
    if (!enAttente.current) return;
    ecriture.mutate({ formateur, ...enAttente.current });
    enAttente.current = null;
  };

  /*
   * ⚠️ SEUL LE CHAMP TOUCHÉ PART. Cocher un créneau ne renvoie pas les salles :
   * si la liste des espaces n'était pas encore chargée, elle les aurait effacées.
   */
  const modifier = (suivant, champ) => {
    courant.current = suivant;
    setBrouillon(suivant);
    enAttente.current = { ...enAttente.current, [champ]: suivant[champ] };
    setEtat('attente');
    clearTimeout(minuterie.current);
    minuterie.current = setTimeout(envoyer, PAUSE_MS);
  };

  // Ce qui attend encore part à la fermeture ou au démontage.
  useEffect(() => () => envoyer(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const fermer = (valeur) => {
    if (!valeur) envoyer();
    onOuvertChange(valeur);
  };

  const indisponible = new Set(brouillon.indisponibilites.map((c) => `${c.jour}|${c.seance}`));
  // Masse horaire des créneaux restés libres — durée réelle de chaque séance.
  const heuresLibres = JOURS.reduce(
    (total, jour) =>
      total +
      CRENEAUX_CONTRAINTES.reduce(
        (somme, seance) => somme + (indisponible.has(`${jour}|${seance}`) ? 0 : dureeSeance(seance)),
        0
      ),
    0
  );
  const creneauxLibres = JOURS.length * CRENEAUX_CONTRAINTES.length - indisponible.size;

  const poserSalle = (salle, valeur) => {
    const actuel = courant.current;
    if (actuel.espaces.includes(salle) === valeur) return;
    modifier({
      ...actuel,
      espaces: valeur ? [...actuel.espaces, salle] : actuel.espaces.filter((s) => s !== salle),
    }, 'espaces');
  };

  const poserCreneaux = (creneaux, valeur) => {
    const actuel = courant.current;
    const cles = new Set(actuel.indisponibilites.map((c) => `${c.jour}|${c.seance}`));
    const avant = cles.size;
    for (const { jour, seance } of creneaux) {
      if (valeur) cles.add(`${jour}|${seance}`);
      else cles.delete(`${jour}|${seance}`);
    }
    if (cles.size === avant) return; // tout allait déjà dans ce sens
    const liste = [...cles].map((cle) => {
      const [jour, seance] = cle.split('|');
      return { jour, seance };
    });
    modifier(
      { ...actuel, indisponibilites: normaliserContraintes({ indisponibilites: liste }).indisponibilites },
      'indisponibilites'
    );
  };

  /*
   * ═══ CLIC OU GLISSEMENT ═══ L'appui fixe la valeur visée (l'inverse de la
   * case de départ) ; chaque case survolée ensuite, bouton enfoncé, la reçoit.
   * Un simple clic n'est qu'un glissement d'une case. Le clic clavier
   * (detail === 0) bascule comme avant.
   */
  const glissement = (type, valeurActuelle, poser) => ({
    onPointerDown: (e) => {
      if (lectureSeule || e.button !== 0) return;
      e.preventDefault(); // pas de sélection de texte pendant le glissement
      // Au doigt, le pointeur reste capturé par la case de départ : on le libère
      // pour que les cases suivantes reçoivent pointerenter.
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      glisse.current = { type, valeur: !valeurActuelle };
      poser(!valeurActuelle);
    },
    onPointerEnter: () => {
      if (glisse.current?.type === type) poser(glisse.current.valeur);
    },
    onClick: (e) => {
      if (e.detail === 0) poser(!valeurActuelle);
    },
  });

  const basculerJour = (jour) => {
    const creneaux = CRENEAUX_CONTRAINTES.map((seance) => ({ jour, seance }));
    const toutRouge = creneaux.every((c) => indisponible.has(`${c.jour}|${c.seance}`));
    poserCreneaux(creneaux, !toutRouge);
  };

  const avecTeams = salles.some(estTeams);
  const sallesReelles = salles
    .filter((s) => !estTeams(s))
    .sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{nom}</DialogTitle>
          <DialogDescription>
            Espaces attribués et créneaux d&apos;indisponibilité. L&apos;emploi du temps pré-remplit l&apos;espace et
            signale ces créneaux, sans les fermer.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Espaces attribués</h3>
            {!lectureSeule && sallesReelles.length > 0 && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => modifier({ ...brouillon, espaces: [...sallesReelles] }, 'espaces')}
                >
                  Toutes
                </Button>
                <Button variant="ghost" size="sm" onClick={() => modifier({ ...brouillon, espaces: [] }, 'espaces')}>
                  Aucune
                </Button>
              </div>
            )}
          </div>

          {sallesReelles.length === 0 && !avecTeams ? (
            <p className="text-sm text-muted-foreground">
              Aucun espace déclaré. Ajoutez-les dans Paramètres → Espaces.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {/*
                ⚠️ « TEAMS » EST ATTRIBUÉ À TOUS LES FORMATEURS (2026-09-19, demande du
                porteur) : coché d'office et NON modifiable. Il n'est pas écrit dans la
                liste de ce formateur — c'est une règle, pas une donnée : un formateur
                ajouté demain l'a aussi, et personne n'a à le cocher un par un.
              */}
              {avecTeams && (
                <span
                  aria-label="TEAMS, attribué à tous les formateurs"
                  title="Attribué à tous les formateurs"
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground opacity-80"
                >
                  <Lock className="size-3" />
                  TEAMS
                </span>
              )}
              {sallesReelles.map((salle) => {
                const retenue = brouillon.espaces.includes(salle);
                return (
                  <button
                    key={salle}
                    type="button"
                    disabled={lectureSeule}
                    aria-pressed={retenue}
                    {...glissement('salle', retenue, (valeur) => poserSalle(salle, valeur))}
                    className={cn(
                      'touch-none select-none rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-default',
                      retenue
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-accent'
                    )}
                  >
                    {salle}
                  </button>
                );
              })}
            </div>
          )}
          {/* ⚠️ LE VIDE EST DIT : sans cette phrase, « aucune » se lirait « interdit partout ». */}
          <p className="text-xs text-muted-foreground">
            {brouillon.espaces.length === 0
              ? `${avecTeams ? 'Seul TEAMS est attribué' : 'Aucun espace attribué'} : aucun local n’est pré-rempli dans l’emploi du temps, et tous restent au choix.`
              : `${brouillon.espaces.length} espace(s) — proposés en premier, dans l'ordre de sélection.`}
          </p>
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Créneaux d&apos;indisponibilité</h3>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              <span className="font-semibold tabular-nums text-success">
                {heuresLibres.toLocaleString('fr-FR')} h
              </span>{' '}
              libres · {creneauxLibres} créneau(x)
            </p>
          </div>
          {!lectureSeule && (
            <p className="text-xs text-muted-foreground">
              Cliquez une case, ou glissez sur plusieurs pour les basculer d&apos;un coup.
            </p>
          )}
          {/* ⚠️ `table-fixed` + <colgroup> : sans eux, la largeur suit le texte
              (« Indisponible » élargit sa colonne) et la grille se déforme à chaque clic. */}
          <table className="w-full table-fixed border-separate border-spacing-1 text-xs">
            <colgroup>
              <col className="w-24" />
              {CRENEAUX_CONTRAINTES.map((seance) => (
                <col key={seance} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th />
                {CRENEAUX_CONTRAINTES.map((seance) => (
                  <th key={seance} className="font-medium text-muted-foreground">
                    {seance}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {JOURS.map((jour) => (
                <tr key={jour}>
                  <th className="text-left font-medium">
                    {lectureSeule ? (
                      jour
                    ) : (
                      // Le jour entier d'un clic : c'est le cas le plus courant.
                      <button type="button" className="hover:underline" onClick={() => basculerJour(jour)}>
                        {jour}
                      </button>
                    )}
                  </th>
                  {CRENEAUX_CONTRAINTES.map((seance) => {
                    const rouge = indisponible.has(`${jour}|${seance}`);
                    return (
                      <td key={seance}>
                        <button
                          type="button"
                          disabled={lectureSeule}
                          aria-pressed={rouge}
                          aria-label={`${jour} ${seance} ${rouge ? 'indisponible' : 'disponible'}`}
                          {...glissement('creneau', rouge, (valeur) => poserCreneaux([{ jour, seance }], valeur))}
                          className={cn(
                            'h-8 w-full touch-none select-none rounded-md border transition-colors disabled:cursor-default',
                            rouge
                              ? 'border-destructive/40 bg-destructive/15 font-medium text-destructive'
                              : 'bg-success/10 text-success hover:bg-success/20'
                          )}
                        >
                          {rouge ? 'Indisponible' : 'Libre'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {!lectureSeule && (
          <p className="text-right text-xs text-muted-foreground" aria-live="polite">
            {
              {
                repos: 'Enregistrement automatique',
                attente: 'Modification en attente…',
                envoi: 'Enregistrement…',
                ok: 'Enregistré',
                erreur: 'Non enregistré',
              }[etat]
            }
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
