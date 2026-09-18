import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Layers, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import { chargerBase, enregistrerGroupesFq } from '@/features/configuration/api';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { proprietesEnregistrement } from '@/lib/useBrouillonVersionne';
import { cn } from '@/lib/utils';
import CadreReglage from './CadreReglage';
import { useListeEtablissement } from './useListeEtablissement';

/**
 * Composition des groupes FQ.
 * ← table `fq_group_mappings` · `api/profile/get_fq_mappings.php` +
 *   `update_fq_mappings.php` · panneau « Affectation des Groupes aux FQ »
 *   de profile.html + `initFQMappingLogic()` de profil-dialogues.js
 *
 * ═══ À QUOI SERT CET ÉCRAN ═══
 * Un groupe FQ (formation qualifiante) n'a pas de stagiaires à lui : ce sont
 * ceux des groupes réels qui le composent. Déclarer la composition permet à
 * l'emploi du temps de refuser un cours posé sur un constituant pendant que le
 * FQ siège — ce sont les mêmes personnes, elles ne peuvent pas être à deux
 * endroits.
 *
 * ⚠️ UN GROUPE FQ SE RECONNAÎT À SON NOM. C'est la seule marque que la base
 * garde du renommage e-note : le suffixe « (FQ) », posé par `suffixesGroupes`.
 * On ne peut donc pas en déclarer un qui n'existe pas dans la base.
 */
export default function PageGroupesFq() {
  /*
   * ═══ PARTAGEABLE (Phase 5bis, étape d3) ═══ La composition part avec sa
   * version : si un collègue l'a enregistrée entre-temps, le serveur refuse et
   * la page recharge. Un invité « peut consulter » la lit, cases éteintes.
   *
   * ⚠️ LE CONTEXTE DE L'EMPLOI DU TEMPS, qui porte la composition jusqu'à la
   * grille, est périmé par l'invalidation GLOBALE de toute écriture
   * (`lib/queryClient.js`) — et chez un collègue, par l'annonce temps réel.
   */
  const { lectureSeule } = useDroitPage('groupesFq');
  const edition = useListeEtablissement('groupesFq', enregistrerGroupesFq, {
    onSucces: (resultat) =>
      toast.success('Composition enregistrée', { description: `${resultat.valeur.length} lien(s).` }),
  });
  const { contexte, brouillon: liens, setBrouillon: setLiens } = edition;

  const base = useQuery({ queryKey: ['base'], queryFn: chargerBase, retry: false });

  const groupes = base.data?.base?.groupes ?? [];

  /*
   * ⚠️ LES DEUX LISTES SONT DISJOINTES, comme dans l'existant : un groupe FQ ne
   * se compose pas d'autres groupes FQ. Sans cette séparation, on pourrait
   * emboîter deux formations qualifiantes — et la règle de conflit, qui ne
   * descend que d'un cran, ne verrait pas le second niveau.
   */
  const { groupesFq, candidats } = useMemo(() => {
    const estFq = (nom) => String(nom).toUpperCase().includes('(FQ)');
    return {
      groupesFq: groupes.filter(estFq),
      candidats: groupes.filter((nom) => !estFq(nom)),
    };
  }, [groupes]);

  const constituantsDe = (groupeFq) =>
    (liens ?? []).filter((lien) => lien.groupeFq === groupeFq).map((lien) => lien.groupeConstituant);

  const basculer = (groupeFq, groupeConstituant) => {
    setLiens((courants) => {
      const existe = courants.some(
        (lien) => lien.groupeFq === groupeFq && lien.groupeConstituant === groupeConstituant
      );

      return existe
        ? courants.filter(
            (lien) => !(lien.groupeFq === groupeFq && lien.groupeConstituant === groupeConstituant)
          )
        : [...courants, { groupeFq, groupeConstituant }];
    });
  };

  return (
    <>
    <EnTetePartage page="groupesFq" clesARelire={[['etablissement-courant'], ['base']]} />
    <CadreReglage
      titre="Groupes (FQ)"
      chargement={contexte.isLoading || !edition.charge}
      erreur={contexte.isError ? contexte.error.message : null}
      {...proprietesEnregistrement(edition, lectureSeule)}
    >
      {/* <Alerte type="info" titre="Déclarez ce qui compose chaque groupe FQ">
        Un groupe FQ réunit les stagiaires de plusieurs groupes réels. En déclarant sa composition,
        l’emploi du temps refusera de placer un cours sur l’un de ces groupes pendant que le FQ
        siège — ce sont les mêmes personnes.
      </Alerte> */}

      {/*
        ⚠️ LE CAS VIDE ENVOIE AU BON ENDROIT. Un groupe FQ ne se crée pas ici :
        il porte le suffixe « (FQ) » que l'import e-note ou la carte lui a donné.
        Dire seulement « aucun groupe FQ » laisserait chercher un bouton
        « Ajouter » qui n'existe pas.
      */}
      {groupes.length === 0 ? (
        <Alerte type="avertissement" titre="Aucun groupe dans la base">
          Importez votre base e-note ou construisez votre carte depuis « Paramètres → Affectations ».
        </Alerte>
      ) : groupesFq.length === 0 ? (
        <Alerte type="avertissement" titre="Aucun groupe FQ">
          Un groupe FQ se reconnaît au suffixe « (FQ) » de son nom, posé à l’import de la base
          e-note. Cet établissement n’en compte aucun cette année — il n’y a donc rien à composer
          ici.
        </Alerte>
      ) : (
        <div className="space-y-2">
          {groupesFq.map((groupeFq, rang) => (
            <BlocFq
              key={groupeFq}
              groupeFq={groupeFq}
              candidats={candidats}
              choisis={constituantsDe(groupeFq)}
              onBasculer={(constituant) => basculer(groupeFq, constituant)}
              lectureSeule={lectureSeule}
              /*
               * ⚠️ SEUL LE PREMIER EST OUVERT. Chaque bloc monte une case à
               * cocher par groupe de l'établissement — jusqu'à 39 ici, et
               * `CollapsibleContent` DÉMONTE ce qu'il replie. C'est la leçon déjà
               * payée deux fois : la carte d'affectations et le chronogramme.
               */
              ouvertParDefaut={rang === 0}
            />
          ))}
        </div>
      )}
    </CadreReglage>
    </>
  );
}

