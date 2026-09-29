import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, DoorOpen, Network, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Alerte from '@/components/common/Alerte';
import { api } from '@/lib/apiClient';
import Noeud, { Flux } from '@/components/common/SchemaLiaison';
import { cn } from '@/lib/utils';

/**
 * Espaces MUTUALISÉS — partager une salle avec un autre établissement.
 * (demande du porteur, 2026-09-21 : « mutualiser un espace, c.-à-d. le partager avec un autre
 * établissement : celui-ci peut l'utiliser, à condition de vérifier le chevauchement ».)
 *
 * ═══ ⚠️ UN BOUTON, UNE FENÊTRE, ET UN SCHÉMA — DANS UNE FENÊTRE (2026-09-21, demande du porteur) ═══
 * Plus de liste de tous les espaces avec un bouton chacun : « Mutualiser » ouvre une fenêtre où
 * l'on CHOISIT l'espace puis les établissements auxquels le lier. Ce qui est déjà partagé se lit
 * en schéma — l'espace, un trait gris qui défile, les établissements — dans une seconde fenêtre,
 * « Voir les partages » : la page ne garde qu'un résumé, et l'espace qu'occupaient les cartes.
 *
 * ═══ ⚠️ CE QUE FAIT LE PARTAGE ═══
 * L'autre établissement voit l'espace dans SA liste, sous « Salle 4 (NOM DE L'ÉTABLISSEMENT) »,
 * et peut y poser ses séances. Le serveur refuse toute séance qui tomberait dans la salle au
 * moment où l'autre établissement l'occupe — dans les deux sens. Voir
 * `shared/domain/emploi/espacesMutualises.js`.
 *
 * ⚠️ LES PARTAGES S'ENREGISTRENT D'UN CLIC, PAS AVEC LA LISTE : ils touchent un AUTRE
 * établissement. Ils portent sur les espaces DÉJÀ ENREGISTRÉS — ceux que le serveur connaît.
 */
const CLE = ['espaces-mutualises'];

const chargerEtat = () => api.get('/api/v2/espaces-mutualises');
const chargerAnnuaire = (recherche) =>
  api.get(`/api/v2/espaces-mutualises/annuaire?recherche=${encodeURIComponent(recherche)}`);
const enregistrerPartage = (espace, etablissementIds) =>
  api.put('/api/v2/espaces-mutualises', { espace, etablissementIds });

/**
 * ═══ DEUX MORCEAUX, POSÉS À DEUX ENDROITS (2026-09-21, demande du porteur : « les deux boutons en
 * haut, sur la même ligne que « Vos espaces », à l'autre bout ») ═══
 * Les boutons vivent dans l'en-tête de la liste des espaces (`boutons`, à passer à
 * `EtapeEspaces`), les fenêtres à part (`section`, à poser n'importe où : elle ne dessine rien
 * tant qu'aucune n'est ouverte) : les deux partagent le même état — la lecture des partages et la
 * fenêtre ouverte —, d'où un crochet plutôt que deux composants qui se relanceraient la même
 * requête.
 *
 * @returns {{ boutons: import('react').ReactNode, section: import('react').ReactNode }}
 */
export function useEspacesMutualises({ lectureSeule = false } = {}) {
  // `null` : rien d'ouvert ; sinon `{ type: 'schema' }` ou `{ type: 'formulaire', espace }`.
  const [fenetre, setFenetre] = useState(null);

  const etat = useQuery({ queryKey: CLE, queryFn: chargerEtat, retry: false });

  // Chargement : rien à montrer — les boutons paraissent dès que la lecture répond.
  if (etat.isLoading) return { boutons: null, section: null, liste: null };
  if (etat.isError) {
    return {
      boutons: null,
      liste: null,
      section: (
        <Alerte type="avertissement" titre="Les espaces mutualisés n’ont pas pu être chargés">
          {etat.error.message}
        </Alerte>
      ),
    };
  }

  const { miens = [], empruntes = [] } = etat.data;
  const partages = miens.filter((m) => m.avec.length > 0);
  const nbLiens = partages.length + empruntes.length;

  const boutons = (
    <div className="flex flex-wrap gap-2">
      {nbLiens > 0 && (
        <Button type="button" variant="outline" onClick={() => setFenetre({ type: 'schema' })}>
          <Network className="size-4" />
          Voir les partages
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{nbLiens}</span>
        </Button>
      )}
      {!lectureSeule && (
        <Button
          type="button"
          onClick={() => setFenetre({ type: 'formulaire', espace: '' })}
          disabled={miens.length === 0}
        >
          <Share2 className="size-4" />
          Mutualiser
        </Button>
      )}
    </div>
  );

  /*
   * ⚠️ PLUS DE TITRE NI D'EXPLICATION SOUS LA LISTE (2026-09-21, demande du porteur : « supprime
   * cette partie ») : les boutons, sur la ligne « Vos espaces », suffisent. Ne reste ici que ce qui
   * n'a pas de place ailleurs — les deux fenêtres.
   */
  const section = (
    <>
      {fenetre?.type === 'schema' && (
        <FenetreSchema
          partages={partages}
          empruntes={empruntes}
          lectureSeule={lectureSeule}
          onModifier={(espace) => setFenetre({ type: 'formulaire', espace })}
          onFermer={() => setFenetre(null)}
        />
      )}

      {fenetre?.type === 'formulaire' && (
        <DialogueMutualisation
          miens={miens}
          espaceInitial={fenetre.espace}
          onFermer={() => setFenetre(null)}
        />
      )}
    </>
  );

  /*
   * ═══ CE QUE LA LISTE « VOS ESPACES » EN MONTRE (2026-09-23, demande du porteur : « afficher
   * les salles mutualisées parmi les salles en bas ») ═══ Les deux sens du partage, qu'on ne
   * voyait jusque-là qu'en ouvrant « Voir les partages » :
   *   - `empruntes` : les salles qu'un AUTRE établissement nous prête — utilisables dans nos
   *     emplois du temps, mais pas à nous : ni renommables ni supprimables d'ici ;
   *   - `partagees` : nos propres salles prêtées, nom de salle → établissements qui les ont.
   */
  const liste = {
    empruntes,
    partagees: new Map(partages.map((m) => [m.espace, m.avec.map((e) => e.nom)])),
  };

  return { boutons, section, liste };
}

