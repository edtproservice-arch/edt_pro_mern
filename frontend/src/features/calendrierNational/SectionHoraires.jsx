import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Clock, RotateCcw } from 'lucide-react';
import {
  LIBELLES_HORAIRES,
  NOMS_HORAIRES,
  erreursHoraire,
  horaireParDefaut,
} from 'shared/domain';
import { SEANCES } from 'shared/constants';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { useEnregistrementAuto } from '@/components/common/enregistrementAuto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { chargerHorairesSeances, enregistrerHorairesSeances } from '@/features/horaires/api';

/**
 * Horaires des séances — hiver, été, ramadan. (demande du porteur, 2026-09-20 : « en admin,
 * page calendrier, l'option de changer l'horaire ; les valeurs sont par défaut, je peux les
 * modifier ; le changement s'applique dans toutes les sessions ».)
 *
 * ═══ ⚠️ CE QUI EST CHOISI ICI S'APPLIQUE À TOUT LE RÉSEAU, TOUT DE SUITE ═══
 * Directeurs, gestionnaires, formateurs et stagiaires lisent l'horaire en vigueur pour afficher
 * l'heure de leurs cours. Il ne dépend pas de l'année scolaire — c'est pourquoi la section vit
 * au-dessus du choix d'année de la page — et l'administrateur bascule d'un jeu à l'autre
 * quand la période change (début du ramadan, retour à l'horaire d'été…).
 *
 * ⚠️ LES HEURES COMPTÉES NE BOUGENT PAS : un créneau de ramadan de 1 h 50 reste une séance de
 * 2,5 h au décompte. Seuls l'heure affichée, « terminée ? » et les pauses suivent le jeu.
 *
 * ⚠️ ENREGISTREMENT AUTOMATIQUE, COMME LE RESTE DE LA PAGE — mais SEULEMENT si le jeu est
 * cohérent (`erreursHoraire`, la même règle que le serveur) : un horaire à moitié saisi ne
 * doit jamais partir vers tous les comptes.
 */
const CRENEAUX = SEANCES.slice(0, 4);

/**
 * ⚠️ UN SEUL INDICATEUR D'ENREGISTREMENT POUR TOUTE LA PAGE (2026-09-20, demande du porteur) :
 * la section n'affiche pas le sien, elle RAPPORTE son état à la page (`surEtat`), qui le
 * combine à celui du calendrier — un accusé de réception, pas deux qui se contredisent.
 *
 * @param {(etat: {modifie: boolean, enCours: boolean, echec: boolean, enregistreUneFois: boolean}) => void} [props.surEtat]
 */
