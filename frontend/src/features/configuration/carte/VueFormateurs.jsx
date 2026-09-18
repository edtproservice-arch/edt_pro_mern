import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Presentation, Search, X } from 'lucide-react';
import {
  affectationsDuFormateur,
  calculerCharges,
  placesDisponibles,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BadgeRegional from '@/components/common/BadgeRegional';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import Teams from '@/components/icons/Teams';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';

/**
 * La carte d'affectations, vue PAR FORMATEUR.
 * (2026-09-06, demande du porteur : « en affectation chez le directeur je veux
 * qu'il soit en vue Filières, groupes (déjà existe) et vue formateur » — et,
 * sur la question de ce qu'elle doit permettre : « le directeur peut faire
 * l'affectation depuis la vue filière et groupe ou bien la vue formateur, le
 * même ».)
 *
 * ═══ ⚠️ PARITÉ, PAS RÉCAPITULATIF ═══ On y affecte comme dans la matrice, avec
 * les mêmes fonctions d'écriture (`onAffecter`, `onDefinirLignes`) : il n'y a
 * pas deux états à tenir en phase, seulement deux lectures de `groupes[]`.
 * Une vue en lecture seule aurait obligé à revenir dans l'autre pour corriger
 * la sous-charge qu'on vient d'y repérer — le geste même qu'on vient faire ici.
 *
 * ═══ ⚠️⚠️ TOUS LES BLOCS SONT REPLIÉS D'OFFICE ═══ La leçon est écrite trois
 * fois dans ce projet — la carte d'affectations (780 listes Radix montées
 * d'un coup), le chronogramme (17 grilles, 28 961 nœuds), les blocs de session.
 * Un établissement compte quarante formateurs ; déplier le premier suffit.
 * L'en-tête porte déjà le nom, la charge et le nombre d'affectations : on
 * choisit lequel ouvrir sans l'ouvrir.
 */
export default function VueFormateurs({
  groupes,
  formateurs,
  lignesDe,
  onAffecter,
  onDefinirLignes,
  // Invité « peut consulter » (Phase 5bis, étape d3) : les fiches se lisent.
  lectureSeule = false,
}) {
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(null);

  /*
   * ⚠️ `carte.groupes` EST DÉJÀ PROJETÉ (`useCarte` rend `groupesProjetes`) :
   * les séances synchrones proposées par défaut — le formateur présentiel
   * dominant, que le directeur n'a pas encore touchées — y figurent, comme dans
   * le bilan et la matrice. Reprojeter ici en aurait fait un second calcul, et
   * la fiche aurait pu montrer moins d'heures que le total affiché à côté.
   */
  const charges = useMemo(() => calculerCharges(groupes), [groupes]);

  const visibles = useMemo(() => {
    const terme = recherche.trim().toUpperCase();
    if (terme === '') return formateurs;
    return formateurs.filter(
      (formateur) =>
        String(formateur.nom ?? '').toUpperCase().includes(terme) ||
        String(formateur.matricule ?? '').toUpperCase().includes(terme)
    );
  }, [formateurs, recherche]);

  if (formateurs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun formateur dans la carte. Ajoutez-les d’abord dans « Formateurs ».
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* ⚠️ LA RECHERCHE DÈS DOUZE FORMATEURS, comme la liste des formateurs :
          en dessous, la liste se parcourt d'un regard. */}
      {formateurs.length > 12 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Filtrer par nom ou matricule…"
            className="h-9 pl-8"
          />
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun formateur ne correspond à « {recherche} ».
        </p>
      ) : (
        visibles.map((formateur) => (
          <FicheFormateur
            key={formateur.nom}
            formateur={formateur}
            groupes={groupes}
            charge={charges.get(String(formateur.nom ?? '').toUpperCase())}
            ouvert={ouvert === formateur.nom}
            onBasculer={() =>
              setOuvert((actuel) => (actuel === formateur.nom ? null : formateur.nom))
            }
            onAffecter={onAffecter}
            onDefinirLignes={onDefinirLignes}
            lignesDe={lignesDe}
            lectureSeule={lectureSeule}
          />
        ))
      )}
    </div>
  );
}

