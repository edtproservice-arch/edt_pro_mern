import { createContext, useContext, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ListChecks,
  ListX,
  Plus,
  RotateCcw,
  Presentation,
  Trash2,
} from 'lucide-react';
import {
  calculerCharges,
  construireEnsembles,
  estActif,
  etatAffectation,
  heuresPresentiel,
  masseModifiable,
  heuresSynchrone,
  semestreModule,
} from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Teams from '@/components/icons/Teams';
import BadgeSemestreCommun from '@/components/common/BadgeSemestre';
import BadgeRegional from '@/components/common/BadgeRegional';
import { cn } from '@/lib/utils';
import { cleCasePresentiel, cleCaseSynchrone, cleEnTeteEnsemble } from './casesCarte';

/** Valeur du choix « aucun formateur » — Radix refuse une valeur vide. */
const AUCUN = '__aucun__';

/**
 * Carte des affectations : un bloc par ensemble filière / année.
 * ← `#affectation-map-container` + la matrice de affectation-carte.js:1679-1830
 *
 * ═══ POURQUOI UNE MATRICE, ET PAS UNE LISTE PAR GROUPE ═══
 * Les groupes d'un même ensemble suivent les MÊMES modules. Une liste par
 * groupe oblige à ressaisir la même affectation autant de fois qu'il y a de
 * groupes. La matrice — modules en lignes, groupes en colonnes — montre tout
 * l'ensemble d'un coup, et le bouton « copier » d'une colonne reporte ses
 * formateurs sur les autres en un geste.
 *
 * ═══ PRÉSENTIEL ET SYNCHRONE SONT SÉPARÉS ═══
 * Le présentiel est PROPRE À CHAQUE GROUPE ; le synchrone est MUTUALISÉ — une
 * séance pour tout l'ensemble. Les mélanger laissait croire qu'il faut désigner
 * un formateur synchrone par groupe.
 */
/*
 * ═══ LECTURE SEULE (Phase 5bis, étape d3) ═══ Un invité « peut consulter »
 * parcourt la carte — ensembles dépliables, onglets Présentiel / Synchrone —
 * sans rien pouvoir changer.
 *
 * ⚠️ UN `fieldset disabled` AUTOUR DES MATRICES, PAS AUTOUR DE TOUT : il éteint
 * aussi les boutons de repli et les onglets, et l'invité ne pourrait plus rien
 * ouvrir. Il enveloppe donc seulement ce qui écrit — cases, interrupteurs,
 * champs d'heures, boutons de copie et de suppression.
 *
 * ⚠️ ET LA LISTE DES FORMATEURS REÇOIT `disabled` EXPLICITEMENT : le
 * déclencheur d'un `Select` de Radix s'ouvre sur `pointerdown`, que le
 * navigateur transmet même à un bouton désactivé par son `fieldset`. Le contexte
 * le lui porte sans le faire traverser six composants.
 */
const LectureSeuleCarte = createContext(false);

/*
 * ═══ LA CASE OUVERTE, SIGNALÉE À LA PAGE (Phase 5bis, 2026-09-13) ═══
 * Ouvrir la liste d'une cellule — ou le champ d'une masse horaire — l'annonce
 * aux collègues, qui la voient encadrée « X modifie ». Un contexte, pour ne pas
 * faire traverser la fonction à six composants. Sans page collaborative
 * (l'assistant de configuration), il ne fait rien.
 */
const OuvertureCase = createContext(null);

