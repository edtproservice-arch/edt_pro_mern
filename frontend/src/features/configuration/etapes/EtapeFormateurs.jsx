import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import FiltreMultiple from '@/components/common/FiltreMultiple';
import {
  chargerBase,
  chargerContraintesFormateurs,
  chargerEtablissementCourant,
  modifierListeFormateurs,
} from '../api';
import AjoutFormateur from './AjoutFormateur';
import { FiltreSalle } from './ContraintesFormateurs';
import FiltreCreneaux from './FiltreCreneaux';
import LigneFormateur from './LigneFormateur';
import {
  BoutonFormateursMutualises,
  FenetreFormateursMutualises,
  useFormateursMutualises,
} from './FormateursMutualises';
import { MODE_INDISPONIBLES, filtrerFormateurs, identifiantFormateur } from './filtresFormateurs';

/**
 * Étape 2 — vérification des formateurs.
 * ← public/setup.html:515-545
 *
 * Les adresses et les masses horaires sont DÉDUITES par l'import : l'adresse
 * depuis le nom, la masse depuis les heures affectées. Elles doivent être
 * relues par le directeur avant de servir — une adresse fausse empêche le
 * formateur de recevoir son mot de passe.
 *
 * ═══ EN LISTE, PAS EN TABLEAU (2026-09-19, demande du porteur) ═══
 * Comme la carte d'affectations et le chronogramme : un bloc par formateur, replié
 * d'office (voir `LigneFormateur`), et de quoi RETROUVER quelqu'un sans faire
 * défiler quarante lignes — recherche, liste à cocher pour en retenir plusieurs à
 * la fois, salle, créneau. Les filtres se cumulent.
 *
 * @param {boolean} [props.lectureSeule]  invité « peut consulter » (Phase 5bis,
 *   étape d3) : les fiches se lisent, champs éteints.
 * ═══ L'AJOUT VIT ICI (2026-09-19, demande du porteur) ═══
 * Il était dans la carte d'affectations, « Formateurs disponibles ». Ajouter,
 * importer d'un classeur et retirer un formateur sont des gestes de cette page ;
 * ils écrivent DIRECTEMENT dans la base (`modifierListeFormateurs`), sans passer
 * par la carte — un formateur qu'aucun module ne nomme n'existerait pas pour elle.
 *
 * @param {boolean} [props.avecAjout]  page Paramètres → Formateurs : le formulaire
 *   d'ajout, l'import Excel et le retrait. L'assistant de configuration, lui,
 *   construit sa liste dans la carte (étape 1) et ici ne fait que la relire.
 * @param {boolean} [props.avecContraintes]  page Paramètres → Formateurs : ajoute
 *   la disponibilité et les salles attribuées (2026-09-17), donc les filtres qui
 *   s'y rapportent. L'assistant de configuration ne les montre pas — les salles
 *   n'y sont saisies qu'après.
 */
