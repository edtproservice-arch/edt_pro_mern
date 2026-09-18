import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { enregistrerCarte, exporterCarte } from '../api';
import { useCarte } from './useCarte';
import SelecteurFiliere from './SelecteurFiliere';
import ListeFormateurs from './ListeFormateurs';
import GrilleAffectations, { Legende } from './GrilleAffectations';
import BilanCharge from './BilanCharge';
import VueFormateurs from './VueFormateurs';

/**
 * ⚠️ LES DEUX LIBELLÉS SONT DÉCLARÉS UNE FOIS : ils nomment la bascule ET le
 * titre de la section juste à côté. Écrits deux fois, ils auraient fini par se
 * contredire — l'interrupteur annonçant une vue et le titre une autre.
 */
const VUES = {
  ensemble: 'Filières, groupes',
  formateur: 'Formateurs',
};

/**
 * Construction manuelle de la carte d'établissement.
 * ← public/partials/affectation-carte.html + assets/js/affectation-carte.js
 *
 * Voie alternative à l'import e-note, pour un établissement qui n'en dispose
 * pas : filière DRIF → groupes → affectation module par module. Le résultat
 * repasse par le même parseur que l'import, donc produit la même base.
 */
export default function CarteEtablissement({
  onEnregistree,
  baseExistante = null,
  /*
   * Carte déjà enregistrée, reprise telle quelle. L'assistant n'en passe
   * aucune — il construit de zéro ; l'écran de réglages la charge depuis la
   * base, pour qu'on retrouve ses filières et ses affectations.
   */
  carteInitiale = null,
  // Fourni par l'écran de réglages : l'enregistrement y est automatique et
  // n'attend pas le bouton de la carte.
  onModifiee,
  /**
   * Reçoit de quoi REPOSER une carte entière — ce qui permet à l'écran de
   * réglages d'offrir « Défaire ». La carte étant tenue ici, lui seul peut le
   * faire.
   */
  onReprise,
  /*
   * Invité « peut consulter » (Phase 5bis, étape d3) : la carte se parcourt —
   * bilan, matrice, fiches des formateurs, export — mais la génération de
   * groupes, la liste des formateurs et toute affectation disparaissent ou
   * s'éteignent.
   */
  lectureSeule = false,
  /*
   * Page collaborative (Phase 5bis) : reçoit `(cle, ouvert)` quand une case de
   * la matrice s'ouvre ou se ferme — les collègues la voient encadrée.
   */
  onOuverture = null,
}) {
  const carte = useCarte({
    groupesInitiaux: carteInitiale?.groupes ?? [],
    formateursInitiaux: carteInitiale?.formateurs ?? [],
  });
  const [aConfirmer, setAConfirmer] = useState(null);
  const [remplacementAConfirmer, setRemplacementAConfirmer] = useState(false);
  const [message, setMessage] = useState(null);
  /*
   * ⚠️ LA MATRICE RESTE LA VUE PAR DÉFAUT : c'est par elle qu'on CONSTRUIT une
   * carte — filière par filière, groupe par groupe. La vue formateur sert à
   * ÉQUILIBRER une carte déjà posée, ce qui vient ensuite.
   */
  const [vue, setVue] = useState('ensemble');

  const enregistrement = useMutation({
    mutationFn: () =>
      enregistrerCarte({
        formateurs: carte.formateurs,
        groupes: carte.groupes,
      }),
    onSuccess: (resultat) => {
      setMessage(resultat);
      toast.success('Carte enregistrée', {
        description:
          `${resultat.effectifs.groupes} groupe(s), ${resultat.effectifs.affectations} affectation(s).` +
          // Une suppression muette laisse croire que l'ancienne base est
          // toujours là : elle est nommée, ou elle n'a pas eu lieu.
          (resultat.supprime?.base ? ' La base précédente a été remplacée.' : ''),
      });
      onEnregistree?.();
    },
    onError: (erreur) => toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  /*
   * L'export part de la carte À L'ÉCRAN, comme l'enregistrement : c'est bien
   * l'état courant qu'on veut emporter, pas la dernière version enregistrée.
   */
  const exportation = useMutation({
    mutationFn: () => exporterCarte({ formateurs: carte.formateurs, groupes: carte.groupes }),
    onSuccess: (resume) =>
      toast.success('Carte exportée', {
        description: resume
          ? `${resume.groupes} groupe(s), ${resume.lignes} ligne(s) e-note, ${resume.formateurs} formateur(s). Le fichier est réimportable.`
          : undefined,
      }),
    onError: (erreur) => toast.error("L'export n'a pas abouti", { description: erreur.message }),
  });

  function genererGroupes(demande) {
    const { crees, renommages } = carte.genererGroupes(demande);
    setMessage(null);

    toast.success(`${crees.length} groupe(s) généré(s)`, {
      description:
        crees.length > 3
          ? `${crees[0]} → ${crees[crees.length - 1]} · ${demande.modules.length} module(s)`
          : `${crees.join(', ')} · ${demande.modules.length} module(s)`,
    });

    // Un renommage touche des groupes déjà créés : si des séances y sont
    // planifiées, elles référencent l'ancien nom. Le directeur tranche.
    if (renommages.length > 0) {
      setAConfirmer({ crees, renommages });
    }
  }

  /**
   * Ajoute UN groupe à un ensemble déjà présent, depuis son propre bloc.
   * ← demande du porteur, 2026-09-03 : le formulaire du haut fait ressaisir
   * secteur, niveau, créneau, année et filière — que l'ensemble porte déjà.
   */
  function ajouterGroupe(demande) {
    const { crees, renommages } = carte.ajouterGroupeAEnsemble(demande);
    setMessage(null);

    toast.success(`Groupe ${crees[0]} ajouté`, {
      description: demande.dupliquerDepuis
        ? `Affectations présentielles reprises de ${demande.dupliquerDepuis}.`
        : 'Sans affectation — à saisir depuis la matrice.',
    });

    if (renommages.length > 0) {
      setAConfirmer({ crees, renommages });
    }
  }

  /**
   * Report des affectations d'un groupe sur les autres de son ensemble.
   * C'est l'affectation en masse : au-delà de deux groupes, ressaisir la même
   * colonne module par module n'est pas praticable.
   */
  function copierGroupe(nom) {
    const touches = carte.copierAffectations(nom);

    if (touches > 0) {
      toast.success('Affectations reportées', {
        description: `Formateurs de ${nom} copiés sur ${touches} groupe(s).`,
      });
    } else {
      toast.info(`${nom} est seul dans son ensemble`, { description: 'Rien à reporter.' });
    }
  }

  function supprimerGroupe(nom) {
    carte.supprimerGroupe(nom);
    toast.success(`Groupe ${nom} supprimé`);
  }

  function activerModule(cle, module, actif) {
    carte.activerModule(cle, module, actif);
    toast[actif ? 'success' : 'info'](
      actif ? `Module ${module} réactivé` : `Module ${module} désactivé`,
      {
        description: actif
          ? undefined
          : "Il ne sera dispensé dans aucun groupe de l'ensemble, ni suivi en avancement.",
      }
    );
  }

  const { statistiques: stats } = carte;

  /*
   * L'appelant qui enregistre tout seul a besoin de savoir QUOI enregistrer.
   * On lui passe la carte à chaque rendu : c'est lui qui décide du moment.
   */
  useEffect(() => {
    onModifiee?.({ groupes: carte.groupes, formateurs: carte.formateurs });
  }, [carte.groupes, carte.formateurs, onModifiee]);

  /*
   * ═══ REMONTÉE DE « REPRENDRE », POUR « DÉFAIRE » ═══
   * La carte vit dans `useCarte`, donc ICI : l'écran de réglages ne fait que
   * l'observer. Pour qu'il puisse restaurer un état précédent, il lui faut de
   * quoi REPOSER une carte entière — c'est exactement ce que `reprendre` fait
   * déjà pour charger une carte enregistrée.
   *
   * ⚠️ `reprendre` est passé une seule fois, via une référence stable : le
   * remonter à chaque rendu relancerait l'effet en boucle chez l'appelant, qui
   * le garde en dépendance.
   */
  const reprendre = carte.reprendre;
  const signaler = useRef(onReprise);
  signaler.current = onReprise;

  useEffect(() => {
    signaler.current?.((precedente) =>
      reprendre(precedente?.groupes ?? [], precedente?.formateurs ?? [])
    );
  }, [reprendre]);

  return (
    <div className="space-y-6">
      {/* <Alerte type="info" titre="Carte d'établissement">
        Générez les groupes d&apos;une filière depuis la répartition DRIF, puis affectez un
        formateur à chaque module. L&apos;enregistrement remplace la base de l&apos;année scolaire.
      </Alerte> */}

      {/*
        La carte écrase la base existante — formateurs, groupes, affectations.
        Le dire ICI, avant la saisie, et non au moment de perdre les données :
        un directeur qui l'apprend après coup a déjà tout ressaisi pour rien.
        Rien n'est détruit tant qu'il n'a pas enregistré.
      */}
      {baseExistante && (
        <Alerte type="avertissement" titre="Cette carte remplacera la base existante">
          {baseExistante.formateurs} formateur(s), {baseExistante.groupes} groupe(s) et{' '}
          {baseExistante.affectations} affectation(s)
          {baseExistante.origine === 'enote' ? ' issus du fichier e-note' : ' de la carte précédente'}{' '}
          seront <strong>remplacés</strong> au moment de l&apos;enregistrement.
          L&apos;historique des imports e-note, lui, est conservé. Rien
          n&apos;est modifié avant.
        </Alerte>
      )}

      {/*
        La carte passée à l'export est celle qui a servi à CALCULER le bilan
        (groupes projetés, synchrones compris) : le classeur ne peut donc pas
        montrer d'autres chiffres que l'écran.
      */}
      <BilanCharge
        bilan={carte.bilan}
        statistiques={stats}
        carte={{ groupes: carte.groupes, formateurs: carte.formateurs }}
      />

      {!lectureSeule && (
        <>
          <SelecteurFiliere
            onGenerer={genererGroupes}
            enCours={enregistrement.isPending}
            // L'aperçu du nommage doit reprendre après les groupes déjà créés.
            groupes={carte.groupes}
          />

          <ListeFormateurs
            formateurs={carte.formateurs}
            groupes={carte.groupes}
            onAjouter={carte.ajouterFormateur}
            onRetirer={carte.retirerFormateur}
            onRemplacer={carte.remplacerFormateurs}
          />
        </>
      )}

      <div className="space-y-3">
        {/*
          La légende vaut pour TOUS les ensembles : elle est donnée une fois, en
          tête de section. Répétée dans chaque bloc, elle n'apprenait rien et
          poussait les onglets.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium">
            {vue === 'formateur' ? 'Affectations par formateur' : `${VUES.ensemble} & affectations`}
          </h3>

          <div className="flex flex-wrap items-center gap-3">
            {/* ⚠️ LA LÉGENDE N'A DE SENS QUE POUR LA MATRICE : elle explique les
                pastilles d'avancement d'un ensemble, que la vue par formateur
                ne porte pas. */}
            {vue === 'ensemble' && carte.groupes.length > 0 && <Legende />}

            {/*
              ═══ DEUX LECTURES DE LA MÊME CARTE ═══ (2026-09-06, demande du
              porteur.) La matrice répond à « qui enseigne ce module à ce
              groupe ? », la vue formateur à « que porte cette personne, et que
              puis-je encore lui confier ? ». On AFFECTE depuis l'une comme
              depuis l'autre — c'est la parité demandée.
            */}
            {/*
              ⚠️ UN INTERRUPTEUR, PLUS UN GROUPE DE BOUTONS (2026-09-06, demande
              du porteur) — la forme EXACTE de la bascule « Vue globale / Vue
              détaillée » de la page Édition, y compris ses deux règles :

              ⚠️ LES DEUX ÉTATS SONT NOMMÉS. Légendé d'un seul côté, un
              interrupteur ne dit pas ce qu'on QUITTE.

              ⚠️ LE LIBELLÉ ACTIF EST EN PLEINE ENCRE, l'autre en gris : entouré
              de deux textes de même poids, rien ne dirait lequel est en cours.
            */}
            <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal">
              <span
                className={
                  vue === 'formateur' ? 'text-muted-foreground' : 'font-medium text-foreground'
                }
              >
                {VUES.ensemble}
              </span>
              <Switch
                checked={vue === 'formateur'}
                onCheckedChange={(actif) => setVue(actif ? 'formateur' : 'ensemble')}
                aria-label="Basculer entre la vue par filières et la vue par formateurs"
              />
              <span
                className={
                  vue === 'formateur' ? 'font-medium text-foreground' : 'text-muted-foreground'
                }
              >
                {VUES.formateur}
              </span>
            </Label>
          </div>
        </div>

        {vue === 'formateur' ? (
          <VueFormateurs
            lectureSeule={lectureSeule}
            groupes={carte.groupes}
            formateurs={carte.formateurs}
            lignesDe={carte.lignesSynchronesDe}
            onAffecter={carte.affecter}
            onDefinirLignes={carte.definirLignesSynchrone}
          />
        ) : (
          <GrilleAffectations
            lectureSeule={lectureSeule}
            groupes={carte.groupes}
            formateurs={carte.formateurs}
            onAffecter={carte.affecter}
            lignesDe={carte.lignesSynchronesDe}
            onDefinirLignes={carte.definirLignesSynchrone}
            onActiverModule={activerModule}
            onDefinirMasse={carte.definirMasseHoraire}
            onCopierGroupe={copierGroupe}
            onSupprimer={supprimerGroupe}
            onAjouterGroupe={ajouterGroupe}
            onOuverture={onOuverture}
          />
        )}
      </div>

      {/*
        Le bilan d'enregistrement reste à l'écran — le toast disparaît, et c'est
        le seul endroit qui dit ce qui a réellement été écrit en base.
      */}
      {message && (
        <Alerte type="succes" titre="Carte enregistrée">
          {message.effectifs.groupes} groupe(s), {message.effectifs.formateurs} formateur(s),{' '}
          {message.effectifs.affectations} affectation(s).
          {message.supprime?.base && <> La base précédente a été remplacée.</>}
          {message.tracesImportConservees > 0 && (
            <> {message.tracesImportConservees} import(s) e-note conservé(s) dans l&apos;historique.</>
          )}
          {stats.nonAffectes > 0 &&
            ` ${stats.nonAffectes} module(s) restent sans formateur — vous pourrez les affecter plus tard.`}
        </Alerte>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {/*
          L'export est SECONDAIRE : c'est l'enregistrement qui fait foi. Le
          fichier produit reste réimportable, il dépanne mais ne remplace pas
          l'enregistrement — d'où la hiérarchie visuelle.
        */}
        <Button
          type="button"
          variant="outline"
          disabled={carte.groupes.length === 0 || exportation.isPending}
          onClick={() => exportation.mutate()}
          className="sm:w-auto"
        >
          {exportation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4 text-success" />
          )}
          {exportation.isPending ? 'Export…' : 'Exporter la carte'}
        </Button>

        {/*
          En enregistrement automatique, ce bouton n'a plus lieu d'être : le
          laisser ferait croire que rien n'est écrit tant qu'on ne l'a pas
          cliqué. L'export, lui, reste — c'est une action distincte.
        */}
        {!onModifiee && (
          <Button
            className="flex-1"
            disabled={carte.groupes.length === 0 || enregistrement.isPending}
            onClick={() =>
              baseExistante ? setRemplacementAConfirmer(true) : enregistrement.mutate()
            }
          >
            <Save className="h-4 w-4" />
            {enregistrement.isPending ? 'Enregistrement…' : 'Enregistrer la carte'}
          </Button>
        )}
      </div>

      {/*
        Dernier garde-fou avant l'écrasement. L'avertissement plus haut informe ;
        celui-ci fait décider — et il nomme ce qui disparaît, sinon « Confirmer »
        ne veut rien dire.
      */}
      <ConfirmationAction
        ouvert={remplacementAConfirmer}
        onOpenChange={setRemplacementAConfirmer}
        titre="Remplacer la base de l'année ?"
        description={
          baseExistante
            ? `La base actuelle (${baseExistante.formateurs} formateur(s), ` +
              `${baseExistante.groupes} groupe(s), ${baseExistante.affectations} affectation(s)) ` +
              `sera remplacée par cette carte : ${carte.statistiques.groupes} groupe(s) et ` +
              `${carte.statistiques.formateursAffectes} formateur(s) affecté(s). ` +
              `Cette action ne peut pas être annulée — exportez la carte si vous voulez en garder une copie.`
            : ''
        }
        libelleConfirmation="Remplacer la base"
        destructive
        onConfirmer={() => {
          setRemplacementAConfirmer(false);
          enregistrement.mutate();
        }}
      />

      <ConfirmationAction
        ouvert={Boolean(aConfirmer)}
        onOpenChange={(ouvert) => !ouvert && setAConfirmer(null)}
        titre="Une autre filière utilise déjà ce préfixe"
        description={
          aConfirmer
            ? `${aConfirmer.renommages.length} groupe(s) d'une filière homonyme peuvent être renommés ` +
              `pour porter leur code secteur (${aConfirmer.renommages
                .slice(0, 3)
                .map((r) => `${r.ancien} → ${r.nouveau}`)
                .join(', ')}${aConfirmer.renommages.length > 3 ? '…' : ''}). ` +
              `Si des séances sont déjà planifiées sur ces groupes, elles référencent l'ancien nom. ` +
              `Refuser laisse les anciens groupes tels quels : seuls les nouveaux portent un suffixe.`
            : ''
        }
        libelleConfirmation="Renommer"
        onConfirmer={() => {
          carte.appliquerRenommages(aConfirmer.renommages);
          setAConfirmer(null);
        }}
      />
    </div>
  );
}

