import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { chargerFicheCompte } from '@/features/consultation/api';
import { Ligne, Section } from './Reglages';

/**
 * Informations supplémentaires du formateur ou du stagiaire (2026-09-29) —
 * matricule, statut, métier, masse horaire statutaire et groupes pour l'un ; CEF, filière, niveau et
 * groupes pour l'autre. Lecture seule : elles viennent des imports e-note et
 * Konosys, et se corrigent là, pas ici.
 */
export default function SectionFiche({ role }) {
  const requete = useQuery({ queryKey: ['fiche-compte'], queryFn: chargerFicheCompte, retry: false });

  const titre = role === ROLES.FORMATEUR ? 'Informations formateur' : 'Informations stagiaire';

  if (requete.isLoading) {
    return (
      <Section titre={titre}>
        <p className="py-4 text-sm text-muted-foreground">Chargement…</p>
      </Section>
    );
  }

  if (requete.isError) {
    return (
      <Section titre={titre}>
        <p className="py-4 text-sm text-muted-foreground">Informations indisponibles pour le moment.</p>
      </Section>
    );
  }

  const fiche = requete.data?.fiche ?? {};
  const lignes = role === ROLES.FORMATEUR ? lignesFormateur(fiche) : lignesStagiaire(fiche);

  return (
    <Section titre={titre}>
      {lignes.map(([libelle, valeur, description]) => (
        <Ligne key={libelle} titre={libelle} valeur={valeur || '—'} description={description} />
      ))}
    </Section>
  );
}

const STATUTS_FORMATEUR = { permanent: 'Permanent', vacataire: 'Vacataire' };

function lignesFormateur(fiche) {
  return [
    ['Matricule', fiche.matricule],
    ['Statut', STATUTS_FORMATEUR[fiche.statut]],
    [
      'Métier',
      fiche.metiers?.[0]?.metier,
      fiche.metiers?.length > 1
        ? `Aussi : ${fiche.metiers
            .slice(1)
            .map((m) => m.metier)
            .join(', ')}`
        : fiche.metiers?.length
          ? 'Déduit des modules qui vous sont affectés.'
          : undefined,
    ],
    ['Masse horaire statutaire', fiche.masseHoraire ? `${fiche.masseHoraire} h` : null],
    [
      'Groupes',
      joindre(fiche.groupes),
      fiche.groupes?.length ? `${fiche.groupes.length} groupe(s) affecté(s) cette année` : undefined,
    ],
  ];
}

function lignesStagiaire(fiche) {
  return [
    ['CEF', fiche.matricule],
    ['Nom et prénom', [fiche.nom, fiche.prenom].filter(Boolean).join(' '), fiche.nomArabe || undefined],
    ['Filière', fiche.filiere],
    ['Niveau', fiche.niveau],
    ['Année de formation', fiche.annee],
    ['Groupe', fiche.groupePrincipal],
    ...(fiche.autresGroupes?.length ? [['Autres groupes', joindre(fiche.autresGroupes)]] : []),
    ...(fiche.site ? [['Site', fiche.site]] : []),
    ...(fiche.dateNaissance ? [['Date de naissance', fiche.dateNaissance]] : []),
  ];
}

function joindre(valeurs) {
  return valeurs?.length ? valeurs.join(', ') : null;
}