export default function EtapeFormateurs({
  onModification,
  lectureSeule = false,
  avecContraintes = false,
  avecAjout = false,
}) {
  const cache = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['base'], queryFn: chargerBase, retry: false });
  const contraintes = useQuery({
    queryKey: ['base', 'contraintes'],
    queryFn: chargerContraintesFormateurs,
    enabled: avecContraintes,
    retry: false,
  });
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    enabled: avecContraintes,
    retry: false,
  });
  // Les formateurs affectés dans plusieurs établissements : détectés par le serveur (2026-09-21).
  const mutualises = useFormateursMutualises(avecContraintes);
  const [schemaMutualises, setSchemaMutualises] = useState(false);
  const [corrections, setCorrections] = useState({});
  const [ouverts, setOuverts] = useState(() => new Set());

  const [recherche, setRecherche] = useState('');
  const [retenus, setRetenus] = useState([]);
  const [filtreSalle, setFiltreSalle] = useState('');
  const [creneaux, setCreneaux] = useState([]);
  const [modeCreneaux, setModeCreneaux] = useState(MODE_INDISPONIBLES);

  const salles = etablissement.data?.etablissement?.espaces ?? [];
  const parFormateur = useMemo(
    () => new Map((contraintes.data?.contraintes ?? []).map((entree) => [entree.formateur, entree])),
    [contraintes.data]
  );

  const tous = useMemo(() => data?.base?.formateurs ?? [], [data]);

  const formateurs = useMemo(
    () =>
      filtrerFormateurs(
        tous,
        { recherche, retenus, salle: filtreSalle, creneaux, modeCreneaux },
        (formateur) => parFormateur.get(identifiantFormateur(formateur))
      ),
    [tous, recherche, retenus, filtreSalle, creneaux, modeCreneaux, parFormateur]
  );

  /*
   * La liste à la forme de la CARTE (`nom`, pas `nomComplet`) : c'est celle que
   * `fusionnerFormateurs` manipule, et le doublon se juge dessus.
   */
  const formateursCarte = useMemo(
    () =>
      tous.map((f) => ({
        nom: f.nomComplet,
        matricule: f.matricule ?? '',
        email: f.email ?? '',
        masseHoraire: f.masseHoraire ?? 0,
      })),
    [tous]
  );

  /*
   * Ce que porte chaque formateur : l'affectation le désigne par son matricule, à
   * défaut par son nom (`base.affectations[].formateur`). Sert à PROTÉGER de
   * l'import « remplacer » ceux qui enseignent encore, et à dire ce que libérerait
   * un retrait.
   */
  const affectationsParNom = useMemo(() => {
    const parIdentifiant = new Map();
    for (const affectation of data?.base?.affectations ?? []) {
      const cle = String(affectation.formateur ?? '').trim().toUpperCase();
      parIdentifiant.set(cle, (parIdentifiant.get(cle) ?? 0) + 1);
    }

    const parNom = new Map();
    for (const f of tous) {
      const matricule = String(f.matricule ?? '').trim().toUpperCase();
      const nombre = parIdentifiant.get(matricule || f.nomComplet.trim().toUpperCase()) ?? 0;
      if (nombre > 0) parNom.set(f.nomComplet, nombre);
    }
    return parNom;
  }, [data, tous]);

  const proteges = useMemo(() => [...affectationsParNom.keys()], [affectationsParNom]);

  /*
   * ⚠️ UNE CORRECTION EN ATTENTE SUR UN FORMATEUR RETIRÉ EST ABANDONNÉE : le serveur
   * refuse en bloc un lot qui nomme un inconnu (FORMATEUR_INCONNU), et ce refus
   * emporterait aussi les corrections des autres.
   */
  const oublierCorrections = (noms) =>
    setCorrections((precedentes) => {
      if (!noms.some((nom) => nom in precedentes)) return precedentes;
      const suivantes = { ...precedentes };
      for (const nom of noms) delete suivantes[nom];
      return suivantes;
    });

  const ecriture = useMutation({
    mutationFn: modifierListeFormateurs,
    onSuccess: () => cache.invalidateQueries({ queryKey: ['base'] }),
    onError: (erreur) =>
      toast.error('Enregistrement impossible', { description: erreur.message }),
  });

  const [aRetirer, setARetirer] = useState(null);

  const ajouterFormateur = async (formateur) => {
    await ecriture.mutateAsync({ ajouter: [formateur] });

    toast.success(`${formateur.nom} ajouté`, {
      description: formateur.masseHoraire
        ? `${formateur.masseHoraire} h statutaires`
        : 'Masse horaire non renseignée',
    });

    // Un filtre resté actif le cacherait : on ajoute pour le voir dans la liste.
    setRecherche('');
    setRetenus([]);
    setFiltreSalle('');
    setCreneaux([]);
  };

  const importerFormateurs = async ({ resultat, lus }) => {
    await ecriture.mutateAsync({
      ajouter: lus.map((lu) => ({
        nom: lu.nom,
        matricule: lu.matricule ?? '',
        email: lu.email ?? '',
        masseHoraire: Number(lu.masseHoraire) || 0,
      })),
      retirer: resultat.retires,
    });
    oublierCorrections(resultat.retires);
  };

  const retirerFormateur = async () => {
    const { nomComplet } = aRetirer;
    setARetirer(null);

    const bilan = await ecriture.mutateAsync({ retirer: [nomComplet] }).catch(() => null);
    if (!bilan) return;

    oublierCorrections([nomComplet]);
    setOuverts((precedents) => {
      const suivants = new Set(precedents);
      suivants.delete(nomComplet);
      return suivants;
    });
    toast.success(`${nomComplet} retiré`, {
      description:
        bilan.affectationsLiberees > 0
          ? `${bilan.affectationsLiberees} affectation(s) libérée(s) sur la carte.`
          : undefined,
    });
  };

  const options = useMemo(
    () => tous.map((f) => ({ valeur: f.nomComplet, libelle: f.nomComplet, detail: f.matricule || undefined })),
    [tous]
  );

  const filtresActifs =
    recherche.trim() !== '' || retenus.length > 0 || filtreSalle !== '' || creneaux.length > 0;

  const toutEffacer = () => {
    setRecherche('');
    setRetenus([]);
    setFiltreSalle('');
    setCreneaux([]);
  };

  useEffect(() => {
    onModification?.(corrections);
  }, [corrections, onModification]);

  if (isLoading) {
    return <div className="flex justify-center py-3"><IndicateurChargement /></div>;
  }

  if (tous.length === 0) {
    // Sur la page Paramètres, une liste vide est l'endroit où l'on COMMENCE : le
    // formulaire d'ajout reste là, au lieu d'un renvoi vers une autre étape.
    if (avecAjout && !lectureSeule) {
      return (
        <div className="space-y-4">
          <Alerte type="info" titre="Aucun formateur">
            Ajoutez-les un par un, ou importez un classeur Excel.
          </Alerte>
          <AjoutFormateur
            formateurs={formateursCarte}
            proteges={proteges}
            enCours={ecriture.isPending}
            onAjouter={ajouterFormateur}
            onImport={importerFormateurs}
          />
        </div>
      );
    }

    return (
      <Alerte type="info" titre="Aucun formateur">
        {avecAjout
          ? 'Aucun formateur n’a encore été ajouté.'
          : 'Importez d’abord votre base e-note à l’étape précédente.'}
      </Alerte>
    );
  }

  const valeur = (matricule, champ, defaut) =>
    corrections[matricule]?.[champ] ?? defaut ?? '';

  const corriger = (matricule, champ, nouvelle) =>
    setCorrections((precedentes) => ({
      ...precedentes,
      [matricule]: { ...precedentes[matricule], [champ]: nouvelle },
    }));

  const basculer = (cle) =>
    setOuverts((precedents) => {
      const suivants = new Set(precedents);
      if (suivants.has(cle)) suivants.delete(cle);
      else suivants.add(cle);
      return suivants;
    });

  const toutOuvert = formateurs.length > 0 && formateurs.every((f) => ouverts.has(f.nomComplet));

  const sansMatricule = tous.filter((f) => !String(f.matricule).trim()).length;
  const masseNulle = tous.filter((f) => !f.masseHoraire).length;

  return (
    <div className="space-y-6">
      {avecAjout && !lectureSeule && (
        <AjoutFormateur
          formateurs={formateursCarte}
          proteges={proteges}
          enCours={ecriture.isPending}
          onAjouter={ajouterFormateur}
          onImport={importerFormateurs}
        />
      )}

      {sansMatricule > 0 && (
        <Alerte type="info" titre={`${sansMatricule} formateur(s) sans matricule`}>
          Ils seront identifiés par leur nom. Un matricule est plus stable d&apos;un import à
          l&apos;autre — renseignez-le si vous le connaissez.
        </Alerte>
      )}

      {masseNulle > 0 && (
        <Alerte type="info" titre={`${masseNulle} masse(s) horaire(s) à zéro`}>
          Une masse nulle empêche le calcul du taux de charge de ce formateur.
        </Alerte>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, matricule ou e-mail…"
            aria-label="Rechercher un formateur"
            className="h-8 pl-8"
          />
        </div>

        <FiltreMultiple
          invite="Tous les formateurs"
          pluriel="formateurs"
          recherche="Rechercher dans la liste…"
          vide="Aucun formateur ne correspond."
          options={options}
          selection={retenus}
          onChange={setRetenus}
        />

        {avecContraintes && (
          <>
            <FiltreSalle salles={salles} valeur={filtreSalle} onChange={setFiltreSalle} />
            <FiltreCreneaux
              selection={creneaux}
              mode={modeCreneaux}
              onChange={setCreneaux}
              onModeChange={setModeCreneaux}
            />
          </>
        )}

        {filtresActifs && (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={toutEffacer}>
            <X className="size-3.5" />
            Effacer les filtres
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
        <BoutonFormateursMutualises
          nombre={mutualises.liste.length}
          onClick={() => setSchemaMutualises(true)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={formateurs.length === 0}
          onClick={() =>
            setOuverts((precedents) => {
              const suivants = new Set(precedents);
              for (const f of formateurs) {
                if (toutOuvert) suivants.delete(f.nomComplet);
                else suivants.add(f.nomComplet);
              }
              return suivants;
            })
          }
        >
          {toutOuvert ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
          {toutOuvert ? 'Tout replier' : 'Tout déplier'}
        </Button>
        </div>
      </div>

      {formateurs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun formateur ne correspond à ces filtres.
        </p>
      ) : (
        <div className="space-y-2">
          {formateurs.map((formateur) => (
            <LigneFormateur
              key={formateur.nomComplet}
              formateur={formateur}
              ouvert={ouverts.has(formateur.nomComplet)}
              onBasculer={() => basculer(formateur.nomComplet)}
              valeur={valeur}
              corriger={corriger}
              lectureSeule={lectureSeule}
              avecContraintes={avecContraintes}
              contraintes={parFormateur.get(identifiantFormateur(formateur))}
              salles={salles}
              onRetirer={avecAjout ? () => setARetirer(formateur) : undefined}
              mutualise={mutualises.parMatricule.get(String(formateur.matricule ?? '').trim())}
            />
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {filtresActifs ? `${formateurs.length} sur ${tous.length}` : tous.length} formateur(s). Les
        corrections sont enregistrées en passant à l&apos;étape suivante.
      </p>

      {schemaMutualises && (
        <FenetreFormateursMutualises
          formateurs={mutualises.liste}
          erreur={mutualises.erreur}
          onFermer={() => setSchemaMutualises(false)}
        />
      )}

      <ConfirmationAction
        ouvert={Boolean(aRetirer)}
        onOpenChange={(ouvert) => !ouvert && setARetirer(null)}
        titre={aRetirer ? `Retirer ${aRetirer.nomComplet} ?` : ''}
        description={
          aRetirer
            ? affectationsParNom.has(aRetirer.nomComplet)
              ? `${affectationsParNom.get(aRetirer.nomComplet)} affectation(s) de la carte seront libérées : ses modules redeviendront sans formateur.`
              : "Il ne porte aucune affectation : rien d'autre n'est modifié."
            : ''
        }
        libelleConfirmation="Retirer"
        destructive
        onConfirmer={retirerFormateur}
      />
    </div>
  );
}
