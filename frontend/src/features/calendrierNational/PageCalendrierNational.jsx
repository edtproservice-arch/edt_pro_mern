import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, GraduationCap } from 'lucide-react';
import { anneeScolaireAPreparer, libelleAnneeScolaire } from 'shared/domain';
import BarreNavigation from '@/components/layout/BarreNavigation';
import SectionsAdmin from '@/features/admin/components/SectionsAdmin';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import EtapeCalendrier from '@/features/configuration/etapes/EtapeCalendrier';
import Alerte from '@/components/common/Alerte';
import {
  IndicateurEnregistrement,
  useEnregistrementAuto,
} from '@/components/common/enregistrementAuto';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  chargerJoursFeriesNationaux,
  chargerPourAdmin,
  enregistrerCalendrierNational,
} from './api';

/**
 * Calendrier national — vacances du réseau et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ CE QUI EST SAISI ICI S'APPLIQUE À TOUT LE RÉSEAU ═══
 * Les vacances apparaissent PAR DÉFAUT sur le calendrier de chaque directeur —
 * qui peut ajouter les siennes et écarter une période qui ne le concerne pas.
 * Les dates de rentrée, elles, GÈLENT l'emploi du temps et le chronogramme de
 * tous les groupes de l'année de formation concernée, jusqu'à leur reprise.
 *
 * ═══ ⚠️ LE CALENDRIER EST LE COMPOSANT DE LA CONFIGURATION, PAS UNE COPIE ═══
 * `EtapeCalendrier` est déjà partagé entre l'assistant et la page Paramètres :
 * une période de vacances se trace de la même façon aux trois endroits. En
 * écrire un second jeu, ce serait deux comportements à tenir cohérents — la
 * cause n°1 d'instabilité du §4.2.
 */
/**
 * ⚠️ TROIS ANNÉES DE FORMATION, PAS CINQ (correction du porteur, 2026-09-03 :
 * « il y a seulement trois niveaux 1e, 2e, 3e, si tu vois la répartition
 * DRIF »). Le référentiel ne connaît que `anneeFormation` 1 à 3 ; les deux
 * champs de trop invitaient à saisir une rentrée qui n'aurait jamais gelé aucun
 * groupe — aucun nom de groupe ne porte de 4.
 *
 * ⚠️ UN ÉTABLISSEMENT SANS 3ᵉ ANNÉE N'EST PAS UN CAS À TRAITER : une date sans
 * groupe correspondant ne gèle rien, et le porteur l'a explicitement écarté.
 */
const ANNEES_FORMATION = [1, 2, 3];

