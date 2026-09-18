import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { REGIONS_OFPPT } from 'shared/constants';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Alerte from '@/components/common/Alerte';
import { chargerComplexes } from './api';

/**
 * Ajout et modification d'un établissement du réseau.
 *
 * ═══ LE FLUX EST CELUI DÉCRIT PAR LE PORTEUR (2026-09-02) ═══
 *   · le complexe existe → région, puis on le CHOISIT, puis on nomme
 *     l'établissement ;
 *   · il n'existe pas → région, puis on SAISIT le complexe, puis l'établissement.
 *
 * ⚠️ UN SEUL CHAMP POUR LES DEUX CAS, PAS DEUX FORMULAIRES : ce sont les mêmes
 * trois valeurs à saisir, et l'on ne sait qu'au dernier moment si le complexe
 * existe. Une bascule « existant / nouveau » suffit, et elle bascule TOUTE SEULE
 * quand la région n'a encore aucun complexe.
 */
const NOUVEAU = '__nouveau__';

export default function FormulaireEtablissement({
  ouvert,
  etablissement,
  defauts,
  enCours,
  erreur,
  onFermer,
  onEnregistrer,
}) {
  const [region, setRegion] = useState('');
  const [complexe, setComplexe] = useState('');
  const [nouveauComplexe, setNouveauComplexe] = useState(false);
  const [nom, setNom] = useState('');

  const complexes = useQuery({
    queryKey: ['reseau-complexes', region],
    queryFn: () => chargerComplexes(region),
    enabled: Boolean(region),
    staleTime: 60_000,
  });

  const liste = complexes.data?.complexes ?? [];

  /*
   * ⚠️ LES VALEURS SE POSENT À L'OUVERTURE, pas à chaque rendu : sans cette
   * dépendance sur `ouvert`, une frappe serait écrasée au rendu suivant et le
   * champ paraîtrait refuser la saisie.
   */
  useEffect(() => {
    if (!ouvert) return;
    const depart = { region: '', complexe: '', nom: '', ...(defauts ?? {}), ...(etablissement ?? {}) };
    setRegion(depart.region);
    setComplexe(depart.complexe);
    setNom(depart.nom);
    setNouveauComplexe(false);
  }, [ouvert, etablissement, defauts]);

  /*
   * ⚠️ UNE RÉGION SANS AUCUN COMPLEXE BASCULE D'ELLE-MÊME EN SAISIE : huit des
   * dix régions sont vides aujourd'hui. Y présenter une liste déroulante vide
   * laisserait croire qu'on ne peut rien y ajouter.
   *
   * ═══ ⚠️⚠️ ON ATTEND QUE LA REQUÊTE SOIT RETOMBÉE, PAS SEULEMENT `isLoading`
   * ═══ (défaut constaté à l'écran, 2026-09-02.) `isLoading` ne vaut vrai qu'au
   * TOUT PREMIER chargement : une liste déjà en cache mais PÉRIMÉE le laisse à
   * faux pendant qu'elle se recharge — et pendant ce temps, `liste` est encore
   * l'ancienne, vide. La bascule se déclenchait donc sur une donnée dépassée, et
   * ne revenait jamais en arrière : après avoir créé le premier complexe d'une
   * région, le champ restait en saisie libre au lieu de le proposer.
   * `isFetching` couvre les deux cas.
   */
  useEffect(() => {
    if (!region || complexes.isFetching) return;
    if (liste.length === 0) setNouveauComplexe(true);
  }, [region, liste.length, complexes.isFetching]);

  /*
   * ⚠️ L'ENTRÉE « + Nouveau complexe… » N'EST PAS UNE VALEUR, c'est un GESTE :
   * elle bascule le champ en saisie libre. La poser telle quelle dans l'état
   * enregistrerait un complexe nommé « __nouveau__ ».
   */
  const choisirComplexe = (valeur) => {
    if (valeur === NOUVEAU) {
      setNouveauComplexe(true);
      setComplexe('');
      return;
    }
    setComplexe(valeur);
  };

  const changerRegion = (valeur) => {
    setRegion(valeur);
    /* Un complexe appartient à SA région : le garder en changeant de région
       rangerait l'établissement sous un complexe qui n'y existe pas. */
    setComplexe('');
    setNouveauComplexe(false);
  };

  const complet = region !== '' && complexe.trim() !== '' && nom.trim() !== '';

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {etablissement ? 'Modifier l’établissement' : 'Ajouter un établissement'}
          </DialogTitle>
          <DialogDescription>
            Cette liste est celle que voient les directeurs à l’inscription : région, puis
            complexe, puis établissement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {erreur && (
            <Alerte type="erreur" titre="Enregistrement refusé">
              {erreur.message}
            </Alerte>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="region">Région</Label>
            <Select value={region} onValueChange={changerRegion}>
              <SelectTrigger id="region">
                <SelectValue placeholder="Choisir une région" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS_OFPPT.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {valeur}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="complexe">Complexe</Label>
              {/* ⚠️ LA BASCULE N'APPARAÎT QUE S'IL Y A UN CHOIX À FAIRE : sur une
                  région vide, proposer « choisir dans la liste » n'aurait aucun
                  sens — il n'y a rien dedans. */}
              {region && liste.length > 0 && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => {
                    setNouveauComplexe((actuel) => !actuel);
                    setComplexe('');
                  }}
                >
                  {nouveauComplexe ? 'Choisir un complexe existant' : 'Nouveau complexe'}
                </Button>
              )}
            </div>

            {nouveauComplexe || liste.length === 0 ? (
              <div className="relative">
                <Plus className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="complexe"
                  value={complexe}
                  disabled={!region}
                  onChange={(e) => setComplexe(e.target.value)}
                  placeholder={region ? 'Nom du nouveau complexe' : 'Choisissez d’abord une région'}
                  className="pl-8"
                />
              </div>
            ) : (
              <Select value={complexe} onValueChange={choisirComplexe} disabled={!region}>
                <SelectTrigger id="complexe">
                  <SelectValue placeholder="Choisir un complexe" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(28rem,90vw)]">
                  {liste.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {valeur}
                    </SelectItem>
                  ))}
                  {/* Radix refuse un `SelectItem` de valeur vide : le jeton sert
                      d'entrée « je crée le mien ». */}
                  <SelectItem value={NOUVEAU}>+ Nouveau complexe…</SelectItem>
                </SelectContent>
              </Select>
            )}

            {region && !complexes.isLoading && liste.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucun complexe dans cette région : le premier se crée en le nommant ici.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nom">Établissement</Label>
            <Input
              id="nom"
              value={nom}
              disabled={!region}
              onChange={(e) => setNom(e.target.value)}
              placeholder="INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFermer} disabled={enCours}>
            Annuler
          </Button>
          <Button
            onClick={() =>
              onEnregistrer({ region, complexe: complexe.trim(), nom: nom.trim() })
            }
            disabled={!complet || enCours}
          >
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