/**
 * Un groupe FQ et les groupes qui le composent.
 *
 * ⚠️ LE RÉSUMÉ EST SUR L'EN-TÊTE, replié compris : « ai-je déjà composé
 * celui-ci ? » est la question qu'on se pose en arrivant, et il faudrait sinon
 * déplier les cinq blocs pour y répondre.
 */
function BlocFq({ groupeFq, candidats, choisis, onBasculer, ouvertParDefaut, lectureSeule }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const [filtre, setFiltre] = useState('');

  const terme = filtre.trim().toLowerCase();
  const visibles = candidats.filter((nom) => nom.toLowerCase().includes(terme));

  return (
    <Collapsible open={ouvert} onOpenChange={setOuvert} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
        <Layers className="size-4 shrink-0 text-muted-foreground" />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{groupeFq}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {choisis.length === 0
              ? 'Aucun groupe déclaré'
              : `${choisis.length} groupe(s) : ${choisis.join(', ')}`}
          </span>
        </span>

        {/* ⚠️ Un FQ SANS composition est signalé : il n'entraîne alors aucun
            groupe, et l'emploi du temps le traite comme un groupe ordinaire —
            ce qui est rarement ce qu'on veut. */}
        {choisis.length === 0 && (
          <Badge variant="outline" className="shrink-0 border-warning/40 text-warning">
            À composer
          </Badge>
        )}

        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', ouvert && 'rotate-180')}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t p-4">
          {/* Le filtre n'apparaît qu'au-delà d'une douzaine : en dessous il
              occupe la place sans rien faire gagner. */}
          {candidats.length > 12 && (
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtre}
                onChange={(evenement) => setFiltre(evenement.target.value)}
                placeholder="Filtrer les groupes…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          )}

          {visibles.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {candidats.length === 0
                ? 'Aucun groupe réel dans la base : seuls des groupes FQ y figurent.'
                : 'Aucun groupe ne correspond à ce filtre.'}
            </p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {visibles.map((nom) => {
                const coche = choisis.includes(nom);

                return (
                  <Label
                    key={nom}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-normal transition-colors',
                      !lectureSeule && 'cursor-pointer',
                      coche ? 'border-primary/40 bg-primary/5' : !lectureSeule && 'hover:bg-muted'
                    )}
                  >
                    {/* Lecture seule : la case reste, éteinte — c'est elle qui dit
                        ce qui compose le groupe. */}
                    <Checkbox
                      checked={coche}
                      disabled={lectureSeule}
                      onCheckedChange={() => onBasculer(nom)}
                    />
                    <span className="truncate">{nom}</span>
                  </Label>
                );
              })}
            </div>
          )}

          {!lectureSeule && choisis.length > 0 && (
            <div className="mt-3 flex items-center justify-end border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => choisis.forEach(onBasculer)}
              >
                Tout décocher
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
