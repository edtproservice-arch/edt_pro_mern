import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Alerte from '@/components/common/Alerte';
import { chargerBase, chargerContraintesFormateurs, chargerEtablissementCourant } from '../api';
import { ColonneContraintes, FiltreSalle, identifiantFormateur, peutUtiliser } from './ContraintesFormateurs';

/**
 * Étape 2 — vérification des formateurs.
 * ← public/setup.html:515-545
 *
 * Les adresses et les masses horaires sont DÉDUITES par l'import : l'adresse
 * depuis le nom, la masse depuis les heures affectées. Elles doivent être
 * relues par le directeur avant de servir — une adresse fausse empêche le
 * formateur de recevoir son mot de passe.
 */
/**
 * @param {boolean} [props.lectureSeule]  invité « peut consulter » (Phase 5bis,
 *   étape d3) : les fiches se lisent, champs éteints.
 */
/**
 * @param {boolean} [props.avecContraintes]  page Paramètres → Formateurs : ajoute
 *   la disponibilité et les salles attribuées (2026-09-17). L'assistant de
 *   configuration ne les montre pas — les salles n'y sont saisies qu'après.
 */
export default function EtapeFormateurs({ onModification, lectureSeule = false, avecContraintes = false }) {
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
  const [corrections, setCorrections] = useState({});
  const [filtreSalle, setFiltreSalle] = useState('');

  const salles = etablissement.data?.etablissement?.espaces ?? [];
  const parFormateur = new Map(
    (contraintes.data?.contraintes ?? []).map((entree) => [entree.formateur, entree])
  );

  const tous = data?.base?.formateurs ?? [];
  const formateurs = filtreSalle
    ? tous.filter((f) => peutUtiliser(parFormateur.get(identifiantFormateur(f)), filtreSalle))
    : tous;

  useEffect(() => {
    onModification?.(corrections);
  }, [corrections, onModification]);

  if (isLoading) {
    return <div className="flex justify-center py-3"><IndicateurChargement /></div>;
  }

  if (tous.length === 0) {
    return (
      <Alerte type="info" titre="Aucun formateur">
        Importez d&apos;abord votre base e-note à l&apos;étape précédente.
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

  const sansMatricule = tous.filter((f) => !String(f.matricule).trim()).length;
  const masseNulle = tous.filter((f) => !f.masseHoraire).length;

  return (
    <div className="space-y-6">
      {/* <Alerte type="info" titre="Vérifiez les informations des formateurs">
        Les adresses et les masses horaires ont été déduites du fichier. Corrigez-les si besoin.
      </Alerte> */}

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

      {avecContraintes && (
        <FiltreSalle salles={salles} valeur={filtreSalle} onChange={setFiltreSalle} />
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead>Formateur</TableHead>
              <TableHead className="w-[140px]">Matricule</TableHead>
              <TableHead>Adresse e-mail</TableHead>
              <TableHead className="w-[130px] text-right">Masse horaire</TableHead>
              {avecContraintes && <TableHead className="w-[220px]">Disponibilité et salles</TableHead>}
            </TableRow>
          </TableHeader>

          <TableBody>
            {formateurs.map((formateur) => (
              <TableRow key={formateur.nomComplet}>
                <TableCell>
                  <div className="font-medium">{formateur.nomComplet}</div>
                  {formateur.nomUnique !== formateur.nomComplet && (
                    <Badge variant="outline" className="mt-1 font-normal">
                      affiché : {formateur.nomUnique}
                    </Badge>
                  )}
                </TableCell>

                <TableCell>
                  <Input
                    value={valeur(formateur.nomComplet, 'matricule', formateur.matricule)}
                    onChange={(e) => corriger(formateur.nomComplet, 'matricule', e.target.value)}
                    placeholder="—"
                    disabled={lectureSeule}
                  />
                </TableCell>

                <TableCell>
                  <Input
                    type="email"
                    value={valeur(formateur.nomComplet, 'email', formateur.email)}
                    onChange={(e) => corriger(formateur.nomComplet, 'email', e.target.value)}
                    placeholder="prenom.nom@ofppt.ma"
                    disabled={lectureSeule}
                  />
                </TableCell>

                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    max={2000}
                    className="text-right"
                    disabled={lectureSeule}
                    value={valeur(formateur.nomComplet, 'masseHoraire', formateur.masseHoraire)}
                    onChange={(e) =>
                      corriger(formateur.nomComplet, 'masseHoraire', e.target.value)
                    }
                  />
                </TableCell>

                {avecContraintes && (
                  <TableCell>
                    <ColonneContraintes
                      formateur={formateur}
                      contraintes={parFormateur.get(identifiantFormateur(formateur))}
                      salles={salles}
                      lectureSeule={lectureSeule}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtreSalle ? `${formateurs.length} sur ${tous.length}` : tous.length} formateur(s). Les corrections sont enregistrées en passant à
        l&apos;étape suivante.
      </p>
    </div>
  );
}
