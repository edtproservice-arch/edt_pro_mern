import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronDown, ChevronUp, GraduationCap, Maximize2, Send } from 'lucide-react';
import {
  droitSuffit,
  libelleAnneeScolaire,
  masseAnnuelle,
  masseHebdomadaire,
  urlDePage,
} from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import Alerte from '@/components/common/Alerte';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { estVersionPerimee } from '@/lib/useBrouillonVersionne';
import { chargerChronogramme, enregistrerChronogramme, renvoyerChronogrammeFormateur } from './api';
import { groupesModifies, reporterSaisie } from './etatPlannings';

/** Reports successifs d'une saisie refusée pour « modifié entre-temps », avant d'abandonner. */
const ESSAIS_REPORT = 3;
import VueFormateur from './VueFormateur';

/**
 * La grille d'un chronogramme, jointe à un message (2026-09-22, demande du porteur : « le
 * formateur doit voir le chronogramme en message, pas dans une autre page » — puis, s'il
 * remplit, « valider va enregistrer pour ce formateur »).
 *
 * ═══ DEUX SENS, LE MÊME INSTANTANÉ ═══
 *   - Le DIRECTEUR envoie (`chronogrammeFormateur.modifiable: true`) : la grille se remplit ICI,
 *     dans le message — plus de renvoi vers « ouvrez la page Chronogramme ». « Valider » écrit
 *     par la route de chaque groupe, EXACTEMENT comme la page le ferait.
 *   - Le FORMATEUR renvoie pour validation (`modifiable` absent) : la grille reste un
 *     INSTANTANÉ, en lecture seule — la preuve de ce qui a été soumis ce jour-là.
 *
 * ⚠️ LE MÊME COMPOSANT DE GRILLE QUE LA PAGE (`VueFormateur`) DANS LES DEUX CAS : c'est lui qui
 * sait déjà répartir les semaines communes et celles fermées par un stage ou une formation — un
 * second rendu ici aurait fini par diverger.
 */
