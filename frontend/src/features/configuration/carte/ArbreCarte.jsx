import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Layers, Minus, Plus, Users } from 'lucide-react';
import { etatAffectation } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import { Pastille } from './GrilleAffectations';
import { arbreDeLaCarte } from './structureCarte';

/**
 * ⚠️ LE BADGE D'UN GROUPE MÈNE À SON AFFECTATION (2026-09-19, demande du porteur) :
 * la page Affectations s'ouvre sur l'ensemble de ce groupe, déplié, sa colonne
 * surlignée. Le groupe voyage dans l'adresse (`?groupe=`), donc le lien se copie,
 * s'ouvre dans un autre onglet, et le retour arrière revient ici.
 */
const URL_AFFECTATIONS = '/app/parametres/affectations';

/**
 * La carte en SCHÉMA : l'établissement en haut, une branche par année de formation,
 * puis les filières de chaque année. ← demande du porteur (2026-09-19), sur le
 * modèle d'un éditeur de flux : blocs reliés par des traits, une étiquette sur
 * chaque branche.
 *
 * ⚠️ UN SCHÉMA À LIRE : aucun bloc ne réagit au clic — un bloc qui ressemble à un
 * bouton en promettrait un. Seuls les boutons « − » et « + » de chaque filière
 * agissent (2026-09-19, demande du porteur) : ajouter un groupe vierge à cette
 * filière et cette année, ou retirer le dernier. Sans `onAjouterGroupe` /
 * `onRetirerGroupe` (invité en lecture seule), ils n'existent pas.
 *
 * @param {object} props
 * @param {(filiere) => void} [props.onAjouterGroupe]  reçoit l'entrée de
 *   `arbreDeLaCarte` ; `annee` y est ajoutée
 * @param {(filiere) => void} [props.onRetirerGroupe]
 * @param {(nom: string) => void} [props.onOuvrirGroupe]  où mène le badge d'un groupe.
 *   Absent : la page Affectations de Paramètres (un lien). ⚠️ DANS L'ASSISTANT DE
 *   CONFIGURATION il est fourni : le badge doit mener à l'ÉTAPE Affectations, pas faire
 *   quitter l'assistant pour une page de Paramètres — l'assistant n'a pas de route pour
 *   cela, seulement un état.
 * @param {boolean} [props.retraitPossible]  faux quand il ne resterait plus aucun
 *   groupe : la carte ne s'enregistre pas vide, le retrait serait perdu au
 *   rechargement
 *
 * ⚠️ LE TRAIT HORIZONTAL COURT DU CENTRE DE LA PREMIÈRE COLONNE À CELUI DE LA
 * DERNIÈRE. Les colonnes sont égales : chaque centre est à `50 / n` % du bord, quel
 * que soit n — pas de mesure, donc pas de trait qui se décale au redimensionnement.
 *
 * ⚠️ SOUS LE SEUIL « md » LES COLONNES S'EMPILENT et le trait horizontal disparaît :
 * chaque année garde son étiquette et son trait vertical, lisibles sur un téléphone.
 */