export default function PageCalendrierNational() {
  const cache = useQueryClient();
  const [annee, setAnnee] = useState(() => anneeScolaireAPreparer(new Date()));
  const [brouillon, setBrouillon] = useState(null);

  const enregistre = useQuery({
    queryKey: ['calendrier-national', annee],
    queryFn: () => chargerPourAdmin(annee),
    retry: false,
  });

  /*
   * ⚠️ LE BROUILLON SE POSE À L'ARRIVÉE DES DONNÉES, ET SE REMET À ZÉRO EN
   * CHANGEANT D'ANNÉE : sans cela, les vacances de 2026-2027 resteraient à
   * l'écran après une bascule sur 2027-2028, et le premier enregistrement les y
   * écrirait.
   */
  useEffect(() => {
    setBrouillon(null);
  }, [annee]);

  useEffect(() => {
    if (brouillon === null && enregistre.data) {
      setBrouillon({
        vacances: enregistre.data.vacances ?? [],
        rentrees: enregistre.data.rentrees ?? [],
      });
    }
  }, [enregistre.data, brouillon]);

  const enregistrement = useMutation({
    mutationFn: (corps) => enregistrerCalendrierNational(annee, corps),
    onSuccess: () => {
      /*
       * ⚠️ ON NE REPOSE PLUS LE BROUILLON DEPUIS LA RÉPONSE. En saisie
       * automatique, une frappe peut partir pendant qu'une écriture est en vol :
       * réécrire l'état avec ce que le serveur vient de confirmer effacerait
       * cette frappe. Le brouillon fait foi tant qu'on est sur la page.
       */
      cache.invalidateQueries({ queryKey: ['calendrier-national'] });
    },
    /*
     * ⚠️ L'ÉCHEC RESTE ANNONCÉ. Sans bouton, un refus silencieux laisserait
     * croire le réseau à jour — c'est exactement ce que l'indicateur « Non
     * enregistré » existe pour dire, et le toast le double parce qu'un
     * administrateur peut être en train de regarder le calendrier, pas
     * l'en-tête.
     */
    onError: (erreur) => toast.error('Calendrier non enregistré', {
      description: erreur.message,
    }),
  });

  /*
   * ═══ ⚠️⚠️ ENREGISTREMENT AUTOMATIQUE — DÉCISION DU PORTEUR (2026-09-03) ═══
   * Elle REVIENT sur le bouton posé la veille, dont le motif était que ce qui
   * s'écrit ici vaut pour TOUT LE RÉSEAU. Le porteur l'a tranché : la page
   * s'enregistre seule, comme tous les autres écrans de réglages.
   *
   * Ce qui rend l'automatisme tenable ici est ce qui le rend tenable ailleurs :
   * une PAUSE de 900 ms — on écrit après la dernière frappe, pas après la
   * première — et un ÉTAT VISIBLE en tête, seul accusé de réception d'une page
   * sans bouton.
   *
   * ⚠️ LA COMPARAISON PORTE SUR LES DEUX LISTES. Ne surveiller que les vacances
   * laisserait une date de rentrée saisie sans jamais être écrite — et c'est
   * elle qui gèle l'emploi du temps de tout le réseau.
   */
  const enregistre_ = enregistre.data;
  const modifie =
    brouillon !== null &&
    enregistre_ !== undefined &&
    JSON.stringify(brouillon) !==
      JSON.stringify({
        vacances: enregistre_.vacances ?? [],
        rentrees: enregistre_.rentrees ?? [],
      });

  const enregistreUneFois = useEnregistrementAuto({
    modifie,
    valeur: brouillon,
    onEnregistrer: () => enregistrement.mutate(brouillon),
    // Une écriture à la fois : deux envois croisés pourraient revenir dans le désordre.
    enCours: enregistrement.isPending,
  });

  const poserRentree = (anneeFormation, date) => {
    setBrouillon((actuel) => {
      const autres = (actuel?.rentrees ?? []).filter(
        (r) => r.anneeFormation !== anneeFormation
      );
      /* Une date effacée RETIRE la rentrée : sans réglage, rien n'est gelé. */
      return {
        ...actuel,
        rentrees: date ? [...autres, { anneeFormation, date }] : autres,
      };
    });
  };

  const dateDe = (anneeFormation) =>
    brouillon?.rentrees?.find((r) => r.anneeFormation === anneeFormation)?.date ?? '';

  const annees = [annee - 1, annee, annee + 1];

  return (
    <>
      <BarreNavigation titre="Administration" liens={<SectionsAdmin />} messagerie />

      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <BandeCartes className="lg:grid-cols-3">
            <CarteStat
              Icone={CalendarDays}
              libelle="Périodes de vacances"
              valeur={brouillon?.vacances?.length ?? '—'}
              teinte="text-primary"
              fond="bg-primary/10"
              detail={
                <span className="text-muted-foreground">
                  proposées par défaut à tous les établissements
                </span>
              }
            />
            <CarteStat
              Icone={GraduationCap}
              libelle="Rentrées paramétrées"
              valeur={brouillon?.rentrees?.length ?? '—'}
              teinte={brouillon?.rentrees?.length ? 'text-success' : 'text-muted-foreground'}
              fond={brouillon?.rentrees?.length ? 'bg-success/10' : 'bg-muted'}
              detail={
                <span className="text-muted-foreground">
                  {brouillon?.rentrees?.length
                    ? 'les jours qui précèdent sont gelés'
                    : 'aucun gel tant que rien n’est saisi'}
                </span>
              }
            />
            <div className="flex items-center gap-3 bg-card p-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="annee">Année scolaire</Label>
                <Select value={String(annee)} onValueChange={(v) => setAnnee(Number(v))}>
                  <SelectTrigger id="annee">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {annees.map((valeur) => (
                      <SelectItem key={valeur} value={String(valeur)}>
                        {libelleAnneeScolaire(valeur)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </BandeCartes>

          {/*
            L'état de l'écriture, TOUJOURS à la même place. Il remplace le bouton
            disparu : sans lui, rien ne dirait si la saisie est partie.
          */}
          <div className="flex justify-end">
            <IndicateurEnregistrement
              modifie={modifie}
              enCours={enregistrement.isPending}
              echec={enregistrement.isError}
              enregistreUneFois={enregistreUneFois}
            />
          </div>

          {enregistre.isError && (
            <Alerte type="erreur" titre="Accès refusé">
              {enregistre.error.message} — cet écran est réservé aux administrateurs.
            </Alerte>
          )}

          {!brouillon ? (
            <IndicateurChargement />
          ) : (
            <>
              <section aria-label="Dates de rentrée" className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    Rentrée par année de formation — {libelleAnneeScolaire(annee)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Les jours qui précèdent la rentrée d’une année sont GELÉS sur l’emploi du
                    temps et le chronogramme, pour les groupes de cette année seulement. Une
                    date laissée vide ne gèle rien.
                  </p>
                </div>

                {/*
                  ⚠️ UN CHAMP PAR ANNÉE DE FORMATION, PAS UNE LISTE À COMPLÉTER :
                  les cinq lignes existent d'emblée, vides. Un bouton « ajouter
                  une rentrée » demanderait de choisir l'année dans une liste,
                  pour cinq valeurs connues d'avance.
                */}
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-5">
                  {ANNEES_FORMATION.map((anneeFormation) => (
                    <div key={anneeFormation} className="space-y-1.5 bg-card p-4">
                      <Label htmlFor={`rentree-${anneeFormation}`}>
                        {anneeFormation}
                        <sup>{anneeFormation === 1 ? 're' : 'e'}</sup> année
                      </Label>
                      <Input
                        id={`rentree-${anneeFormation}`}
                        type="date"
                        value={dateDe(anneeFormation)}
                        onChange={(e) => poserRentree(anneeFormation, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Vacances" className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Vacances du réseau</h2>
                  <p className="text-sm text-muted-foreground">
                    Elles s’affichent par défaut chez tous les directeurs, qui peuvent en
                    écarter une et ajouter les leurs.
                  </p>
                </div>

                {/* Le composant de la configuration, réutilisé tel quel. */}
                <EtapeCalendrier
                  anneeScolaire={annee}
                  /*
                    ⚠️ LES FÉRIÉS VIENNENT DE LA ROUTE NATIONALE : celle du
                    directeur exige un établissement, et l'administrateur n'en a
                    aucun — elle répondait 403, et l'écran l'annonçait comme une
                    panne de l'API.
                  */
                  chargerFeries={chargerJoursFeriesNationaux}
                  valeur={{ vacances: brouillon.vacances }}
                  onChange={(valeur) =>
                    setBrouillon((actuel) => ({ ...actuel, vacances: valeur.vacances }))
                  }
                />
              </section>

            </>
          )}
        </div>
      </main>
    </>
  );
}
