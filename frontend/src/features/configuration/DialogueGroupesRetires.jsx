import ConfirmationAction from '@/components/common/ConfirmationAction';

/**
 * « Ces groupes vont disparaître, avec ce qu'ils portent » — la question posée
 * sur un 409 `GROUPES_ENCORE_UTILISES`.
 *
 * ⚠️ UNE SEULE BOÎTE POUR LES DEUX GESTES qui remplacent la base : enregistrer
 * la carte, et importer un fichier e-note (2026-10-01). Deux formulations
 * finiraient par dire deux choses différentes de la même cascade.
 *
 * @param {Array|null} details  le `details` du 409 — `null` ferme la boîte
 * @param {string} explication  la phrase propre au geste (carte ou import)
 * @param {string} libelleConfirmation
 */
export default function DialogueGroupesRetires({
  details,
  explication,
  libelleConfirmation,
  onConfirmer,
  onAnnuler,
}) {
  return (
    <ConfirmationAction
      ouvert={Boolean(details)}
      onOpenChange={(ouvert) => !ouvert && onAnnuler()}
      titre={
        details?.length === 1
          ? `Retirer ${details[0].groupe} supprimera son contenu`
          : `Retirer ${details?.length ?? 0} groupes supprimera leur contenu`
      }
      description={
        <span className="block space-y-2">
          <span className="block">{explication}</span>
          <span className="block space-y-1">
            {(details ?? []).map((detail) => (
              <span key={detail.groupe} className="block text-xs">
                <strong>{detail.groupe}</strong> —{' '}
                {[
                  detail.heuresPlanifiees > 0 && `${detail.heuresPlanifiees} h de chronogramme`,
                  detail.chronogramme > 0 && !(detail.heuresPlanifiees > 0) && 'chronogramme vide',
                  detail.seances > 0 && `${detail.seances} séance(s)`,
                  detail.stagiairesADetacher > 0 &&
                    `${detail.stagiairesADetacher} stagiaire(s) à détacher`,
                  detail.stages > 0 && `${detail.stages} stage(s)`,
                  detail.liensFq > 0 && `${detail.liensFq} lien(s) FQ`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ))}
          </span>
          {/*
            ⚠️ CE QUI SURVIT COMPTE AUTANT : sans cette phrase, un directeur
            renoncerait de peur d'effacer l'historique disciplinaire de ses
            stagiaires — qui, lui, ne bouge pas.
          */}
          <span className="block text-xs">
            Les stagiaires sont <strong>détachés, jamais supprimés</strong>, et leurs absences
            sont conservées.
          </span>
        </span>
      }
      libelleConfirmation={libelleConfirmation}
      destructive
      onConfirmer={onConfirmer}
    />
  );
}