export default function SectionHoraires({ surEtat }) {
  const cache = useQueryClient();
  const [brouillon, setBrouillon] = useState(null);
  const [confirmerReinitialisation, setConfirmerReinitialisation] = useState(false);
  const [tableauOuvert, setTableauOuvert] = useState(false);

  const enregistre = useQuery({
    queryKey: ['horaires-seances'],
    queryFn: chargerHorairesSeances,
    retry: false,
  });

  useEffect(() => {
    if (brouillon === null && enregistre.data) {
      setBrouillon({ actif: enregistre.data.actif, horaires: enregistre.data.horaires });
    }
  }, [enregistre.data, brouillon]);

  const enregistrement = useMutation({
    // ⚠️ Une fonction explicite : TanStack Query passe un second argument à `mutationFn`.
    mutationFn: (corps) => enregistrerHorairesSeances(corps),
    // Le brouillon fait foi tant qu'on est sur la page (comme le calendrier, juste au-dessous).
    onSuccess: () => cache.invalidateQueries({ queryKey: ['horaires-seances'] }),
    onError: (erreur) =>
      toast.error('Horaires non enregistrés', { description: erreur.message }),
  });

  const erreurs = useMemo(() => {
    const parJeu = {};
    for (const nom of NOMS_HORAIRES) {
      parJeu[nom] = brouillon ? erreursHoraire(brouillon.horaires[nom]) : [];
    }
    return parJeu;
  }, [brouillon]);
  const coherent = NOMS_HORAIRES.every((nom) => erreurs[nom].length === 0);

  const modifie =
    brouillon !== null &&
    enregistre.data !== undefined &&
    JSON.stringify(brouillon) !==
      JSON.stringify({ actif: enregistre.data.actif, horaires: enregistre.data.horaires });

  const enregistreUneFois = useEnregistrementAuto({
    modifie: modifie && coherent,
    valeur: brouillon,
    onEnregistrer: () => enregistrement.mutate(brouillon),
    enCours: enregistrement.isPending,
  });

  /*
   * ═══ ⚠️ LE TABLEAU MONTRE L'HORAIRE COCHÉ (2026-09-20, demande du porteur : « puisqu'il existe
   * des cartes pour basculer, annuler les onglets ») ═══ Une seule sélection : la carte choisie
   * est à la fois l'horaire en vigueur et celui qu'on modifie dessous. Pour régler le ramadan,
   * on le coche — il devient alors l'horaire en vigueur, ce que l'enregistrement automatique
   * applique tout de suite.
   */
  const edite = brouillon?.actif;

  const attente = modifie && coherent;
  const enCoursEcriture = enregistrement.isPending;
  const echec = enregistrement.isError;
  useEffect(() => {
    surEtat?.({ modifie: attente, enCours: enCoursEcriture, echec, enregistreUneFois });
    // `surEtat` est posée par la page ; seules les quatre valeurs comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attente, enCoursEcriture, echec, enregistreUneFois]);

  const poserHeure = (nom, tableau, creneau, champ, valeur) =>
    setBrouillon((actuel) => ({
      ...actuel,
      horaires: {
        ...actuel.horaires,
        [nom]: {
          ...actuel.horaires[nom],
          [tableau]: {
            ...actuel.horaires[nom][tableau],
            [creneau]: { ...actuel.horaires[nom][tableau][creneau], [champ]: valeur },
          },
        },
      },
    }));

  const retablir = () => {
    setBrouillon((actuel) => ({
      ...actuel,
      horaires: { ...actuel.horaires, [edite]: horaireParDefaut(edite) },
    }));
    setConfirmerReinitialisation(false);
  };

  // Les avertissements du jeu affiché — toujours visibles, volet replié ou non.
  const avertissements = () => (
    <div className="space-y-3">
      {erreurs[edite].length > 0 && (
        <Alerte type="avertissement" titre="Horaire à corriger — rien n’est enregistré tant qu’il l’est">
          <ul className="list-disc pl-4">
            {erreurs[edite].map((e) => (
              <li key={`${e.tableau}-${e.creneau}-${e.champ}`}>
                {e.creneau} ({e.tableau === 'vendredi' ? 'vendredi' : 'lundi à jeudi et samedi'}) :{' '}
                {e.message}
              </li>
            ))}
          </ul>
        </Alerte>
      )}
      {!coherent && erreurs[edite].length === 0 && (
        <Alerte type="avertissement">
          Un autre horaire contient une erreur (repérée par le point rouge sur sa carte) :
          rien n’est enregistré tant qu’elle n’est pas corrigée. Cochez-le pour la corriger.
        </Alerte>
      )}
    </div>
  );

  return (
    <section aria-label="Horaires des séances" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4" />
            Horaires des séances
          </h2>
          <p className="text-sm text-muted-foreground">
            L’horaire en vigueur s’applique tout de suite chez tous les comptes — directeurs,
            gestionnaires, formateurs et stagiaires — pour toutes les années scolaires. Les heures
            comptées (2,5 h par séance) ne changent pas.
          </p>
        </div>
      </div>

      {enregistre.isError && (
        <Alerte type="erreur" titre="Horaires indisponibles">
          {enregistre.error.message}
        </Alerte>
      )}

      {!brouillon ? (
        !enregistre.isError && <IndicateurChargement />
      ) : (
        <>
          {/* L'horaire EN VIGUEUR : un seul, pour tout le réseau. */}
          <RadioGroup
            value={brouillon.actif}
            onValueChange={(actif) => setBrouillon((actuel) => ({ ...actuel, actif }))}
            aria-label="Horaire en vigueur"
            className="grid gap-3 sm:grid-cols-3"
          >
            {NOMS_HORAIRES.map((nom) => {
              const actif = brouillon.actif === nom;
              return (
                <label
                  key={nom}
                  htmlFor={`horaire-${nom}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-4 transition-colors',
                    actif ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50'
                  )}
                >
                  <RadioGroupItem id={`horaire-${nom}`} value={nom} />
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {LIBELLES_HORAIRES[nom]}
                      {actif && <Badge variant="secondary">En vigueur</Badge>}
                      {erreurs[nom].length > 0 && (
                        <span className="size-1.5 rounded-full bg-destructive" role="img" aria-label="à corriger" />
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>

          {/*
            ═══ LE TABLEAU EST REPLIÉ PAR DÉFAUT (2026-09-20, demande du porteur) ═══ On choisit
            l'horaire d'un clic sur sa carte ; les heures ne se déplient que pour les modifier.
            Les AVERTISSEMENTS, eux, restent hors du volet : un horaire à corriger dont rien
            ne serait enregistré ne doit pas se cacher derrière un bouton.
          */}
          <Collapsible open={tableauOuvert} onOpenChange={setTableauOuvert} className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <h3 className="text-sm font-medium">{LIBELLES_HORAIRES[edite]}</h3>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {tableauOuvert ? 'Masquer les heures' : 'Modifier les heures'}
                  <ChevronDown className={cn('size-4 transition-transform', tableauOuvert && 'rotate-180')} />
                </Button>
              </CollapsibleTrigger>
            </div>

            {(erreurs[edite].length > 0 || !coherent) && (
              <div className="px-4 pb-4">
                {avertissements()}
              </div>
            )}

            <CollapsibleContent className="space-y-3 border-t p-4">
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmerReinitialisation(true)}>
                <RotateCcw className="size-4" />
                Rétablir les valeurs par défaut
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th rowSpan={2} className="w-16 pb-2 pr-3 font-medium">
                      Séance
                    </th>
                    <th colSpan={2} className="px-1 pb-1 font-medium">
                      Lundi – Jeudi et samedi
                    </th>
                    <th colSpan={2} className="px-1 pb-1 font-medium">
                      Vendredi
                    </th>
                  </tr>
                  <tr className="text-left text-xs text-muted-foreground">
                    {['Début', 'Fin', 'Début', 'Fin'].map((entete, i) => (
                      <th key={i} className="px-1 pb-2 font-medium">
                        {entete}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CRENEAUX.map((creneau) => (
                    <tr key={creneau} className="border-t">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {creneau}
                      </th>
                      {['semaine', 'vendredi'].flatMap((tableau) =>
                        ['debut', 'fin'].map((champ) => {
                          const erreur = erreurs[edite].find(
                            (e) => e.tableau === tableau && e.creneau === creneau && e.champ === champ
                          );
                          return (
                            <td key={`${tableau}-${champ}`} className="px-1 py-1.5 align-top">
                              <Input
                                type="time"
                                step={60}
                                value={brouillon.horaires[edite][tableau][creneau][champ]}
                                onChange={(e) => poserHeure(edite, tableau, creneau, champ, e.target.value)}
                                aria-label={`${LIBELLES_HORAIRES[edite]} — ${creneau}, ${
                                  tableau === 'vendredi' ? 'vendredi' : 'lundi à jeudi et samedi'
                                }, ${champ === 'debut' ? 'début' : 'fin'}`}
                                aria-invalid={Boolean(erreur)}
                                title={erreur?.message}
                                className={cn(
                                  'h-9 w-full tabular-nums',
                                  erreur && 'border-destructive focus-visible:ring-destructive'
                                )}
                              />
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Le vendredi a son propre tableau : la prière de midi décale la reprise de S3. Un écart
              entre deux créneaux est une pause, affichée telle quelle dans l’agenda ; deux
              créneaux ne peuvent pas se chevaucher. Le créneau du soir (19h – 21h) ne se règle pas
              ici.
            </p>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      <ConfirmationAction
        ouvert={confirmerReinitialisation}
        onOpenChange={setConfirmerReinitialisation}
        titre={`Rétablir ${edite ? LIBELLES_HORAIRES[edite].toLowerCase() : 'cet horaire'} ?`}
        description="Les heures de cet horaire reprennent leurs valeurs d’origine, pour les deux tableaux (semaine et vendredi)."
        libelleConfirmation="Rétablir"
        onConfirmer={retablir}
      />
    </section>
  );
}