export default function GrilleAffectations({
  lectureSeule = false,
  groupes,
  formateurs,
  onAffecter,
  lignesDe,
  onDefinirLignes,
  onActiverModule,
  onDefinirMasse,
  onCopierGroupe,
  onSupprimer,
  onAjouterGroupe,
  onOuverture = null,
}) {
  const ensembles = useMemo(() => construireEnsembles(groupes), [groupes]);

  // Charge de chaque formateur, recalculée à chaque changement : elle s'affiche
  // dans les sélecteurs, au moment même où le directeur choisit.
  const charges = useMemo(() => calculerCharges(groupes), [groupes]);

  /*
   * ═══ LA LISTE DES FORMATEURS EST CONSTRUITE UNE FOIS, PAS PAR CELLULE ═══
   * Chaque `ChoixFormateur` la reconstruisait pour lui : sur une carte réelle,
   * 38 formateurs × plusieurs centaines de cellules, à chaque rendu — des
   * dizaines de milliers d'éléments React créés pour rien, puisqu'ils sont
   * identiques partout. Radix ne monte le contenu qu'à l'ouverture, mais les
   * ÉLÉMENTS, eux, étaient bien créés à chaque fois.
   *
   * Un élément React est une description immuable : le même tableau peut être
   * rendu dans autant de listes déroulantes qu'on veut.
   */
  const options = useMemo(() => optionsFormateurs(formateurs, charges), [formateurs, charges]);

  if (ensembles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucun groupe. Choisissez une filière ci-dessus et générez ses groupes.
      </div>
    );
  }

  return (
    <LectureSeuleCarte.Provider value={lectureSeule}>
    <OuvertureCase.Provider value={onOuverture}>
    <div className="space-y-3">
      {ensembles.map((ensemble) => (
        <Ensemble
          key={ensemble.cle}
          ensemble={ensemble}
          options={options}
          onAffecter={onAffecter}
          lignesDe={lignesDe}
          onDefinirLignes={onDefinirLignes}
          onActiverModule={onActiverModule}
          onDefinirMasse={onDefinirMasse}
          onCopierGroupe={onCopierGroupe}
          onSupprimer={onSupprimer}
          onAjouterGroupe={lectureSeule ? null : onAjouterGroupe}
        />
      ))}
    </div>
    </OuvertureCase.Provider>
    </LectureSeuleCarte.Provider>
  );
}