/** Un formateur : son en-tête toujours visible, son détail à la demande. */
function FicheFormateur({
  formateur,
  groupes,
  charge,
  ouvert,
  onBasculer,
  onAffecter,
  onDefinirLignes,
  lignesDe,
  lectureSeule,
}) {
  const nom = formateur.nom;

  /* ⚠️ CALCULÉ SEULEMENT QUAND LE BLOC EST OUVERT : sur quarante formateurs,
     parcourir toute la carte pour chacun coûterait autant que de tout monter. */
  const lignes = useMemo(
    () => (ouvert ? affectationsDuFormateur(groupes, nom) : []),
    [ouvert, groupes, nom]
  );

  const total = charge?.total ?? 0;
  const statutaire = formateur.masseHoraire ?? 0;
  const depasse = statutaire > 0 && total > statutaire;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
      >
        {ouvert ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{nom}</span>
          {formateur.matricule && (
            <span className="block text-xs text-muted-foreground">{formateur.matricule}</span>
          )}
        </span>

        {/*
          ⚠️ LA CHARGE EST SUR L'EN-TÊTE, pas dans le détail : c'est elle qu'on
          parcourt pour trouver QUI est sous-chargé — la question qui amène sur
          cette vue. La lire imposerait sinon d'ouvrir les quarante blocs.
        */}
        <span className="shrink-0 text-right text-sm tabular-nums">
          <span className={cn('font-semibold', depasse && 'text-destructive')}>
            {nombre(total)} h
          </span>
          {statutaire > 0 && (
            <span className="text-muted-foreground"> / {nombre(statutaire)} h</span>
          )}
          <span className="block text-xs text-muted-foreground">
            S1 {nombre(charge?.s1 ?? 0)} · S2 {nombre(charge?.s2 ?? 0)}
          </span>
        </span>
      </button>

      {/* ⚠️ DÉMONTÉ, PAS MASQUÉ : c'est ce démontage qui fait tout le gain. */}
      {ouvert && (
        <div className="space-y-3 border-t p-4">
          {lignes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {lectureSeule
                ? 'Aucune affectation.'
                : 'Aucune affectation. Utilisez « Affecter un module » ci-dessous.'}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {lignes.map((ligne) => (
                <LigneAffectation
                  key={ligne.cle}
                  ligne={ligne}
                  onRetirer={
                    lectureSeule
                      ? null
                      : () => retirer(ligne, { onAffecter, onDefinirLignes, lignesDe, nom })
                  }
                />
              ))}
            </ul>
          )}

          {!lectureSeule && (
          <AjoutAffectation
            groupes={groupes}
            nom={nom}
            onAffecter={onAffecter}
            onDefinirLignes={onDefinirLignes}
            lignesDe={lignesDe}
          />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Retire une affectation.
 *
 * ═══ ⚠️ DEUX CHEMINS D'ÉCRITURE, ET ILS NE SONT PAS INTERCHANGEABLES ═══
 * Le présentiel vit sur le MODULE d'un groupe (`affecter`). Le synchrone vit
 * dans la table des SÉANCES (`definirLignesSynchrone`) : écrire directement sur
 * le module y serait écrasé à la projection suivante. C'est la même séparation
 * que la matrice, et la raison pour laquelle les deux vues partagent ces deux
 * fonctions plutôt que d'en inventer une troisième.
 */
function retirer(ligne, { onAffecter, onDefinirLignes, lignesDe, nom }) {
  if (ligne.type === 'presentiel') {
    onAffecter(ligne.groupe, ligne.module, 'formateurPresentiel', '');
    return;
  }

  const lignesSynchrones = lignesDe(ligne.ensemble, ligne.module);
  onDefinirLignes(
    ligne.ensemble,
    ligne.module,
    lignesSynchrones.filter(
      (seance) => String(seance.formateur ?? '').toUpperCase() !== String(nom).toUpperCase()
    )
  );
}

function LigneAffectation({ ligne, onRetirer }) {
  const synchrone = ligne.type === 'synchrone';

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {synchrone ? (
          <Teams className="size-3.5 shrink-0" />
        ) : (
          <Presentation className="size-3.5 shrink-0 text-accent-teal" />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{ligne.intitule || ligne.module}</span>
          <span className="block text-xs text-muted-foreground">
            {ligne.module} · {ligne.groupes.join(' ')}
          </span>
        </span>
      </span>

      {/* ⚠️ MÊME ORDRE QUE LA MATRICE — régional puis semestre : deux vues de la
          même carte ne peuvent pas ranger leurs badges autrement. Et le libellé
          LONG, comme elle : la ligne a la place, et « Semestre 1 » y est plus
          parlant qu'un « 1 » isolé à côté d'un nombre d'heures. */}
      {ligne.estRegional && <BadgeRegional estRegional />}
      <BadgeSemestre semestre={ligne.semestre} long className="shrink-0 px-1.5 py-0.5" />

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {nombre(ligne.total)} h
      </span>

      {onRetirer && (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Retirer ${ligne.module} sur ${ligne.groupes.join(' ')}`}
        onClick={onRetirer}
      >
        <X className="size-4" />
      </Button>
      )}
    </li>
  );
}

/**
 * Confier des modules de plus à ce formateur.
 *
 * ═══ ⚠️ UNE MATRICE MODULES × GROUPES, COMME LA VUE PAR FILIÈRE ═══
 * (2026-09-06, demande du porteur : « affiche les listes des groupes comme
 * celui en mode filière, groupe, mais au lieu d'un select mets seulement une
 * case à cocher ».)
 *
 * La version précédente enchaînait quatre listes — filière, module, nature,
 * groupes : il fallait ressortir et tout recommencer pour chaque module, alors
 * qu'on vient précisément d'en confier plusieurs d'un coup à quelqu'un de
 * sous-chargé. La matrice montre TOUT l'ensemble d'un regard et se coche en une
 * seule passe.
 *
 * ⚠️ UNE CASE, PAS UN SÉLECTEUR : dans la vue par filière, la cellule choisit
 * QUI enseigne — d'où la liste déroulante. Ici la personne est déjà connue,
 * c'est le titre de la fiche : il ne reste qu'une question fermée, « celui-ci,
 * oui ou non ».
 */
function AjoutAffectation({ groupes, nom, onAffecter, onDefinirLignes, lignesDe }) {
  const [ouvert, setOuvert] = useState(false);
  const [ensemble, setEnsemble] = useState('');
  const [type, setType] = useState('presentiel');
  /** { [codeModule]: string[] } — les groupes cochés, par module. */
  const [choix, setChoix] = useState({});

  const places = useMemo(() => placesDisponibles(groupes, nom), [groupes, nom]);
  const ensembleChoisi = places.find((place) => place.cle === ensemble) ?? null;

  /* ⚠️ UN MODULE SANS HEURES DE CETTE NATURE N'A PAS DE LIGNE dans cet onglet —
     comme la matrice, dont l'onglet Synchrone ne montre que les modules qui en
     portent. L'y affecter créerait une ligne qui ne pèse rien. */
  const modules = ensembleChoisi?.modules.filter((fiche) => fiche[type].heures > 0) ?? [];

  const libresDe = (nature) =>
    (ensembleChoisi?.modules ?? []).reduce(
      (total, fiche) => total + fiche[nature].libres.length,
      0
    );

  const coches = Object.values(choix).reduce((total, liste) => total + liste.length, 0);

  const basculer = (code, groupe) =>
    setChoix((actuel) => {
      const deja = actuel[code] ?? [];
      return {
        ...actuel,
        [code]: deja.includes(groupe) ? deja.filter((g) => g !== groupe) : [...deja, groupe],
      };
    });

  const reinitialiser = () => {
    setEnsemble('');
    setType('presentiel');
    setChoix({});
  };

  const valider = () => {
    if (coches === 0) return;

    for (const [code, groupesCoches] of Object.entries(choix)) {
      if (groupesCoches.length === 0) continue;

      if (type === 'presentiel') {
        for (const groupe of groupesCoches) onAffecter(groupe, code, 'formateurPresentiel', nom);
        continue;
      }

      /*
       * ⚠️ UNE SÉANCE, PAS UNE AFFECTATION PAR GROUPE : le synchrone se déclare
       * comme une ligne « un formateur, les groupes qu'il couvre ». En écrire
       * une par groupe créerait autant de séances distinctes, et multiplierait
       * la charge par leur nombre.
       *
       * ⚠️⚠️ ET ON RÉUNIT AVEC SES GROUPES DÉJÀ COUVERTS. Ses cellules à lui sont
       * cochées ET ÉTEINTES : elles ne peuvent donc pas figurer dans `choix`.
       * N'envoyer que les nouvelles REMPLACERAIT sa séance et lui RETIRERAIT en
       * silence les groupes qu'il assurait déjà — cocher un groupe de plus en
       * aurait fait perdre trois.
       */
      const fiche = modules.find((entree) => entree.code === code);
      const autres = lignesDe(ensemble, code).filter(
        (seance) => String(seance.formateur ?? '').toUpperCase() !== String(nom).toUpperCase()
      );
      const tous = [...new Set([...(fiche?.synchrone.miens ?? []), ...groupesCoches])];
      onDefinirLignes(ensemble, code, [...autres, { formateur: nom, groupes: tous }]);
    }

    reinitialiser();
    setOuvert(false);
  };

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(etat) => {
        setOuvert(etat);
        if (!etat) reinitialiser();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Affecter un module
        </Button>
      </DialogTrigger>

      {/*
        ═══ ⚠️ UNE BOÎTE DE DIALOGUE, PLUS UN POPOVER ═══ (2026-09-06.) Le
        panneau flottant était ancré sous un bouton qui vit au PIED d'une fiche
        dépliée : son contenu débordait vers le bas de la page. Une modale se
        centre, et laisse la place à une matrice.

        ⚠️ `min-w-0` SUR LE CONTENEUR DÉFILANT, `overflow-x-hidden` SUR LA MODALE :
        `DialogContent` est une GRILLE, et un enfant de grille a `min-width:auto`
        — il refuse de devenir plus étroit que son contenu. Sans ces deux-là, la
        modale entière s'élargirait au lieu de laisser défiler le tableau. Piège
        déjà payé sur le détail du bilan de charge.
      */}
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto overflow-x-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Affecter des modules</DialogTitle>
          <DialogDescription>
            À {nom} — choisissez une filière, puis cochez les modules et les groupes.
          </DialogDescription>
        </DialogHeader>

        {places.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Aucun module affectable dans la carte : ils sont tous désactivés, ou sans masse horaire
            déclarée.
          </p>
        ) : (
          <div className="min-w-0 space-y-3 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Filière · année · mode</Label>
              <Select
                value={ensemble}
                onValueChange={(valeur) => {
                  setEnsemble(valeur);
                  setChoix({});
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choisir…" />
                </SelectTrigger>
                <SelectContent>
                  {places.map((place) => (
                    <SelectItem key={place.cle} value={place.cle}>
                      {place.intituleFiliere || place.codeFiliere} · année {place.anneeFormation}
                      {place.mode ? ` · ${place.mode}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ensembleChoisi && (
              <>
                {/*
                  ⚠️ LES MÊMES ONGLETS QUE LA MATRICE, avec ses icônes : le
                  présentiel est propre à chaque groupe, le synchrone est
                  mutualisé. Les mélanger laisserait croire qu'il faut un
                  formateur synchrone par groupe.

                  Le compte est ici celui des places LIBRES — c'est ce qu'on
                  vient y chercher, là où la matrice compte ce qui est pourvu.
                */}
                <Tabs
                  value={type}
                  onValueChange={(valeur) => {
                    setType(valeur);
                    setChoix({});
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="presentiel" className="gap-2">
                      <Presentation className="size-4 text-accent-teal" />
                      Présentiel
                      <span className="text-xs text-muted-foreground">
                        {libresDe('presentiel')}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="synchrone" className="gap-2">
                      <Teams className="size-4" />
                      Synchrone
                      <span className="text-xs text-muted-foreground">{libresDe('synchrone')}</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {modules.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Aucun module ne porte d’heures{' '}
                    {type === 'synchrone' ? 'synchrones' : 'de présentiel'} dans cette filière.
                  </p>
                ) : (
                  <MatriceChoix
                    modules={modules}
                    groupes={ensembleChoisi.groupes}
                    type={type}
                    choix={choix}
                    onBasculer={basculer}
                  />
                )}

                <Legende />
              </>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {coches === 0 ? 'Aucune case cochée' : `${coches} affectation(s) à créer`}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={coches === 0} onClick={valider}>
              Affecter
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * L'état d'une case, qui décide de ce qu'elle montre.
 *
 * ⚠️ QUATRE ÉTATS, PAS TROIS. « absent » n'est pas « pris » : le groupe ne suit
 * tout simplement pas ce module. Les confondre ferait chercher un titulaire qui
 * n'existe pas.
 */
function etatCellule(fiche, type, groupe) {
  const nature = fiche[type];
  if (nature.miens.includes(groupe)) return { etat: 'mien' };
  const pris = nature.pris.find((entree) => entree.groupe === groupe);
  if (pris) return { etat: 'pris', formateur: pris.formateur };
  if (nature.libres.includes(groupe)) return { etat: 'libre' };
  return { etat: 'absent' };
}

/** La matrice modules × groupes, reprise de la vue par filière. */
function MatriceChoix({ modules, groupes, type, choix, onBasculer }) {
  return (
    /* ⚠️ LE TABLEAU DÉFILE, PAS LA MODALE : c'est le pendant du `min-w-0` posé
       plus haut. Un ensemble peut porter six groupes. */
    <div className="min-w-0 overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-tableau-tete">
            {/* ⚠️ LE FOND EST SUR LA CELLULE, pas sur la rangée : une colonne
                collante sans fond opaque laisse défiler les cases dessous. */}
            <th className="sticky left-0 z-10 bg-tableau-tete px-3 py-2 text-left font-medium">
              Module
            </th>
            {groupes.map((groupe) => (
              <th key={groupe} className="whitespace-nowrap px-3 py-2 text-center font-medium">
                {groupe}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {modules.map((fiche) => (
            <tr key={fiche.code}>
              <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs">{fiche.code}</span>
                  {fiche.estRegional && <BadgeRegional estRegional />}
                  <BadgeSemestre semestre={fiche.semestre} long className="px-1.5 py-0.5" />
                </span>
                <span className="mt-0.5 block max-w-[16rem] truncate text-xs text-muted-foreground">
                  {fiche.intitule || 'sans intitulé'} · {nombre(fiche[type].heures)} h
                </span>
              </td>

              {groupes.map((groupe) => {
                const { etat, formateur } = etatCellule(fiche, type, groupe);
                const coche = (choix[fiche.code] ?? []).includes(groupe);
                const libelle =
                  etat === 'mien'
                    ? `${fiche.code} — ${groupe} : déjà affecté`
                    : etat === 'pris'
                      ? `${fiche.code} — ${groupe} : pris par ${formateur}`
                      : `${fiche.code} — ${groupe}`;

                return (
                  <td key={groupe} className="px-3 py-2 text-center align-middle">
                    {etat === 'absent' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex flex-col items-center gap-0.5">
                        <Checkbox
                          checked={etat === 'mien' ? true : coche}
                          disabled={etat !== 'libre'}
                          onCheckedChange={() => onBasculer(fiche.code, groupe)}
                          aria-label={libelle}
                        />
                        {/* ⚠️ LE TITULAIRE EST NOMMÉ SOUS LA CASE. Une case
                            éteinte et muette serait indiscernable d'un groupe
                            qui ne suit pas le module — et on irait vérifier la
                            carte pour rien. */}
                        {etat === 'pris' && (
                          <span className="max-w-[7rem] truncate text-[0.65rem] leading-tight text-muted-foreground">
                            {formateur}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ⚠️ TROIS ÉTATS SE RESSEMBLENT À L'ŒIL : sans légende, une case cochée ET
 * éteinte se lit comme un défaut plutôt que comme « c'est déjà à lui ».
 */
function Legende() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Checkbox checked disabled className="size-3.5" />
        déjà à lui
      </span>
      <span className="flex items-center gap-1.5">
        <Checkbox disabled className="size-3.5" />
        pris — le titulaire est nommé
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden>—</span>
        ce groupe ne suit pas ce module
      </span>
    </p>
  );
}
