import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { rapportAvancement } from 'shared/domain';
import BoutonTelecharger from '@/components/common/BoutonTelecharger';
import { exporterRapportAvancement } from './api';

/**
 * ═══ LE RAPPORT D'AVANCEMENT (2026-10-17, demande du porteur : « un rapport
 * d'avancement selon formateur / groupe filtré, qui contient un graphe bâtonné
 * et un tableau ») ═══
 *
 * Un bouton « Télécharger » — Word, PDF ou Excel — et RIEN D'AUTRE À CHOISIR
 * (2026-10-17, le porteur : « annule le modal, laisse seulement le bouton
 * télécharger ») : le rapport est celui de la VUE AFFICHÉE. Une page par sujet,
 * son graphe et son tableau, mis en page par le serveur
 * (`exportRapportAvancement.js`).
 *
 * Les autres filtres de la page (niveau, semestre…), la face et la date
 * observée s'appliquent.
 */
export default function RapportAvancement({ brutes, filtres, axe, visibles, face, dateObservee, intitules, intitulesParGroupe }) {
  const { type, sujets } = sujetsDuRapport({ filtres, axe, visibles });

  const telechargement = useMutation({
    mutationFn: (format) =>
      exporterRapportAvancement({
        format,
        type,
        face,
        dateObservee,
        rapports: sujets.map((sujet) => rapportAvancement(brutes, { type, sujet, filtres, intitules, intitulesParGroupe })),
      }),
    onError: (erreur) => toast.error('Rapport impossible', { description: erreur.message }),
  });

  const titre =
    sujets.length === 0
      ? 'Filtrez sur un formateur ou un groupe — ou passez à la vue par formateur ou par groupe — pour obtenir son rapport'
      : `Rapport d’avancement de ${sujets.length} ${type}${sujets.length > 1 ? 's' : ''} : ${sujets.slice(0, 3).join(', ')}${
          sujets.length > 3 ? '…' : ''
        }`;

  return (
    <BoutonTelecharger
      libelle="Télécharger"
      formats={['docx', 'pdf', 'xlsx']}
      disabled={sujets.length === 0 || brutes.length === 0}
      enCours={telechargement.isPending}
      onChoisir={(format) => telechargement.mutate(format)}
      title={titre}
      aria-label={titre}
    />
  );
}

/**
 * Les sujets du rapport, d'après ce que la page affiche :
 *   1. les formateurs du filtre, s'il en retient ;
 *   2. sinon les groupes du filtre ;
 *   3. sinon les bâtons affichés, en vue « par formateur » ou « par groupe ».
 * Vue « par module » sans filtre : rien ne désigne un sujet — aucun.
 */
function sujetsDuRapport({ filtres, axe, visibles }) {
  if ((filtres.formateur?.length ?? 0) > 0) return { type: 'formateur', sujets: filtres.formateur };
  if ((filtres.groupe?.length ?? 0) > 0) return { type: 'groupe', sujets: filtres.groupe };
  if (axe === 'formateur' || axe === 'groupe') {
    return { type: axe, sujets: [...new Set(visibles.map((ligne) => ligne.sujet))] };
  }
  return { type: null, sujets: [] };
}