/**
 * ═══ LE SCHÉMA VIT DANS UNE FENÊTRE (2026-09-21, demande du porteur : « cette partie dans le
 * modal, pour libérer de l'espace ») ═══ La page ne garde que le titre, les deux boutons et un
 * résumé : les cartes reliées, qui prenaient toute sa hauteur, s'ouvrent à la demande.
 */
function FenetreSchema({ partages, empruntes, lectureSeule, onModifier, onFermer }) {
  const cache = useQueryClient();

  // Retirer UN établissement d'un espace : on renvoie la liste des autres.
  const retrait = useMutation({
    // ⚠️ Une fonction explicite : TanStack Query passe un second argument à `mutationFn`.
    mutationFn: ({ espace, restants }) => enregistrerPartage(espace, restants),
    onSuccess: () => {
      toast.success('Partage retiré');
      cache.invalidateQueries({ queryKey: CLE });
    },
    onError: (erreur) => toast.error('Partage non retiré', { description: erreur.message }),
  });

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Partages d’espaces</DialogTitle>
          <DialogDescription>
            Un espace, un trait, les établissements qui peuvent l’utiliser.
            {!lectureSeule && ' Cliquez sur un espace pour modifier son partage.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-x-auto">
          {partages.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-center text-sm font-medium">Vos espaces partagés</h3>
              {partages.map(({ espace, avec }) => (
                <Flux
                  key={espace}
                  gauche={
                    <Noeud
                      Icone={DoorOpen}
                      titre={espace}
                      sousTitre="Votre espace"
                      pied={`${avec.length} établissement${avec.length > 1 ? 's' : ''}`}
                      surClic={lectureSeule ? undefined : () => onModifier(espace)}
                    />
                  }
                  droites={avec.map((etablissement) => ({
                    cle: etablissement.cle,
                    noeud: (
                      <Noeud
                        Icone={Building2}
                        titre={etablissement.nom}
                        sousTitre={[etablissement.complexe, etablissement.region].filter(Boolean).join(' · ')}
                        pied="Peut l’utiliser"
                        action={
                          !lectureSeule && (
                            <button
                              type="button"
                              aria-label={`Ne plus partager « ${espace} » avec ${etablissement.nom}`}
                              title="Ne plus partager"
                              disabled={retrait.isPending}
                              onClick={() =>
                                retrait.mutate({
                                  espace,
                                  restants: avec
                                    .filter((e) => e.cle !== etablissement.cle)
                                    .flatMap((e) => e.etablissementIds),
                                })
                              }
                              className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          )
                        }
                      />
                    ),
                  }))}
                />
              ))}
            </div>
          )}

          {empruntes.length > 0 && (
            <div className="space-y-4">
              <div className="space-y-1 text-center">
                <h3 className="text-sm font-medium">Espaces mis à votre disposition</h3>
                <p className="text-xs text-muted-foreground">
                  Ils se choisissent dans l’emploi du temps comme vos propres espaces.
                </p>
              </div>
              {empruntes.map((emprunte) => (
                <Flux
                  key={emprunte.libelle}
                  gauche={
                    <Noeud
                      Icone={Building2}
                      titre={emprunte.proprietaire.nom}
                      sousTitre={[emprunte.proprietaire.complexe, emprunte.proprietaire.region]
                        .filter(Boolean)
                        .join(' · ')}
                      pied="Vous le prête"
                    />
                  }
                  droites={[
                    {
                      cle: emprunte.libelle,
                      noeud: (
                        <Noeud
                          Icone={DoorOpen}
                          titre={emprunte.espace}
                          sousTitre={emprunte.libelle}
                          pied="Dans votre emploi du temps"
                        />
                      ),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Choisir un espace, puis les établissements auxquels le lier.
 *
 * ⚠️ LA SÉLECTION SURVIT À LA RECHERCHE : elle est tenue à part (`choisis`), sinon un
 * établissement coché disparaîtrait de la liste dès qu'on tape autre chose, et l'enregistrement
 * le retirerait sans que rien ne le dise.
 *
 * ⚠️ CHOISIR UN ESPACE DÉJÀ PARTAGÉ REPREND SES DESTINATAIRES : on modifie son partage, on ne le
 * remplace pas à l'aveugle par une liste vide.
 */
function DialogueMutualisation({ miens, espaceInitial, onFermer }) {
  const cache = useQueryClient();
  const [espace, setEspace] = useState(espaceInitial);
  const [recherche, setRecherche] = useState('');
  const [terme, setTerme] = useState('');

  const dejaAvec = (nom) => miens.find((m) => m.espace === nom)?.avec ?? [];
  // La sélection est tenue PAR ÉTABLISSEMENT (nom + complexe), pas par compte : voir l'annuaire du serveur.
  const versSelection = (avec) => new Map(avec.map((e) => [e.cle, e]));
  const [choisis, setChoisis] = useState(() => versSelection(dejaAvec(espaceInitial)));

  const changerEspace = (nom) => {
    setEspace(nom);
    setChoisis(versSelection(dejaAvec(nom)));
  };

  // Une pause avant d'interroger : une requête par frappe n'apporterait rien.
  useEffect(() => {
    const minuterie = setTimeout(() => setTerme(recherche.trim()), 350);
    return () => clearTimeout(minuterie);
  }, [recherche]);

  const annuaire = useQuery({
    queryKey: ['espaces-mutualises', 'annuaire', terme],
    queryFn: () => chargerAnnuaire(terme),
    retry: false,
  });

  const enregistrement = useMutation({
    // ⚠️ Une fonction explicite : TanStack Query passe un second argument à `mutationFn`.
    mutationFn: () => enregistrerPartage(espace, [...choisis.values()].flatMap((e) => e.etablissementIds)),
    onSuccess: () => {
      toast.success('Partage enregistré', {
        description:
          choisis.size > 0
            ? `« ${espace} » : ${choisis.size} établissement(s).`
            : `« ${espace} » n’est plus partagé.`,
      });
      cache.invalidateQueries({ queryKey: CLE });
      onFermer();
    },
    onError: (erreur) => toast.error('Partage non enregistré', { description: erreur.message }),
  });

  const bascule = (etablissement) =>
    setChoisis((actuels) => {
      const suivants = new Map(actuels);
      if (suivants.has(etablissement.cle)) suivants.delete(etablissement.cle);
      else suivants.set(etablissement.cle, etablissement);
      return suivants;
    });

  // Les déjà choisis d'abord, puis ce que la recherche rend — sans doublon.
  const affiches = [
    ...choisis.values(),
    ...(annuaire.data?.etablissements ?? []).filter((e) => !choisis.has(e.cle)),
  ];

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mutualiser un espace</DialogTitle>
          <DialogDescription>
            Choisissez l’espace, puis les établissements qui pourront le choisir dans leur emploi
            du temps. Le chevauchement sera vérifié entre eux et vous.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="espace-a-mutualiser">Espace</Label>
            <Select value={espace} onValueChange={changerEspace}>
              <SelectTrigger id="espace-a-mutualiser">
                <SelectValue placeholder="Choisir un espace…" />
              </SelectTrigger>
              <SelectContent>
                {miens.map(({ espace: nom, avec }) => (
                  <SelectItem key={nom} value={nom}>
                    {nom}
                    {avec.length > 0 ? ` — partagé avec ${avec.length}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={cn('space-y-3', !espace && 'pointer-events-none opacity-50')} aria-disabled={!espace}>
            <Label htmlFor="recherche-etablissement">Lier avec</Label>
            <Input
              id="recherche-etablissement"
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
              placeholder="Chercher un établissement ou un complexe…"
              disabled={!espace}
            />

            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {annuaire.isLoading && <IndicateurChargement className="mx-auto my-4" />}
              {annuaire.isError && (
                <p className="p-3 text-sm text-destructive">{annuaire.error.message}</p>
              )}
              {!annuaire.isLoading && affiches.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {terme.length >= 2
                    ? 'Aucun établissement ne correspond.'
                    : 'Aucun autre établissement n’a de compte pour l’instant.'}
                </p>
              )}
              <ul className="divide-y">
                {affiches.map((etablissement) => {
                  const identifiant = `partage-${encodeURIComponent(etablissement.cle)}`;
                  return (
                    <li key={etablissement.cle}>
                      <label
                        htmlFor={identifiant}
                        className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/50"
                      >
                        <Checkbox
                          id={identifiant}
                          checked={choisis.has(etablissement.cle)}
                          onCheckedChange={() => bascule(etablissement)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{etablissement.nom}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[etablissement.complexe, etablissement.region].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFermer}>
            Annuler
          </Button>
          <Button
            type="button"
            disabled={!espace || enregistrement.isPending}
            onClick={() => enregistrement.mutate()}
          >
            {enregistrement.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
