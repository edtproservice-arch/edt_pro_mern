import { useQuery } from '@tanstack/react-query';
import { Building2, Network, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Noeud, { Flux } from '@/components/common/SchemaLiaison';
import { api } from '@/lib/apiClient';

/**
 * Formateurs MUTUALISÉS — affectés dans plusieurs établissements.
 * (demande du porteur, 2026-09-21 : « la même chose pour les formateurs, mais la mutualisation
 * doit se détecter automatiquement : on cherche le formateur affecté dans deux ou trois
 * établissements, il est alors mutualisé ».)
 *
 * ═══ ⚠️ ICI RIEN NE SE DÉCLARE : ON LIT ═══
 * Contrairement aux espaces, aucun bouton « Mutualiser » — le serveur repère les formateurs dont le
 * matricule est affecté ailleurs. L'écran montre ce qu'il a trouvé : un badge sur chaque formateur
 * concerné, et le schéma (le formateur, un trait, ses autres établissements) à la demande.
 * Les séances de ces formateurs sont contrôlées entre établissements : impossible de les placer
 * dans deux endroits au même créneau.
 */
const CLE = ['formateurs-mutualises'];

/**
 * @param {boolean} actif  la lecture n'a de sens que sur la page qui l'affiche
 * @returns {{ liste: Array, parMatricule: Map<string, object>, erreur: string|null }}
 */
export function useFormateursMutualises(actif) {
  const requete = useQuery({
    queryKey: CLE,
    queryFn: () => api.get('/api/v2/formateurs-mutualises'),
    enabled: actif,
    retry: false,
    // Une affectation ajoutée dans un autre établissement ne se voit qu'à la relecture : on ne
    // garde pas ce résultat au-delà d'une minute.
    staleTime: 60_000,
  });

  const liste = requete.data?.formateurs ?? [];
  return {
    liste,
    parMatricule: new Map(liste.map((formateur) => [formateur.matricule, formateur])),
    erreur: requete.isError ? requete.error.message : null,
  };
}

/**
 * Le bouton de la barre d'outils : « Formateurs mutualisés (3) ».
 *
 * ⚠️ TOUJOURS VISIBLE (2026-09-21, signalé par le porteur : « ajouter un bouton pour voir les
 * formateurs mutualisés » — il n'en voyait aucun). Caché quand la liste est vide, il laissait
 * croire que la fonction n'existait pas : la fenêtre dit elle-même qu'aucun formateur n'est
 * mutualisé, ou pourquoi elle n'a pas pu le savoir. Le compteur ne paraît que s'il y en a.
 */
export function BoutonFormateursMutualises({ nombre, onClick }) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClick}>
      {/* La même icône que « Voir les partages » de la page Espaces. */}
      <Network className="size-3.5" />
      Formateurs mutualisés
      {nombre > 0 && <span className="rounded-full bg-muted px-1.5 tabular-nums">{nombre}</span>}
    </Button>
  );
}

/** Le schéma : chaque formateur relié aux autres établissements où il est affecté. */
export function FenetreFormateursMutualises({ formateurs, erreur = null, onFermer }) {
  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Formateurs mutualisés</DialogTitle>
          <DialogDescription>
            Ces formateurs sont affectés dans plusieurs établissements. Détectés automatiquement :
            leurs séances sont contrôlées entre établissements, un formateur ne peut pas avoir cours
            à deux endroits au même moment.
          </DialogDescription>
        </DialogHeader>

        {erreur && (
          <Alerte type="avertissement" titre="La liste n’a pas pu être chargée">
            {erreur}
          </Alerte>
        )}

        {!erreur && formateurs.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Aucun formateur n’est affecté dans plusieurs établissements pour l’instant. Dès qu’un
            formateur de cette liste est aussi affecté dans un autre établissement ayant un compte, il
            apparaît ici.
          </div>
        )}

        <div className="space-y-4 overflow-x-auto">
          {formateurs.map((formateur) => (
            <Flux
              key={formateur.matricule}
              gauche={
                <Noeud
                  Icone={UserRound}
                  titre={formateur.nom}
                  sousTitre={`Matricule ${formateur.matricule}`}
                  pied={`+ ${formateur.avec.length} établissement${formateur.avec.length > 1 ? 's' : ''}`}
                  etiquette="Mutualisé"
                />
              }
              droites={formateur.avec.map((etablissement) => ({
                cle: etablissement.cle,
                noeud: (
                  <Noeud
                    Icone={Building2}
                    titre={etablissement.nom}
                    sousTitre={[etablissement.complexe, etablissement.region].filter(Boolean).join(' · ')}
                    pied="Aussi affecté ici"
                    etiquette="Affecté"
                  />
                ),
              }))}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
