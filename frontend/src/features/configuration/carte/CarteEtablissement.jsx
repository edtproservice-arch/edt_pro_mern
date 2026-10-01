import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { chargerContraintesFormateurs, chargerEtablissementCourant, enregistrerCarte, exporterCarte } from '../api';
import { identifiantFormateur } from '../etapes/filtresFormateurs';
import DialogueGroupesRetires from '../DialogueGroupesRetires';
import { useCarte } from './useCarte';
import SelecteurFiliere from './SelecteurFiliere';
import ListeFormateurs from './ListeFormateurs';
import ArbreCarte from './ArbreCarte';
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
   * ═══ FORMATEUR INVITÉ, RESTREINT À SES CASES VIDES (2026-09-27, demande du
   * porteur) ═══ Le matricule (`utilisateur.identifiant`) du compte connecté,
   * SEULEMENT s'il s'agit d'un formateur invité en partage sur cette page —
   * `null` pour le directeur, un gestionnaire, ou un invité « peut consulter »
   * (déjà couvert par `lectureSeule`). Résolu ici en `{ nom }` : les deux vues
   * (matrice et « Formateurs ») raisonnent sur le NOM, pas le matricule.
   */
  matriculeFormateurRestreint = null,
  /*
   * Page collaborative (Phase 5bis) : reçoit `(cle, ouvert)` quand une case de
   * la matrice s'ouvre ou se ferme — les collègues la voient encadrée.
   */
  onOuverture = null,
  /*
   * ⚠️ LA LISTE DES FORMATEURS (ajout, import Excel, retrait) n'est plus dans la
   * carte des RÉGLAGES : elle est passée à la page Formateurs (2026-09-19, demande
   * du porteur). L'ASSISTANT la garde ici — il construit la carte de zéro, avant
   * que la base existe, donc avant qu'une page Formateurs ait quoi que ce soit à
   * montrer.
   */
  avecListeFormateurs = true,
  /*
   * ═══ DEUX PAGES SE PARTAGENT CETTE CARTE (2026-09-19, demande du porteur) ═══
   * « Configuration de la filière » (choisir une filière, générer ses groupes) est
   * passée dans Paramètres → Carte ; Paramètres → Affectations ne garde que ce
   * qu'on y FAIT — le bilan, la matrice, la vue par formateur, l'export.
   *
   * ⚠️ MÊME ÉTAT, MÊME ENREGISTREMENT : c'est la même carte, enregistrée d'un bloc
   * avec la version de la base. Deux composants distincts auraient chacun leur
   * copie, et l'un écraserait l'autre. L'ASSISTANT garde les deux (défauts).
   */
  avecSelecteurFiliere = true,
  avecAffectations = true,
  /*
   * Le schéma établissement → années → filières, avec ses « − » et « + » : la page
   * Carte seulement. ⚠️ Il lit et modifie CETTE carte (`carte.groupes`) — d'où sa
   * place ici plutôt que dans la page, qui ne tient pas l'état des groupes.
   */
  avecArbre = false,
  /** Groupe à montrer dans la matrice (`?groupe=` de la page) — voir `GrilleAffectations`. */
  groupeCible = null,
  /** Où mène le badge d'un groupe du schéma — voir `ArbreCarte`. Absent : un lien vers Paramètres. */
  onOuvrirGroupe = null,
}) {
  const carte = useCarte({
    groupesInitiaux: carteInitiale?.groupes ?? [],
    formateursInitiaux: carteInitiale?.formateurs ?? [],
  });

  /*
   * ═══ LE MATRICULE RÉSOLU EN NOM DE LA CARTE (2026-09-27) ═══ Les comptes
   * formateur sont créés depuis cette même carte, matricule pour matricule
   * (`comptes.service.js`, `candidatsFormateurs`) : c'est la clé fiable pour
   * retrouver SON `formateurs[].nom` — celui que `formateurPresentiel` et les
   * séances synchrones portent, pas son identifiant de connexion.
   *
   * ⚠️ `{ nom: null }`, PAS `null`, QUAND LE MATRICULE NE CORRESPOND À RIEN :
   * la carte a pu changer sous ses pieds (matricule corrigé, formateur retiré).
   * `GrilleAffectations` s'en sert pour ne rien lui laisser choisir plutôt que
   * de deviner — voir `FormateurRestreintCarte`.
   */
  const formateurRestreint = useMemo(() => {
    if (!matriculeFormateurRestreint) return null;
    const cle = String(matriculeFormateurRestreint).trim();
    const trouve = carte.formateurs.find((f) => String(f.matricule ?? '').trim() === cle);
    return { nom: trouve?.nom ?? null };
  }, [matriculeFormateurRestreint, carte.formateurs]);

  /*
   * ═══ LES ESPACES, POUR DÉCLARER OÙ UN MODULE SE DONNE ═══ (2026-09-23)
   * Même clé de cache que les pages de réglages : elle est presque toujours
   * déjà chargée, et cette requête ne coûte alors rien.
   *
   * ⚠️ `retry: false` ET UN REPLI VIDE : l'assistant de configuration monte
   *    cette carte AVANT que l'établissement ait des espaces — et même avant
   *    qu'il existe. Sans espace, `GrilleAffectations` n'affiche simplement pas
   *    le sélecteur, plutôt qu'un bouton mort où chercher son erreur.
   */
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });
  const salles = etablissement.data?.etablissement?.espaces ?? [];

  /*
   * ═══ LES ESPACES ATTRIBUÉS À CHAQUE FORMATEUR (2026-09-27, demande du
   * porteur) ═══ Mêmes contraintes que Paramètres → Formateurs (clé de cache
   * partagée) : « Salles de ce module » ne propose plus toute la carte, mais
   * seulement les locaux que CE formateur peut utiliser — et les impose d'office
   * s'il n'en a qu'un.
   *
   * ⚠️ `retry: false` ET UN REPLI VIDE : un invité qui n'a que le droit sur
   *    « affectations » n'a pas forcément celui sur « formateurs » ou « emploi »
   *    que cette route exige (`exigerDroitPage(['formateurs', 'emploi'], ...)`)
   *    — un 403 ici ne doit pas casser la carte, seulement renoncer au filtre.
   */
  const contraintes = useQuery({
    queryKey: ['base', 'contraintes'],
    queryFn: chargerContraintesFormateurs,
    retry: false,
  });

  const espacesParNomFormateur = useMemo(() => {
    const parFormateur = new Map(
      (contraintes.data?.contraintes ?? []).map((entree) => [entree.formateur, entree])
    );
    const map = new Map();
    for (const formateur of carte.formateurs) {
      const cle = identifiantFormateur({ matricule: formateur.matricule, nomComplet: formateur.nom });
      map.set(formateur.nom, parFormateur.get(cle)?.espaces ?? []);
    }
    return map;
  }, [contraintes.data, carte.formateurs]);

  const [aConfirmer, setAConfirmer] = useState(null);
  const [remplacementAConfirmer, setRemplacementAConfirmer] = useState(false);
  const [groupeARetirer, setGroupeARetirer] = useState(null);
  /*
   * ⚠️ CE QUE L'ENREGISTREMENT DÉTRUIRAIT, quand le serveur a refusé en 409.
   *    Il porte les CHIFFRES — heures de chronogramme, séances, stagiaires —
   *    parce que « des références existent » ferait confirmer à l'aveugle.
   */
  const [suppressionsAConfirmer, setSuppressionsAConfirmer] = useState(null);
  const [message, setMessage] = useState(null);
  /*
   * ⚠️ LA MATRICE RESTE LA VUE PAR DÉFAUT : c'est par elle qu'on CONSTRUIT une
   * carte — filière par filière, groupe par groupe. La vue formateur sert à
   * ÉQUILIBRER une carte déjà posée, ce qui vient ensuite.
   */
  const [vue, setVue] = useState('ensemble');

  const enregistrement = useMutation({
    mutationFn: (confirmerSuppressions = false) =>
      enregistrerCarte(
        {
          formateurs: carte.formateurs,
          groupes: carte.groupes,
        },
        undefined,
        confirmerSuppressions
      ),
    onSuccess: (resultat) => {
      setMessage(resultat);
      setSuppressionsAConfirmer(null);
      /*
       * ⚠️ UNE CASCADE NE PASSE PAS EN SILENCE. Le directeur vient de perdre une
       *    planification entière : le lui dire APRÈS est le minimum, même s'il
       *    l'a confirmé — entre la confirmation et le résultat, il peut s'être
       *    trompé de groupe.
       */
      if (resultat.cascade) {
        const { groupes: partis, chronogrammes, seances, stagiaires } = resultat.cascade;
        toast.warning(`${partis.join(', ')} retiré(s) de la carte`, {
          description:
            `${chronogrammes} chronogramme(s) et ${seances} séance(s) supprimé(s), ` +
            `${stagiaires} stagiaire(s) détaché(s). Les absences sont conservées.`,
        });
      }
      toast.success('Carte enregistrée', {
        description:
          `${resultat.effectifs.groupes} groupe(s), ${resultat.effectifs.affectations} affectation(s).` +
          // Une suppression muette laisse croire que l'ancienne base est
          // toujours là : elle est nommée, ou elle n'a pas eu lieu.
          (resultat.supprime?.base ? ' La base précédente a été remplacée.' : ''),
      });
      onEnregistree?.();
    },
    onError: (erreur) => {
      /*
       * ═══ ⚠️ UN REFUS QUI DEMANDE, PAS UN REFUS QUI BLOQUE ═══
       * Le serveur a vu que des groupes retirés sont encore utilisés et n'a
       * RIEN écrit. On montre ce qui partirait, et le directeur tranche.
       */
      if (erreur.code === 'GROUPES_ENCORE_UTILISES') {
        setSuppressionsAConfirmer(erreur.details ?? []);
        return;
      }
      toast.error('Enregistrement impossible', { description: erreur.message });
    },
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

  /**
   * « + » d'une filière : un groupe VIERGE de plus dans cette filière et cette année.
   * Le gabarit (niveau, secteur, créneau, mode, modules) est celui du premier
   * groupe de l'ensemble — rien à ressaisir. Pour reprendre aussi les
   * affectations d'un groupe, le bouton « Groupe » d'Affectations le propose.
   */
  function ajouterGroupeDeFiliere(filiere) {
    const modele = filiere.modele;
    ajouterGroupe({
      filiere: {
        code: modele.codeFiliere,
        intitule: modele.intituleFiliere,
        niveau: modele.niveau,
        secteur: modele.secteur,
        typeFormation: modele.typeFormation,
        creneau: modele.creneau,
      },
      annee: filiere.annee,
      mode: modele.mode,
      // Sans les formateurs ni la fusion d'un autre groupe : celui-ci part vierge.
      modules: (modele.modules ?? []).map(({ groupeFusion, ...module }) => module),
      dupliquerDepuis: null,
    });
  }

  /**
   * ⚠️ RETIRER UN GROUPE SE CONFIRME TOUJOURS, quelle que soit son année (2026-09-19,
   * demande du porteur). La confirmation n'était demandée que pour un groupe qui
   * portait des formateurs : un groupe de 3ème année, souvent encore vierge, partait
   * sans un mot. La même boîte sert au « − » d'une filière et à la corbeille de la
   * matrice ; elle dit seulement ce que le retrait emporte.
   */
  function demanderRetrait(nom) {
    const groupe = carte.groupes.find((candidat) => candidat.nom === nom);
    const affectes = (groupe?.modules ?? []).filter(
      (module) => module.formateurPresentiel || module.formateurSynchrone
    ).length;

    setGroupeARetirer({ nom, affectes });
  }

  /** « − » : le DERNIER groupe de la filière (le numéro le plus haut — celui qu'un « + » vient de créer). */
  function retirerGroupeDeFiliere(filiere) {
    demanderRetrait(filiere.groupes[filiere.groupes.length - 1]);
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
      {avecAffectations && (
        <BilanCharge
          bilan={carte.bilan}
          statistiques={stats}
          carte={{ groupes: carte.groupes, formateurs: carte.formateurs }}
        />
      )}

      {!lectureSeule && (
        <>
          {avecSelecteurFiliere && (
            <SelecteurFiliere
              onGenerer={genererGroupes}
              enCours={enregistrement.isPending}
              // Le « 1 » n'a de sens que suivi du « 2 » de la liste des formateurs.
              numerote={avecListeFormateurs}
              // L'aperçu du nommage doit reprendre après les groupes déjà créés.
              groupes={carte.groupes}
            />
          )}

          {avecListeFormateurs && (
            <ListeFormateurs
              formateurs={carte.formateurs}
              groupes={carte.groupes}
              onAjouter={carte.ajouterFormateur}
              onRetirer={carte.retirerFormateur}
              onRemplacer={carte.remplacerFormateurs}
            />
          )}
        </>
      )}

      {/* Sous le formulaire : c'est lui qui crée les groupes que ce schéma range. */}
      {avecArbre && (
        <ArbreCarte
          groupes={carte.groupes}
          onAjouterGroupe={lectureSeule ? undefined : ajouterGroupeDeFiliere}
          onRetirerGroupe={lectureSeule ? undefined : retirerGroupeDeFiliere}
          retraitPossible={carte.groupes.length > 1}
          onOuvrirGroupe={onOuvrirGroupe}
        />
      )}

      {avecAffectations && (
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
            /*
             * ⚠️ EN MODE FORMATEUR INVITÉ, LA LISTE C'EST LUI SEUL (2026-09-27,
             * demande du porteur) : « Affectations par formateur » montre
             * l'établissement entier au directeur, mais un partage n'a pas
             * vocation à révéler la charge de ses collègues — seulement la
             * sienne. `VueFormateurs` n'a besoin d'AUCUN autre changement :
             * une fiche unique y applique déjà ses propres règles (case grisée
             * si prise, retrait limité à ses lignes).
             */
            formateurs={
              formateurRestreint
                ? carte.formateurs.filter((f) => f.nom === formateurRestreint.nom)
                : carte.formateurs
            }
            lignesDe={carte.lignesSynchronesDe}
            onAffecter={carte.affecter}
            onDefinirLignes={carte.definirLignesSynchrone}
          />
        ) : (
          <GrilleAffectations
            lectureSeule={lectureSeule}
            formateurRestreint={formateurRestreint}
            groupes={carte.groupes}
            formateurs={carte.formateurs}
            onAffecter={carte.affecter}
            lignesDe={carte.lignesSynchronesDe}
            onDefinirLignes={carte.definirLignesSynchrone}
            salles={salles}
            espacesParNomFormateur={espacesParNomFormateur}
            onDefinirSalles={carte.definirSallesGroupe}
            onActiverModule={activerModule}
            onDefinirMasse={carte.definirMasseHoraire}
            onCopierGroupe={copierGroupe}
            onSupprimer={demanderRetrait}
            onAjouterGroupe={ajouterGroupe}
            onOuverture={onOuverture}
            groupeCible={groupeCible}
          />
        )}
      </div>
      )}

      {/*
        Le bilan d'enregistrement reste à l'écran — le toast disparaît, et c'est
        le seul endroit qui dit ce qui a réellement été écrit en base.
      */}
      {avecAffectations && message && (
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

      {avecAffectations && (
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
      )}

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

      {/*
        ═══ ⚠️ LE REFUS CHIFFRÉ, AVANT TOUTE DESTRUCTION ═══ (2026-09-22)
        Le serveur a REFUSÉ l'enregistrement en 409 sans rien écrire, parce que
        des groupes retirés portent encore une planification. Ce dialogue montre
        ce qui partirait, groupe par groupe — « 955 h de chronogramme, 62
        séances, 9 stagiaires à détacher ». Sans ces nombres, on confirmerait à
        l'aveugle, et la carte est remplacée à chaque enregistrement comme à
        chaque import e-note.
      */}
      <DialogueGroupesRetires
        details={suppressionsAConfirmer}
        explication="Ces groupes ne sont plus dans la carte, mais ils portent encore des données. Enregistrer les supprimera définitivement."
        libelleConfirmation="Supprimer et enregistrer"
        onConfirmer={() => enregistrement.mutate(true)}
        onAnnuler={() => setSuppressionsAConfirmer(null)}
      />

      <ConfirmationAction
        ouvert={Boolean(groupeARetirer)}
        onOpenChange={(ouvert) => !ouvert && setGroupeARetirer(null)}
        titre={groupeARetirer ? `Retirer ${groupeARetirer.nom} ?` : ''}
        description={
          groupeARetirer
            ? groupeARetirer.affectes > 0
              ? `${groupeARetirer.affectes} module(s) de ce groupe ont un formateur : ils seront libérés avec lui.`
              : "Ce groupe n'a aucun formateur affecté. Il sera retiré de la carte."
            : ''
        }
        libelleConfirmation="Retirer le groupe"
        destructive
        onConfirmer={() => {
          supprimerGroupe(groupeARetirer.nom);
          setGroupeARetirer(null);
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

