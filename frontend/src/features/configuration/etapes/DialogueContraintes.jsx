import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { JOURS } from 'shared/constants';
import { CRENEAUX_CONTRAINTES, normaliserContraintes } from 'shared/domain';
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

  // À chaque ouverture, on repart de ce que la base porte.
  useEffect(() => {
    if (ouvert) {
      setBrouillon(depart());
      setEtat('repos');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

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

  const basculerSalle = (salle) =>
    modifier({
      ...brouillon,
      espaces: brouillon.espaces.includes(salle)
        ? brouillon.espaces.filter((s) => s !== salle)
        : [...brouillon.espaces, salle],
    }, 'espaces');

  const poserCreneaux = (creneaux, valeur) => {
    const cles = new Set(indisponible);
    for (const { jour, seance } of creneaux) {
      if (valeur) cles.add(`${jour}|${seance}`);
      else cles.delete(`${jour}|${seance}`);
    }
    const liste = [...cles].map((cle) => {
      const [jour, seance] = cle.split('|');
      return { jour, seance };
    });
    modifier(
      { ...brouillon, indisponibilites: normaliserContraintes({ indisponibilites: liste }).indisponibilites },
      'indisponibilites'
    );
  };

  const basculerJour = (jour) => {
    const creneaux = CRENEAUX_CONTRAINTES.map((seance) => ({ jour, seance }));
    const toutRouge = creneaux.every((c) => indisponible.has(`${c.jour}|${c.seance}`));
    poserCreneaux(creneaux, !toutRouge);
  };

  const sallesReelles = salles
    .filter((s) => String(s).toUpperCase() !== 'TEAMS')
    .sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{nom}</DialogTitle>
          <DialogDescription>
            Salles attribuées et créneaux à éviter. L&apos;emploi du temps pré-remplit la salle et
            signale ces créneaux, sans les fermer.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Salles attribuées</h3>
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

          {sallesReelles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune salle déclarée. Ajoutez-les dans Paramètres → Espaces.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sallesReelles.map((salle) => {
                const retenue = brouillon.espaces.includes(salle);
                return (
                  <button
                    key={salle}
                    type="button"
                    disabled={lectureSeule}
                    aria-pressed={retenue}
                    onClick={() => basculerSalle(salle)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-default',
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
              ? 'Aucune salle cochée : toutes les salles restent proposées.'
              : `${brouillon.espaces.length} salle(s) — proposées en premier, dans l'ordre de sélection.`}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Créneaux à éviter</h3>
          <table className="w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-24" />
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
                          aria-label={`${jour} ${seance} ${rouge ? 'à éviter' : 'disponible'}`}
                          onClick={() => poserCreneaux([{ jour, seance }], !rouge)}
                          className={cn(
                            'h-8 w-full rounded-md border transition-colors disabled:cursor-default',
                            rouge
                              ? 'border-destructive/40 bg-destructive/15 font-medium text-destructive'
                              : 'bg-success/10 text-success hover:bg-success/20'
                          )}
                        >
                          {rouge ? 'À éviter' : 'Libre'}
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