export default function ArbreCarte({
  groupes,
  onAjouterGroupe,
  onRetirerGroupe,
  retraitPossible = true,
  onOuvrirGroupe = null,
}) {
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const annees = arbreDeLaCarte(groupes);
  const filieres = new Set(groupes.map((groupe) => groupe.codeFiliere).filter(Boolean));
  const marge = `${50 / annees.length}%`;

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/20 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center">
        {/*
          ⚠️ LE CADRE DE L'ÉTABLISSEMENT S'AJUSTE À SON NOM, et se centre : `w-fit`
          le fait épouser le texte, `max-w-full` l'empêche de déborder, et le nom
          passe à la ligne plutôt que d'être tronqué — c'est le titre de tout le
          schéma, il doit se lire en entier. Les blocs de filière, eux, gardent la
          largeur de leur colonne.
        */}
        <Bloc
          racine
          icone={Building2}
          titre={etablissement.data?.etablissement?.nom ?? 'Établissement'}
          sousTitre={`${groupes.length} groupe(s) · ${filieres.size} filière(s)`}
        />

        {annees.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucun groupe pour l’instant : choisissez une filière ci-dessus et générez ses groupes.
          </p>
        ) : (
          <Trait hauteur="h-8" />
        )}

        <div className="relative flex w-full flex-col gap-10 md:flex-row md:gap-4">
          {/* Le trait qui relie les branches, du centre de la première à la dernière. */}
          {annees.length > 1 && (
            <div
              aria-hidden
              className="absolute top-0 hidden h-px bg-border md:block"
              style={{ left: marge, right: marge }}
            />
          )}

          {annees.map((annee) => (
            <div key={annee.annee} className="flex flex-1 flex-col items-center">
              <div className="relative flex h-8 items-center justify-center">
                <span aria-hidden className="absolute inset-y-0 w-px bg-border" />
                <span className="relative rounded-md border bg-background px-2 py-0.5 text-xs font-medium">
                  {annee.libelle}
                </span>
              </div>

              {annee.filieres.map((filiere) => (
                <div key={filiere.code} className="flex w-full flex-col items-center">
                  <Trait hauteur="h-6" />
                  <Bloc
                    icone={Layers}
                    /*
                     * ⚠️ LE NOM DE LA FILIÈRE D'ABORD, EN GRAS ; son CODE dessous, en gris
                     * (2026-09-19, demande du porteur). Le code seul (« GC_GE_TS ») ne dit
                     * pas de quelle filière il s'agit ; le nom, lui, se lit. Sans intitulé
                     * connu — ou identique au code, comme le rend la reconstruction quand
                     * la répartition ne le donne pas — le code fait le titre, sans doublon.
                     */
                    titre={filiere.intitule || filiere.code}
                    sousTitre={filiere.intitule && filiere.intitule !== filiere.code ? filiere.code : ''}
                    actions={
                      onAjouterGroupe && onRetirerGroupe ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-6"
                            disabled={!retraitPossible}
                            aria-label={`Retirer le dernier groupe de ${filiere.code}, ${annee.libelle}`}
                            title={
                              retraitPossible
                                ? `Retirer ${filiere.groupes[filiere.groupes.length - 1]}`
                                : 'La carte doit garder au moins un groupe'
                            }
                            onClick={() => onRetirerGroupe({ ...filiere, annee: annee.annee })}
                          >
                            <Minus className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-6"
                            aria-label={`Ajouter un groupe à ${filiere.code}, ${annee.libelle}`}
                            title="Ajouter un groupe"
                            onClick={() => onAjouterGroupe({ ...filiere, annee: annee.annee })}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </>
                      ) : null
                    }
                    pied={
                      <>
                        <span>{filiere.groupes.length} groupe(s)</span>
                        {/*
                          ⚠️ UN BADGE PAR GROUPE (2026-09-19, demande du porteur), en gras et
                          en noir. Une liste séparée par des virgules se coupait au milieu
                          d'un nom — « PIE201 (FQ), PI… » ; un badge passe à la ligne
                          en entier, et le nom d'un groupe ne se lit jamais tronqué.
                        */}
                        {filiere.groupes.map((nom) => (
                          <BadgeGroupe key={nom} nom={nom} onOuvrir={onOuvrirGroupe}>
                            {/* Vert : tous les modules ont un formateur ; orange : une partie ;
                                gris : aucun — le code couleur de la matrice d'affectations. */}
                            <Pastille
                              etat={etatAffectation(
                                filiere.avancement[nom].affectes,
                                filiere.avancement[nom].total
                              )}
                            />
                            {nom}
                          </BadgeGroupe>
                        ))}
                      </>
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CLASSES_BADGE =
  'inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Le badge d'un groupe : un LIEN vers la page Affectations de Paramètres, ou — quand
 * l'appelant a fourni `onOuvrir` — un BOUTON qui l'appelle, sans quitter la page.
 */
function BadgeGroupe({ nom, onOuvrir, children }) {
  const titre = `Ouvrir l’affectation de ${nom}`;

  if (onOuvrir) {
    return (
      <button type="button" title={titre} className={CLASSES_BADGE} onClick={() => onOuvrir(nom)}>
        {children}
      </button>
    );
  }

  return (
    <Link
      to={`${URL_AFFECTATIONS}?groupe=${encodeURIComponent(nom)}`}
      title={titre}
      className={CLASSES_BADGE}
    >
      {children}
    </Link>
  );
}

function Point() {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground/70" />;
}

/** Un trait vertical, avec un point à chaque bout. */
function Trait({ hauteur }) {
  return (
    <div aria-hidden className="flex flex-col items-center">
      <Point />
      <span className={`w-px bg-border ${hauteur}`} />
      <Point />
    </div>
  );
}

function Bloc({ icone: Icone, titre, sousTitre, pied, actions, racine = false }) {
  return (
    <div
      className={
        racine
          ? 'w-fit max-w-full rounded-lg border bg-card shadow-sm'
          : 'w-full max-w-[24rem] rounded-lg border bg-card shadow-sm'
      }
    >
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
          <Icone className="size-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          {/* ⚠️ RIEN N'EST TRONQUÉ : un nom de filière long passe à la ligne au lieu de
              finir en « Assistant Administ… ». `break-words` : un code sans espace
              ne doit pas non plus déborder du bloc. */}
          <p className={cn('break-words text-sm', racine ? 'font-medium' : 'font-bold')}>{titre}</p>
          {sousTitre && <p className="break-words text-xs text-muted-foreground">{sousTitre}</p>}
        </div>
        {/* « − » et « + » en tête du bloc : en pied, ils prenaient la place des groupes. */}
        {actions && <span className="flex shrink-0 gap-1 self-start">{actions}</span>}
      </div>

      {pied && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-b-lg border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Users className="size-3.5 shrink-0" />
          {pied}
        </div>
      )}
    </div>
  );
}
