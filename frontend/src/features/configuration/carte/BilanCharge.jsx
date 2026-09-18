import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Alerte from '@/components/common/Alerte';
import BilanDetail from './BilanDetail';
import { exporterBilan } from '../api';
import { cn } from '@/lib/utils';

/**
 * Tuiles « Offre » et « Demande », et leur détail par métier.
 * ← `#aff-stat-offre-card` / `#aff-stat-demande-card` de affectation-carte.html:66-80
 *
 * Ces deux chiffres répondent à deux questions différentes, et c'est pour cela
 * qu'ils sont côte à côte :
 *   OFFRE   — mes formateurs sont-ils assez chargés, ou trop ?
 *   DEMANDE — mes groupes auront-ils bien tous leurs cours ?
 *
 * Une carte peut être équilibrée sur l'une et pas sur l'autre : un
 * établissement qui manque de formateurs de français couvre 90 % de sa demande
 * tout en saturant deux personnes.
 */
export default function BilanCharge({ bilan, statistiques, carte }) {
  const [detail, setDetail] = useState(null);
  const [export_, setExport] = useState(false);

  /*
   * L'export part de la carte À L'ÉCRAN, pas de la base : elle n'est pas encore
   * enregistrée, et c'est bien l'état courant qu'on veut emporter — même choix
   * que `exportBilanExcel()`, qui exportait ce qui était affiché.
   */
  const exporter = async () => {
    setExport(true);
    try {
      const resume = await exporterBilan(carte);
      toast.success('Export réalisé', {
        description: resume
          ? `${resume.metiers} métier(s), ${resume.modulesNonCouverts} module(s) non couvert(s), ${resume.sousAffectes} formateur(s) sous-affecté(s).`
          : undefined,
      });
    } catch (erreur) {
      toast.error("L'export n'a pas abouti", { description: erreur.message });
    } finally {
      setExport(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Chiffre valeur={statistiques.filieres} libelle="Filières" />
        <Chiffre valeur={statistiques.groupes} libelle="Groupes" />
        <Chiffre valeur={statistiques.modules} libelle="Modules" />
        <Chiffre valeur={statistiques.formateursAffectes} libelle="Formateurs affectés" />
        <Chiffre valeur={statistiques.synchrones} libelle="Affect. synchrones" />
        <Chiffre
          valeur={statistiques.nonAffectes}
          libelle="Modules non affectés"
          alerte={statistiques.nonAffectes > 0}
        />

        {/*
          Chaque tuile ouvre la MÊME modale mais sur SA section — l'existant
          faisait déjà ce choix (openBilanModal('offre'|'demande')) : on arrive
          sur ce qu'on a cliqué, sans perdre le reste, qui est à un défilement.
        */}
        <Jauge
          libelle="Offre · affecté / statutaire"
          valeur={`${h(bilan.offre.affecte)} / ${h(bilan.offre.statutaire)}`}
          taux={bilan.offre.taux}
          aide={`Capacité statutaire des formateurs : ${h(bilan.offre.statutaire)} — affecté : ${h(bilan.offre.affecte)} (${bilan.offre.taux} %).`}
          onClick={() => setDetail('offre')}
        />
        <Jauge
          libelle="Demande · couvert / total"
          valeur={`${h(bilan.demande.couvert)} / ${h(bilan.demande.total)}`}
          taux={bilan.demande.taux}
          aide={`Heures à dispenser aux groupes : ${h(bilan.demande.total)} — couvert : ${h(bilan.demande.couvert)} (${bilan.demande.taux} %).`}
          onClick={() => setDetail('demande')}
        />
      </div>

      {bilan.surcharges.length > 0 && (
        <Alerte type="erreur" titre={`${bilan.surcharges.length} formateur(s) en dépassement`}>
          {bilan.surcharges
            .slice(0, 4)
            .map((f) => `${f.nom} (+${h(-f.disponible)})`)
            .join(', ')}
          {bilan.surcharges.length > 4 && '…'} — au-delà de leur masse statutaire.
        </Alerte>
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(ouvert) => !ouvert && setDetail(null)}>
        <DialogContent className="max-h-[88vh] max-w-[95vw] overflow-y-auto overflow-x-hidden sm:max-w-5xl lg:max-w-6xl">
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Masse horaire
            </p>
            <DialogTitle>Besoin &amp; demande par métier</DialogTitle>
            {/*
              Le résumé de l'existant, repris mot pour mot : ce sont les trois
              chiffres qu'on vient chercher, avant même de lire un tableau.
            */}
            <DialogDescription className="leading-relaxed">
              Besoin restant : <strong className="text-foreground">{h(bilan.besoin)}</strong> sur{' '}
              {h(bilan.demande.total)} de demande ({bilan.besoinTaux} % non couvert) · Offre :{' '}
              <strong className="text-foreground">{h(bilan.offre.affecte)}</strong> affectées sur{' '}
              {h(bilan.offre.statutaire)} statutaires ({bilan.offre.taux} %) ·{' '}
              <strong className="text-foreground">{h(bilan.reconciliation.disponible)}</strong>{' '}
              encore disponibles chez {bilan.sousAffectes.length} formateur(s)
            </DialogDescription>
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={exporter}
                // Un classeur de six feuilles vides n'apprend rien, et la route
                // exige au moins un groupe.
                disabled={export_ || carte.groupes.length === 0}
                title={
                  carte.groupes.length === 0
                    ? 'Générez au moins un groupe pour pouvoir exporter.'
                    : undefined
                }
                className="gap-2"
              >
                {export_ ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4 text-success" />
                )}
                Exporter en Excel
              </Button>
            </div>
          </DialogHeader>

          <BilanDetail bilan={bilan} section={detail} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Chiffre({ valeur, libelle, alerte = false }) {
  return (
    <div className="rounded-lg border p-3">
      <div className={cn('text-xl font-semibold', alerte && 'text-warning')}>{valeur}</div>
      <div className="text-xs text-muted-foreground">{libelle}</div>
    </div>
  );
}

function Jauge({ libelle, valeur, taux, aide, onClick }) {
  const depasse = taux > 100;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${aide} Cliquer pour le détail.`}
      className="rounded-lg border p-3 text-left transition-colors hover:bg-muted"
    >
      <div className="text-base font-semibold">{valeur}</div>
      <div className="text-xs text-muted-foreground">{libelle}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', depasse ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${Math.min(100, Math.max(0, taux))}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{taux} %</div>
    </button>
  );
}

/** Heures, avec le séparateur de milliers français. */
function h(valeur) {
  return `${Number(valeur).toLocaleString('fr-FR')} h`;
}