function Ensemble({
  ensemble,
  options,
  onAffecter,
  lignesDe,
  onDefinirLignes,
  onActiverModule,
  onDefinirMasse,
  onCopierGroupe,
  onSupprimer,
  onAjouterGroupe,
}) {
  /*
   * ⚠️ FERMÉ AU DÉPART — c'est LA correction de la lenteur (2026-08-19).
   *
   * Tous les ensembles s'ouvraient d'emblée. Sur la carte réelle, cela fait
   * 26 matrices montées d'un coup : **780 listes déroulantes Radix et
   * 15 900 nœuds DOM**, mesurés en montant cette grille au vrai volume
   * (39 groupes × 20 modules × 38 formateurs). Ce n'est pas le calcul qui
   * coûte — le domaine entier tient en une dizaine de millisecondes — c'est le
   * nombre de composants MONTÉS.
   *
   * L'en-tête porte déjà la filière, l'année, le mode et la pastille
   * d'avancement de l'ensemble : de quoi choisir lequel ouvrir sans le déplier.
   */
  const [ouvert, setOuvert] = useState(false);
  const [onglet, setOnglet] = useState('presentiel');
  const lectureSeule = useContext(LectureSeuleCarte);

  const modulesSynchrones = ensemble.modules.filter(
    (module) => estActif(module) && heuresSynchrone(module) > 0
  );

  const actifs = (groupe) => groupe.modules.filter(estActif);

  const totalPresentiel = ensemble.groupes.reduce(
    (total, groupe) => total + actifs(groupe).length,
    0
  );
  const affectesPresentiel = ensemble.groupes.reduce(
    (total, groupe) => total + actifs(groupe).filter((m) => m.formateurPresentiel).length,
    0
  );
  const affectesSynchrone = modulesSynchrones.filter((module) =>
    ensemble.groupes.some((groupe) =>
      groupe.modules.some((m) => cleModule(m) === cleModule(module) && m.formateurSynchrone)
    )
  ).length;

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* `data-case` : le cadre « X modifie » d'une cellule d'un ensemble REPLIÉ
          chez soi se replie sur cet en-tête — voir `casesCarte.js`. */}
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        data-case={cleEnTeteEnsemble(ensemble.cle)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50"
      >
        {ouvert ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Pastille etat={etatAffectation(affectesPresentiel, totalPresentiel)} />
            <span className="truncate font-medium">
              {ensemble.intituleFiliere || ensemble.codeFiliere}
            </span>
            {/*
              Le mode fait partie de l'identité de l'ensemble : deux blocs de la
              même filière ne se distinguent que par lui.
            */}
            <Badge variant="outline" className="font-normal">
              {ensemble.mode || 'Mode non précisé'}
            </Badge>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {ensemble.codeFiliere} · année {ensemble.anneeFormation} ·{' '}
            {ensemble.groupes.length} groupe(s) · {ensemble.modules.length} module(s)
          </span>
        </span>

        <Compteur affectes={affectesPresentiel} total={totalPresentiel} />
      </button>

      {ouvert && (
        <div className="space-y-4 border-t p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={onglet} onValueChange={setOnglet}>
              <TabsList>
                <TabsTrigger value="presentiel" className="gap-2">
                  <Presentation className="h-4 w-4 text-accent-teal" />
                  Présentiel
                  <span className="text-xs text-muted-foreground">
                    {affectesPresentiel}/{totalPresentiel}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="synchrone" className="gap-2">
                  <Teams className="h-4 w-4" />
                  Synchrone
                  <span className="text-xs text-muted-foreground">
                    {affectesSynchrone}/{modulesSynchrones.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {onAjouterGroupe && <AjouterGroupeEnsemble ensemble={ensemble} onAjouter={onAjouterGroupe} />}
          </div>

          {/* `min-w-0` : un fieldset refuse sinon de rétrécir sous son contenu, et la
              matrice cesserait de défiler dans son cadre. */}
          <fieldset disabled={lectureSeule} className="m-0 min-w-0 border-0 p-0">
          {onglet === 'presentiel' ? (
            <MatricePresentiel
              ensemble={ensemble}
              options={options}
              onAffecter={onAffecter}
              onActiverModule={onActiverModule}
              onDefinirMasse={onDefinirMasse}
              onCopierGroupe={onCopierGroupe}
              onSupprimer={onSupprimer}
            />
          ) : (
            <ListeSynchrone
              ensemble={ensemble}
              modules={modulesSynchrones}
              options={options}
              lignesDe={lignesDe}
              onDefinirLignes={onDefinirLignes}
            />
          )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Modules en lignes, groupes en colonnes. */
function MatricePresentiel({
  ensemble,
  options,
  onAffecter,
  onActiverModule,
  onDefinirMasse,
  onCopierGroupe,
  onSupprimer,
}) {
  // Tous les groupes du bloc partagent le mode : la clé d'ensemble le porte.
  const heuresAjustables = masseModifiable(ensemble.groupes[0]);

  return (
    <div className="space-y-2">
      {heuresAjustables && (
        <p className="text-xs text-muted-foreground">
          Mode <strong className="text-foreground">{ensemble.mode}</strong> : une partie de
          l&apos;année se passe en entreprise. Les masses horaires sont donc ajustables sous chaque
          affectation, groupe par groupe — deux groupes peuvent avoir des rythmes différents.
        </p>
      )}

      {/* `data-defile` : un curseur de collègue sur une colonne défilée hors de
          vue ne se dessine pas par-dessus une autre. */}
      <div data-defile className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-tableau-tete">
            {/*
              ⚠️ Fond OPAQUE et bordure droite : une colonne collante avec un
              fond semi-transparent (`bg-muted/60`) laisse voir les colonnes qui
              défilent dessous — le premier groupe apparaissait alors en
              filigrane derrière l'en-tête « Module ».
            */}
            <th className="sticky left-0 z-20 min-w-[260px] border-r bg-tableau-tete p-3 text-left font-medium">
              Module
            </th>
            {ensemble.groupes.map((groupe) => {
              const actifs = groupe.modules.filter(estActif);
              const affectes = actifs.filter((m) => m.formateurPresentiel).length;

              return (
                <th key={groupe.nom} className="min-w-[240px] border-l p-3 text-left font-medium">
                  <div className="flex items-center gap-2">
                    {/*
                      Le mode n'est plus répété ici : tous les groupes d'une
                      matrice le partagent, il est porté par l'en-tête du bloc.
                    */}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <Pastille etat={etatAffectation(affectes, actifs.length)} />
                        <span className="truncate">{groupe.nom}</span>
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block text-xs font-normal tabular-nums',
                          APPARENCES[etatAffectation(affectes, actifs.length)].texte
                        )}
                      >
                        {affectes}/{actifs.length}
                      </span>
                    </span>

                    <span className="ml-auto flex">
                      {ensemble.groupes.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          title={`Copier les formateurs de ${groupe.nom} vers les autres groupes`}
                          onClick={() => onCopierGroupe(groupe.nom)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={`Supprimer ${groupe.nom}`}
                        onClick={() => onSupprimer(groupe.nom)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {ensemble.modules.map((moduleRef) => {
            const actif = estActif(moduleRef);

            return (
              <tr
                key={cleModule(moduleRef)}
                className={cn('border-b last:border-b-0', !actif && 'bg-muted')}
              >
                {/* `data-colle` : une cellule glissée sous cette colonne est cachée —
                    le cadre d'un collègue s'arrête à elle, sans la recouvrir. */}
                <td
                  data-colle="gauche"
                  className={cn(
                    // Opaque, pour la même raison que l'en-tête.
                    'sticky left-0 z-10 border-r bg-card p-3 align-top',
                    !actif && 'bg-muted'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('min-w-0 flex-1', !actif && 'opacity-50')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono font-normal">
                          {moduleRef.code || '—'}
                        </Badge>
                        {/* ⚠️ La pastille vit désormais dans `BadgeRegional`
                            (2026-09-05) : le programme du stagiaire en faisait
                            la seconde copie. Ici seul le cas RÉGIONAL s'affiche
                            — « Local » y serait un bruit de plus sur une ligne
                            qui porte déjà code, intitulé, heures et semestre. */}
                        {moduleRef.estRegional && <BadgeRegional estRegional />}
                        <BadgeSemestre module={moduleRef} />
                      </div>
                      <div className="mt-1.5 text-sm font-medium">{moduleRef.nom}</div>
                      <Heures module={moduleRef} />
                    </div>

                    {/*
                      Un établissement ne dispense pas toujours tous les modules
                      de la répartition DRIF. Le commutateur agit sur TOUS les
                      groupes de l'ensemble — c'est le même module.
                    */}
                    <Switch
                      checked={actif}
                      onCheckedChange={(valeur) =>
                        onActiverModule(ensemble.cle, moduleRef.code || moduleRef.nom, valeur)
                      }
                      aria-label={`${actif ? 'Désactiver' : 'Réactiver'} ${moduleRef.code}`}
                      title={
                        actif
                          ? "Désactiver ce module : il est retiré des groupes de l'ensemble"
                          : 'Réactiver ce module'
                      }
                    />
                  </div>
                </td>

                {ensemble.groupes.map((groupe) => {
                  const module = groupe.modules.find(
                    (m) => cleModule(m) === cleModule(moduleRef)
                  );
                  // Sur TOUTES les cellules, même éteintes : un curseur qui les
                  // traverse ne doit pas disparaître d'une colonne à l'autre.
                  const cleCase = cleCasePresentiel(ensemble.cle, groupe.nom, cleModule(moduleRef));

                  if (!actif) {
                    return (
                      <td
                        key={groupe.nom}
                        data-case={cleCase}
                        className="border-l p-3 text-xs text-muted-foreground"
                      >
                        module désactivé
                      </td>
                    );
                  }

                  if (!module) {
                    return (
                      <td
                        key={groupe.nom}
                        data-case={cleCase}
                        className="border-l p-3 text-xs text-muted-foreground"
                      >
                        module retiré
                      </td>
                    );
                  }

                  return (
                    <td key={groupe.nom} data-case={cleCase} className="border-l p-3 align-top">
                      <ChoixFormateur
                        valeur={module.formateurPresentiel}
                        options={options}
                        cleFocus={cleCase}
                        onChange={(nom) =>
                          onAffecter(groupe.nom, module.code, 'formateurPresentiel', nom)
                        }
                      />

                      {/*
                        Un groupe alterné ou par apprentissage passe une partie
                        de l'année en entreprise : ses heures ne sont pas celles
                        de la répartition, et les y forcer fausse l'avancement.
                      */}
                      {masseModifiable(groupe) && (
                        <MasseAjustable
                          module={module}
                          cleFocus={cleCase}
                          onChange={(champ, valeur) =>
                            onDefinirMasse(groupe.nom, cleModule(module), champ, valeur)
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/**
 * Séances synchrones de l'ensemble.
 * ← l'onglet « Synchrone » de affectation-carte.js, et son modèle
 *   `synchroneAssignments[filiere][module] = [{ formateur, groupes }]`
 *
 * ═══ UNE LIGNE = UNE SÉANCE ═══
 * Un module synchrone peut donner lieu à PLUSIEURS séances dans le même
 * ensemble : dix groupes ne tiennent pas dans une seule classe Teams, et deux
 * formateurs peuvent se partager la promotion. Chaque ligne porte son
 * formateur et les groupes qu'elle couvre.
 *
 * Un groupe ne peut être coché que dans UNE ligne : il ne suit qu'une séance.
 */
function ListeSynchrone({ ensemble, modules, options, lignesDe, onDefinirLignes }) {
  if (modules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun module actif de cette filière ne porte d&apos;heures synchrones.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Une séance synchrone est donnée <strong>une seule fois</strong> pour les groupes
        qu&apos;elle couvre : elle ne pèse qu&apos;une fois sur la charge du formateur. Ajoutez une
        seconde séance si la promotion doit être partagée entre deux formateurs.
      </p>

      <div className="space-y-2">
        {modules.map((moduleRef) => (
          <ModuleSynchrone
            key={cleModule(moduleRef)}
            ensemble={ensemble}
            module={moduleRef}
            options={options}
            lignes={lignesDe(ensemble.cle, cleModule(moduleRef))}
            onDefinirLignes={onDefinirLignes}
          />
        ))}
      </div>
    </div>
  );
}

function ModuleSynchrone({ ensemble, module, options, lignes, onDefinirLignes }) {
  const enregistrer = (suivantes) => onDefinirLignes(ensemble.cle, cleModule(module), suivantes);

  const couverts = new Set(lignes.flatMap((ligne) => ligne.groupes));
  const restants = ensemble.groupes.filter((groupe) => !couverts.has(groupe.nom));

  /*
   * Une case pour le BLOC du module, pas une par séance : les séances se
   * désignent par leur rang, qui glisse dès qu'on en ajoute ou retire une — la
   * clé désignerait alors une autre séance chez le collègue.
   */
  const cleCase = cleCaseSynchrone(ensemble.cle, cleModule(module));

  return (
    <div data-case={cleCase} className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="font-mono font-normal">
            {module.code || '—'}
          </Badge>
          <span className="truncate text-sm font-medium">{module.nom}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <BadgeSynchrone heures={heuresSynchrone(module)} />
          <Semestre libelle="S1" heures={module.mhsynS1 ?? 0} classe="text-accent-sky" />
          <Semestre libelle="S2" heures={module.mhsynS2 ?? 0} classe="text-accent-green" />

          <Button
            variant="outline"
            size="sm"
            disabled={options.length === 0}
            title={options.length === 0 ? "Ajoutez d'abord des formateurs" : undefined}
            onClick={() => enregistrer([...lignes, { formateur: '', groupes: [] }])}
          >
            <Plus className="h-4 w-4" />
            Formateur
          </Button>
        </div>
      </div>

      {lignes.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">
          Aucune séance. Les {ensemble.groupes.length} groupe(s) n&apos;ont pas de formateur
          synchrone pour ce module.
        </p>
      ) : (
        <div className="divide-y">
          {lignes.map((ligne, index) => (
            <LigneSynchrone
              key={index}
              cleFocus={cleCase}
              ligne={ligne}
              ensemble={ensemble}
              options={options}
              couvertsAilleurs={
                new Set(
                  lignes.filter((_, autre) => autre !== index).flatMap((autre) => autre.groupes)
                )
              }
              restants={restants}
              onChange={(suivante) =>
                enregistrer(
                  lignes.map((courante, autre) => (autre === index ? suivante : courante))
                )
              }
              onSupprimer={() => enregistrer(lignes.filter((_, autre) => autre !== index))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LigneSynchrone({
  cleFocus,
  ligne,
  ensemble,
  options,
  couvertsAilleurs,
  restants,
  onChange,
  onSupprimer,
}) {
  const basculer = (nom, coche) =>
    onChange({
      ...ligne,
      groupes: coche ? [...ligne.groupes, nom] : ligne.groupes.filter((c) => c !== nom),
    });

  const disponibles = ensemble.groupes.filter((groupe) => !couvertsAilleurs.has(groupe.nom));
  const tousCoches = disponibles.length > 0 && disponibles.every((g) => ligne.groupes.includes(g.nom));

  return (
    <div
      className={cn(
        'grid gap-4 p-3 lg:grid-cols-[280px_1fr_auto] lg:items-start',
        // Une ligne sans formateur est en cours de saisie : la signaler évite
        // de la laisser en plan et de croire le module couvert.
        !ligne.formateur && 'bg-warning/5'
      )}
    >
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Formateur synchrone
        </Label>
        <ChoixFormateur
          valeur={ligne.formateur}
          options={options}
          cleFocus={cleFocus}
          onChange={(nom) => onChange({ ...ligne, formateur: nom })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Groupes concernés ({ligne.groupes.length}/{ensemble.groupes.length})
        </Label>

        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {ensemble.groupes.map((groupe) => {
            // Un groupe déjà couvert par une autre séance ne peut pas être
            // coché ici : il ne suit qu'une séance.
            const pris = couvertsAilleurs.has(groupe.nom);

            return (
              <label
                key={groupe.nom}
                className={cn(
                  'flex items-center gap-2 text-sm',
                  pris ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'
                )}
                title={pris ? 'Ce groupe suit déjà une autre séance de ce module' : undefined}
              >
                <Checkbox
                  checked={ligne.groupes.includes(groupe.nom)}
                  disabled={pris}
                  onCheckedChange={(valeur) => basculer(groupe.nom, valeur === true)}
                />
                {groupe.nom}
              </label>
            );
          })}
        </div>
      </div>

      {/*
        Deux boutons fantômes côte à côte flottaient sans rien pour les tenir.
        Le groupe shadcn les réunit dans un même contour : ils se lisent comme
        les actions de CETTE séance, et non de la ligne entière.
      */}
      <ButtonGroup className="lg:mt-6">
        <Button
          variant="outline"
          size="sm"
          disabled={disponibles.length === 0}
          title={
            tousCoches
              ? 'Décocher tous les groupes'
              : 'Cocher tous les groupes encore libres'
          }
          onClick={() =>
            onChange({
              ...ligne,
              groupes: tousCoches ? [] : disponibles.map((groupe) => groupe.nom),
            })
          }
        >
          {tousCoches ? <ListX className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
          {tousCoches ? 'Aucun' : 'Tous'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          title="Supprimer cette séance"
          onClick={onSupprimer}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Supprimer cette séance</span>
        </Button>
      </ButtonGroup>

      {ligne.formateur && ligne.groupes.length === 0 && (
        <p className="text-xs text-muted-foreground lg:col-span-3">
          Aucun groupe coché : cette séance ne couvre personne et ne sera pas enregistrée.
        </p>
      )}

      {restants.length > 0 && ligne.groupes.length > 0 && (
        <p className="text-xs text-muted-foreground lg:col-span-3">
          {restants.length} groupe(s) sans séance pour ce module : {restants
            .map((groupe) => groupe.nom)
            .join(', ')}.
        </p>
      )}
    </div>
  );
}

/**
 * Masses horaires d'un module, semestre par semestre.
 *
 * Les trois natures d'heures portent chacune leur couleur — S1, S2, synchrone —
 * pour être distinguées d'un coup d'œil dans une grille dense. Ce sont des
 * teintes de la palette DÉCORATIVE (`accent-*`), jamais le bleu structurel :
 * cf. DESIGN_SYSTEM.md, « icônes, badges de catégorie » uniquement.
 */
function Heures({ module }) {
  const synchrone = heuresSynchrone(module);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Semestre libelle="S1" heures={module.mhpS1 ?? 0} classe="text-accent-sky" />
      <Semestre libelle="S2" heures={module.mhpS2 ?? 0} classe="text-accent-green" />
      <span className="text-muted-foreground">total {heuresPresentiel(module)} h</span>
      {/*
        Même badge que dans l'onglet Synchrone : le directeur doit reconnaître
        au premier regard, depuis la matrice présentielle, quels modules
        appellent en plus une séance à distance.
      */}
      {synchrone > 0 && <BadgeSynchrone heures={synchrone} />}
    </div>
  );
}

/**
 * Semestre du module, en badge.
 *
 * ═══ POURQUOI IL AJOUTE QUELQUE CHOSE AUX HEURES DÉJÀ AFFICHÉES ═══
 * « S1 140 h · S2 0 h » demande de lire deux nombres et d'en tirer une
 * conclusion, module par module. Sur vingt lignes, personne ne le fait. Le
 * semestre est une propriété du module : il se nomme.
 *
 * Les couleurs suivent celles déjà employées pour les masses horaires — S1 bleu
 * ciel, S2 vert — pour qu'un semestre se reconnaisse partout à sa teinte. Un
 * module ANNUEL prend l'orange : il n'est ni l'un ni l'autre, et sa contrainte
 * de planification est différente puisqu'il court sur toute l'année.
 */
function BadgeSemestre({ module }) {
  /*
   * Le libellé LONG ici : la carte a la place, et « Semestre 1 » y est plus
   * parlant qu'un « 1 » isolé au milieu de masses horaires.
   */
  return <BadgeSemestreCommun semestre={semestreModule(module)} long className="px-1.5 py-0.5" />;
}

/** Badge « Teams — N h », identique dans les deux onglets. */
function BadgeSynchrone({ heures }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5">
      <Teams className="h-3.5 w-3.5" />
      <span className="font-medium tabular-nums text-accent-purple-deep">Synchrone {heures} h</span>
    </span>
  );
}

function Semestre({ libelle, heures, classe }) {
  return (
    <span className={cn('font-medium tabular-nums', classe)}>
      {libelle} {heures} h
    </span>
  );
}

/**
 * Masse horaire présentielle ajustable, pour un groupe alterné / apprentissage.
 * ← le bloc `.aff-hours-edit` de affectation-carte.js:1762-1767
 *
 * Elle vit dans la CELLULE et non dans la ligne du module : depuis qu'un même
 * ensemble peut mélanger les modes, deux groupes n'ont pas forcément le même
 * rythme d'alternance.
 */
function MasseAjustable({ module, cleFocus, onChange }) {
  const ajustee = module.masseAjustee === true;
  const signaler = useContext(OuvertureCase);
  // Le champ saisi est une case ouverte, comme une liste déroulante.
  const focus =
    cleFocus && signaler
      ? { onFocus: () => signaler(cleFocus, true), onBlur: () => signaler(cleFocus, false) }
      : {};

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <ChampHeure
        libelle="S1"
        classe="text-accent-sky"
        valeur={module.mhpS1 ?? 0}
        onChange={(valeur) => onChange('mhpS1', valeur)}
        {...focus}
      />
      <ChampHeure
        libelle="S2"
        classe="text-accent-green"
        valeur={module.mhpS2 ?? 0}
        onChange={(valeur) => onChange('mhpS2', valeur)}
        {...focus}
      />

      {ajustee && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          title="Rétablir la masse horaire de la répartition DRIF"
          onClick={() => onChange('mhpS1', null)}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function ChampHeure({ libelle, classe, valeur, onChange, onFocus, onBlur }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className={cn('font-medium', classe)}>{libelle}</span>
      <Input
        type="number"
        min={0}
        max={2000}
        step={0.5}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className="h-7 w-16 px-1.5 text-right text-xs tabular-nums"
      />
    </label>
  );
}

/**
 * Sélecteur de formateur, avec sa charge du moment.
 * ← formateurOptionLabel() : « NOM (S1 : 45h · S2 : 30h · 75h) »
 *
 * Voir la charge AU MOMENT DU CHOIX est ce qui évite d'affecter à l'aveugle et
 * de découvrir la surcharge à la fin.
 */
function ChoixFormateur({ valeur, options, onChange, cleFocus }) {
  const lectureSeule = useContext(LectureSeuleCarte);
  const signaler = useContext(OuvertureCase);

  if (options.length === 0) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
        Ajoutez d&apos;abord des formateurs
      </div>
    );
  }

  return (
    <Select
      value={valeur || AUCUN}
      onValueChange={(nom) => onChange(nom === AUCUN ? '' : nom)}
      onOpenChange={cleFocus && signaler ? (ouvert) => signaler(cleFocus, ouvert) : undefined}
      disabled={lectureSeule}
    >
      <SelectTrigger className={cn('w-full', !valeur && 'text-muted-foreground')}>
        {/*
          Les enfants passés à `SelectValue` remplacent le contenu cloné de
          l'option retenue : sans cela, le déclencheur afficherait aussi les
          heures, illisible dans une cellule de 240 px.
        */}
        <SelectValue>{valeur || 'Non affecté'}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-[380px]">
        <SelectItem value={AUCUN}>Non affecté</SelectItem>
        {options}
      </SelectContent>
    </Select>
  );
}

/**
 * Options du sélecteur de formateur, avec la charge du moment.
 * ← formateurOptionLabel() : « NOM (S1 : 45h · S2 : 30h · 75h) »
 *
 * Voir la charge AU MOMENT DU CHOIX est ce qui évite d'affecter à l'aveugle et
 * de découvrir la surcharge à la fin.
 *
 * Construite une seule fois par `GrilleAffectations` et partagée par toutes les
 * cellules — voir le commentaire sur `options` là-bas.
 */
function optionsFormateurs(formateurs, charges) {
  return formateurs.map((formateur) => {
    const charge = charges.get(formateur.nom.toUpperCase()) ?? { s1: 0, s2: 0, total: 0 };
    const depasse = formateur.masseHoraire > 0 && charge.total > formateur.masseHoraire;

    return (
      <SelectItem key={formateur.nom} value={formateur.nom} textValue={formateur.nom}>
        <span className="flex w-full flex-col">
          <span>{formateur.nom}</span>
          {/*
            Mêmes teintes que les masses horaires des modules — S1 bleu ciel,
            S2 vert — pour qu'un semestre se reconnaisse partout à sa couleur,
            ici comme dans la ligne du module.

            Le TOTAL, lui, distingue les formateurs déjà chargés de ceux qui ne
            le sont pas encore : gris à 0 h, en pleine encre dès la première
            heure, rouge au-delà de la masse statutaire. Une liste de trente
            noms tous en gris ne dit pas où il reste de la place.
          */}
          <span className="text-xs tabular-nums text-muted-foreground">
            <span className="text-accent-sky">S1 {charge.s1} h</span>
            {' · '}
            <span className="text-accent-green">S2 {charge.s2} h</span>
            {' · total '}
            <span
              className={cn(
                charge.total === 0 && 'text-muted-foreground',
                charge.total > 0 && !depasse && 'font-medium text-foreground',
                depasse && 'font-medium text-destructive'
              )}
            >
              {charge.total} h
            </span>
            {formateur.masseHoraire ? ` / ${formateur.masseHoraire} h` : ''}
          </span>
        </span>
      </SelectItem>
    );
  });
}

/**
 * Apparence des trois états d'avancement.
 * ← `.aff-chip__dot.is-full` (#16a34a) / `.is-partial` (#f59e0b) / gris
 *
 * Le gris n'est pas un état d'erreur : « rien de commencé » et « commencé puis
 * laissé en plan » sont deux situations différentes, et c'est la seconde qui
 * demande une reprise.
 */
const APPARENCES = {
  complet: {
    pastille: 'bg-success',
    compteur: 'border-success/30 bg-success/10 text-success',
    texte: 'text-success',
    libelle: 'Affectation terminée',
  },
  partiel: {
    pastille: 'bg-warning',
    compteur: 'border-warning/30 bg-warning/10 text-warning',
    texte: 'text-warning',
    libelle: 'Affectation partielle',
  },
  vide: {
    pastille: 'bg-muted-foreground/40',
    compteur: 'text-muted-foreground',
    texte: 'text-muted-foreground',
    libelle: 'Aucun module affecté',
  },
};

/** Pastille d'état, à côté d'un nom de groupe ou d'ensemble. */
function Pastille({ etat, className }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', APPARENCES[etat].pastille, className)}
      title={APPARENCES[etat].libelle}
    />
  );
}

/** Compteur d'affectations, coloré selon l'avancement. */
function Compteur({ affectes, total }) {
  const etat = etatAffectation(affectes, total);
  const apparence = APPARENCES[etat];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs tabular-nums',
        apparence.compteur
      )}
      title={apparence.libelle}
    >
      <Pastille etat={etat} />
      {affectes}/{total}
    </span>
  );
}

/**
 * Ajoute un groupe à CET ensemble, sans repasser par le formulaire du haut.
 * ← demande du porteur, 2026-09-03 : « ajoute un bouton ajoute un groupe en
 * même ligne du bouton bascule présentiel/synchrone, à l'autre coin, avec un
 * choix de dupliquer selon les autres groupes ou non ».
 *
 * ⚠️ LE GABARIT VIENT DU PREMIER GROUPE DE L'ENSEMBLE, PAS D'UNE NOUVELLE
 * SÉLECTION : secteur, niveau, créneau, année et filière sont déjà connus —
 * les refaire ressaisir depuis « Configuration de la filière » serait le
 * détour que ce bouton existe pour éviter.
 */
function AjouterGroupeEnsemble({ ensemble, onAjouter }) {
  const [ouvert, setOuvert] = useState(false);
  const source = ensemble.groupes[0];

  const ajouter = (dupliquerDepuis) => {
    onAjouter({
      filiere: {
        code: ensemble.codeFiliere,
        intitule: ensemble.intituleFiliere,
        niveau: source.niveau,
        secteur: source.secteur,
        typeFormation: source.typeFormation,
        creneau: source.creneau,
      },
      annee: ensemble.anneeFormation,
      mode: ensemble.mode,
      modules: ensemble.modules,
      dupliquerDepuis,
    });
    setOuvert(false);
  };

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label={`Ajouter un groupe à ${ensemble.intituleFiliere || ensemble.codeFiliere}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Groupe
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <p className="text-xs text-muted-foreground">
          Nouveau groupe pour <strong className="text-foreground">{ensemble.intituleFiliere}</strong>,
          année {ensemble.anneeFormation}, {ensemble.mode}.
        </p>
        <div className="space-y-1.5">
          <Button
            type="button"
            size="sm"
            className="w-full justify-start"
            onClick={() => ajouter(source.nom)}
          >
            <Copy className="h-3.5 w-3.5" />
            Dupliquer les affectations de {source.nom}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => ajouter(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un groupe vide
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Rappel des trois couleurs. ← les `.aff-tag` de la barre d'outils d'origine.
 *
 * Affichée UNE fois, en tête de section : la règle vaut pour tous les
 * ensembles, la répéter dans chacun n'apprenait rien et poussait les onglets.
 */
export function Legende() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(APPARENCES).map(([etat, apparence]) => (
        <span key={etat} className="inline-flex items-center gap-1.5">
          <Pastille etat={etat} />
          {apparence.libelle}
        </span>
      ))}
    </div>
  );
}

/** Un module est identifié par son code, à défaut par son intitulé. */
function cleModule(module) {
  return module?.code || module?.nom || '';
}