export default function CarteChronogrammeFormateur({ message }) {
  const cache = useQueryClient();
  const grille = message.chronogrammeFormateur;

  // Repliable, mais ouverte d'emblée : c'est justement ce qu'on est venu chercher dans le message.
  const [ouvert, setOuvert] = useState(true);
  const [agrandi, setAgrandi] = useState(false);

  /*
   * ⚠️ MODIFIABLE SEULEMENT CHEZ SON DESTINATAIRE. `message.recu` : dans les « Envoyés », le
   * directeur relit ce qu'il a écrit — il ne saisit pas le chronogramme d'un formateur à sa
   * place, la modale de saisie resterait donc en lecture même sur un message qu'il a envoyé.
   */
  const modifiableIci = Boolean(grille?.modifiable) && message.recu;

  /*
   * ⚠️ LE DROIT SE RELIT EN DIRECT, PAS DEPUIS L'INSTANTANÉ. Il a pu être accordé « en attente »
   * au moment de l'envoi (message.invitation) et accepté depuis — ou l'inverse, retiré. C'est le
   * même crochet que la page Chronogramme, qui applique la même règle serveur.
   */
  const { droitSur } = usePartagesAvecMoi();
  const puisSaisir = modifiableIci && droitSuffit(droitSur('chronogramme'), 'modifier');

  /*
   * ⚠️ UN GROUPE JAMAIS ENREGISTRÉ N'A PAS DE DOCUMENT CHRONOGRAMME, ET L'INSTANTANÉ NE PORTE
   * ALORS AUCUNE CLÉ POUR LUI — pas même `{}` — puisqu'il vient d'un `find()` qui ne rend que ce
   * qui existe déjà. `groupesModifies` ne regarde que les clés de la RÉFÉRENCE : une clé absente
   * n'y est JAMAIS vue comme modifiée, quoi qu'on saisisse. On complète donc la référence avec
   * un planning vide pour CHAQUE groupe que porte la grille — c'est très exactement ce que rend
   * déjà `GET /chronogrammes/:groupe` (un seul groupe) pour ce même cas.
   */
  const reference = () => {
    const depart = { ...(grille?.plannings ?? {}) };
    for (const ligne of grille?.lignes ?? []) {
      if (!(ligne.groupe in depart)) depart[ligne.groupe] = {};
    }
    return depart;
  };

  const [plannings, setPlannings] = useState(reference);
  /*
   * ⚠️ CE QUI EST ENREGISTRÉ AVANCE, LA COMPARAISON LE SUIT — sans quoi « Valider » resterait
   * cliquable pour toujours après un premier enregistrement réussi : `modifies` continuerait de
   * comparer `plannings` à l'instantané D'ORIGINE, jamais à ce qui vient d'être écrit.
   */
  const [baseline, setBaseline] = useState(reference);
  const versions = useRef(grille?.versions ?? {});
  // Distingue « rien à enregistrer d'entrée » de « enregistré » : les deux ont `modifies` vide.
  const [unEnregistrementReussi, setUnEnregistrementReussi] = useState(false);

  const modifies = groupesModifies(plannings, baseline);

  const enregistrement = useMutation({
    /*
     * Les groupes modifiés partent EN PARALLÈLE, comme sur la page Chronogramme : un refus sur
     * l'un n'empêche pas les autres d'être écrits.
     */
    /*
     * ═══ ⚠️ LA GRILLE D'UN MESSAGE EST UN INSTANTANÉ — LA SAISIE SE REPORTE SUR
     * LA VERSION À JOUR (2026-10-09, signalé par le porteur : des formateurs
     * perdaient leur saisie) ═══
     * Plannings et versions datent de l'ENVOI du message. Le directeur l'envoie
     * à tous les formateurs d'un coup, et chacun remplit SES modules des mêmes
     * groupes : dès que le premier avait validé, la version de ces groupes
     * avançait, et « Valider » était refusé à tous les autres — saisie perdue,
     * avec pour seul conseil de tout refaire depuis la page.
     *
     * Sur ce refus, on relit le groupe et on y reporte, case par case, ce que
     * CETTE personne a saisi par rapport à l'instantané (`reporterSaisie`) : les
     * cases des collègues restent les leurs, les siennes passent.
     */
    mutationFn: async () => {
      const issues = await Promise.allSettled(
        modifies.map(async (groupe) => {
          const socleDepart = baseline[groupe] ?? {};
          let socle = socleDepart;
          let envoye = plannings[groupe];
          let version = versions.current[groupe] ?? 0;
          let reponse;
          for (let essai = 0; !reponse; essai += 1) {
            try {
              reponse = await enregistrerChronogramme(groupe, envoye, version);
            } catch (erreur) {
              if (!estVersionPerimee(erreur) || essai >= ESSAIS_REPORT) throw erreur;
              const actuel = await chargerChronogramme(groupe);
              envoye = reporterSaisie(socle, envoye, actuel.planning ?? {}).planning;
              socle = actuel.planning ?? {};
              version = actuel.version ?? 0;
            }
          }
          versions.current = { ...versions.current, [groupe]: reponse.version };
          return { groupe, socle: socleDepart, planning: reponse.planning ?? {} };
        })
      );
      const echec = issues.find((issue) => issue.status === 'rejected');
      if (echec) throw echec.reason;
      return issues.filter((issue) => issue.status === 'fulfilled').map((issue) => issue.value);
    },
    onSuccess: (ecrits) => {
      /*
       * La grille prend ce qui est ENREGISTRÉ — cases des collègues comprises —, en
       * gardant ce qu'on a pu saisir pendant l'envoi. Une case changée des deux
       * côtés garde la valeur enregistrée, et on le dit.
       */
      setPlannings((precedent) => {
        const suivant = { ...precedent };
        for (const { groupe, socle, planning } of ecrits) {
          suivant[groupe] = reporterSaisie(socle, precedent[groupe], planning).planning;
        }
        return suivant;
      });
      setBaseline((precedent) => {
        const suivant = { ...precedent };
        for (const { groupe, planning } of ecrits) suivant[groupe] = planning;
        return suivant;
      });
      setUnEnregistrementReussi(true);
      toast.success('Chronogramme enregistré');
      // Calculés à part de `setPlannings` : son rappel peut être rejoué, la liste serait doublée.
      const enConflit = ecrits.flatMap(({ groupe, socle, planning }) =>
        reporterSaisie(socle, plannings[groupe], planning).conflits.map(
          (c) => `${groupe} · ${c.module} · S${c.semaine}`
        )
      );
      if (enConflit.length > 0) {
        toast.warning('Des cases ont été modifiées par un collègue en même temps', {
          description: `${enConflit.slice(0, 4).join(', ')}${enConflit.length > 4 ? '…' : ''} : sa valeur, déjà enregistrée, a été conservée.`,
        });
      }
      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
    },
    onError: (erreur) => {
      const perime = estVersionPerimee(erreur);
      toast.error(perime ? 'Modifié entre-temps' : 'Enregistrement impossible', {
        description: perime
          ? 'Quelqu’un d’autre a déjà modifié ce groupe : ouvrez « Chronogramme » depuis votre menu pour repartir de la version à jour.'
          : erreur.message,
      });
    },
  });

  const renvoi = useMutation({
    mutationFn: () => renvoyerChronogrammeFormateur(grille.formateur),
    onSuccess: () =>
      toast.success('Chronogramme renvoyé au directeur', {
        description: 'Il l’a reçu dans sa messagerie, avec la grille jointe.',
      }),
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });

  if (!grille) return null;

  const groupesCount = new Set(grille.lignes.map((ligne) => ligne.groupe)).size;
  const annuelle = masseAnnuelle(grille.lignes);
  const nombre = (valeur) => valeur.toLocaleString('fr-FR');

  /*
   * La grille et ses boutons, rendus UNE fois à la fois : dans le message, ou dans la fenêtre
   * plein écran. Deux `VueFormateur` montées ensemble doubleraient ~1 700 nœuds pour rien.
   */
  const grilleEtActions = (hauteur) => (
    <>
      <div className={`${hauteur} overflow-auto`}>
        <VueFormateur
          requete={{ data: grille, isLoading: false, isError: false }}
          plannings={plannings}
          lectureSeule={!puisSaisir}
          onChanger={(nouveaux, motif) => {
            if (nouveaux === null) {
              toast.error('Saisie refusée', { description: motif });
              return;
            }
            setPlannings(nouveaux);
          }}
        />
      </div>

      {puisSaisir && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pb-2 pt-3">
          {unEnregistrementReussi && modifies.length === 0 && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-success">
              <Check className="size-3.5" />
              Enregistré
            </span>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={modifies.length === 0 || enregistrement.isPending}
            onClick={() => enregistrement.mutate()}
          >
            <Check className="size-3.5" />
            {enregistrement.isPending ? 'Enregistrement…' : 'Valider'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={renvoi.isPending}
            onClick={() => renvoi.mutate()}
          >
            <Send className="size-3.5" />
            Renvoyer au directeur
          </Button>
        </div>
      )}
    </>
  );

  const urlChronogramme = (() => {
    const base = urlDePage('chronogramme', 'modifier');
    return base && grille.formateur ? `${base}?formateur=${encodeURIComponent(grille.formateur)}` : base;
  })();

  return (
    <section aria-label="Chronogramme joint" className="mx-4 mb-4 shrink-0 overflow-hidden rounded-lg border">
      {/*
        ⚠️ DEUX ZONES, PAS UN SEUL BOUTON : l'en-tête entier repliait la carte, et un bouton
        ne peut pas en contenir d'autres. Le titre (et le chevron) replient ; « Agrandir » et
        « Ouvrir la page » vivent à côté de la masse horaire (2026-09-23, demande du porteur).
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={() => setOuvert((precedent) => !precedent)}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            Chronogramme de {grille.nom} — {libelleAnneeScolaire(grille.anneeScolaire)}
          </span>
        </button>

        <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {grille.lignes.length} module(s) · {groupesCount} groupe(s)
          </span>
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
            {nombre(annuelle)} h/an · {nombre(masseHebdomadaire(annuelle))} h/sem
          </Badge>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setAgrandi(true)}>
            <Maximize2 className="size-3.5" />
            Agrandir
          </Button>
          {urlChronogramme && (
            <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <Link to={urlChronogramme}>
                Ouvrir la page
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOuvert((precedent) => !precedent)}
            aria-label={ouvert ? 'Replier le chronogramme' : 'Déplier le chronogramme'}
            className="rounded-sm p-0.5 hover:bg-muted"
          >
            {ouvert ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </span>
      </div>

      {ouvert && (
        <div className="space-y-3 border-t p-3">
          {modifiableIci && !puisSaisir && (
            <Alerte type="info" titre="Grille en lecture seule">
              Le directeur vous a retiré le droit de modifier le chronogramme : la grille reste
              consultable, mais plus modifiable.
            </Alerte>
          )}

          {/*
            La grille peut compter 45 colonnes : défilement propre plutôt que de faire déborder
            le message, ou d'imposer sa largeur à toute la boîte de réception.
          */}
          {!agrandi && grilleEtActions('max-h-[28rem]')}
        </div>
      )}

      <Dialog open={agrandi} onOpenChange={setAgrandi}>
        <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-3 p-4 sm:rounded-none">
          <DialogTitle className="pr-8 text-base">
            Chronogramme de {grille.nom} — {libelleAnneeScolaire(grille.anneeScolaire)}
          </DialogTitle>
          <DialogDescription className="sr-only">
            La grille jointe au message, en plein écran.
          </DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col gap-3">{grilleEtActions('min-h-0 flex-1')}</div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
