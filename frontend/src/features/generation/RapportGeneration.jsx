import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  CircleSlash,
  Info,
  Telescope,
} from 'lucide-react';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { MOTEURS, MOTIFS_IGNOREE, REPLIS_MOTEUR } from 'shared/constants';
import { libelleSemaine } from 'shared/domain';

import Alerte from '@/components/common/Alerte';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { simuler } from './api';
import { assouplissementsUtiles, libelleCause, libelleRepli, remedeCause } from './causes';
import { causesRencontrees, semainesIncompletes } from './selectionSemaines';

/**
 * Ce que la génération a fait, et ce qu'elle n'a pas pu faire.
 *
 * ← la fenêtre de résolution des séances non placées de emploi.html, dont les
 * trois boutons d'assouplissement sont repris.
 *
 * ⚠️ LE RAPPORT RESTE À L'ÉCRAN, il ne part pas en toast. Ces chiffres se
 *    recoupent avec la grille, et l'on y revient plusieurs fois — c'est la
 *    règle déjà tenue pour les bilans d'import et de création de comptes.
 */

const Chiffre = ({ valeur, libelle, ton = 'neutre' }) => (
  <div className="rounded-md border bg-card px-3 py-2">
    <p
      className={
        ton === 'succes'
          ? 'text-lg font-semibold tabular-nums text-success'
          : ton === 'alerte'
            ? 'text-lg font-semibold tabular-nums text-warning'
            : 'text-lg font-semibold tabular-nums'
      }
    >
      {valeur}
    </p>
    <p className="text-xs text-muted-foreground">{libelle}</p>
  </div>
);

function LigneSemaine({ semaine }) {
  if (semaine.echec) {
    return (
      <li className="flex items-start gap-2 py-1.5 text-xs">
        <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <span>
          <strong>{libelleSemaine(semaine.semaine, { court: true })}</strong> — {semaine.message}
        </span>
      </li>
    );
  }

  if (semaine.figee) {
    // ⚠️ FIGÉE (2026-10-03) : vacances ou fériés partout — rien n'a été touché,
    //    pas même les séances saisies à la main.
    return (
      <li className="flex items-start gap-2 py-1.5 text-xs text-muted-foreground">
        <CalendarOff className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <strong>{libelleSemaine(semaine.semaine, { court: true })}</strong> — semaine figée (
          {semaine.motif === 'vacances' ? 'vacances' : 'fériés'}) : non générée
        </span>
      </li>
    );
  }

  if (semaine.fermee) {
    /*
     * ═══ ⚠️ FERMÉE N'EST PAS VIDE, ET LA DIFFÉRENCE EST TOUT LE MESSAGE ═══
     * « Vide » : le chronogramme ne prévoit rien, tout va bien. « Fermée » :
     * il prévoit des heures que l'établissement ne peut PAS assurer, parce que
     * la semaine entière est fériée ou en vacances. Mesuré sur l'année réelle,
     * c'est **la plus grosse perte de l'année** — 154 séances sur une seule
     * semaine — et elle se corrige dans le calendrier, jamais en relançant.
     */
    return (
      <li className="flex items-start gap-2 py-1.5 text-xs">
        <CalendarOff className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>
          <strong>{libelleSemaine(semaine.semaine, { court: true })}</strong> — semaine entièrement fermée
          {semaine.demandees > 0 && (
            <>
              {' '}
              alors que le chronogramme y prévoit{' '}
              <strong>{semaine.demandees} séance(s)</strong>. Corrigez le calendrier ou
              décalez ces heures.
            </>
          )}
        </span>
      </li>
    );
  }

  if (semaine.vide) {
    return (
      <li className="flex items-start gap-2 py-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <strong>{libelleSemaine(semaine.semaine, { court: true })}</strong> — rien de prévu au chronogramme
        </span>
      </li>
    );
  }

  const incomplet = (semaine.nonPlacees?.length ?? 0) > 0;
  /*
   * ⚠️ « AMÉLIORÉE » SE LIT SUR LE MOTEUR QUI A PRODUIT LA GRILLE, pas sur
   *    celui qui a été demandé : `choix.py` ne retient CP-SAT que s'il place
   *    STRICTEMENT plus. Le rapport dit donc ce qui s'est passé, pas ce qui
   *    avait été tenté.
   */
  const amelioree = semaine.rapport?.moteur === MOTEURS.CPSAT;
  const repli = amelioree ? null : libelleRepli(semaine.rapport?.repli);

  return (
    <li className="flex items-start gap-2 py-1.5 text-xs">
      {incomplet ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
      )}
      <span className="min-w-0">
        <strong>{libelleSemaine(semaine.semaine, { court: true })}</strong> — {semaine.placees} séance(s) posée(s)
        {semaine.demandees ? ` sur ${semaine.demandees}` : ''}
        {semaine.remplacees > 0 && (
          <span className="text-muted-foreground"> · {semaine.remplacees} remplacée(s)</span>
        )}
        {semaine.preservees > 0 && (
          <span className="text-muted-foreground">
            {' '}
            · {semaine.preservees} préservée(s)
          </span>
        )}
        {semaine.deconseillees > 0 && (
          <span className="text-warning">
            {' '}
            · {semaine.deconseillees} sur une indisponibilité
          </span>
        )}
        {semaine.horsSalle > 0 && (
          <span className="text-warning">
            {' '}
            · {semaine.horsSalle} hors de leur salle
          </span>
        )}
        {amelioree && (
          <span className="text-muted-foreground"> · améliorée par la recherche</span>
        )}
        {repli && <span className="text-muted-foreground"> · {repli}</span>}
      </span>
    </li>
  );
}

/** Les séances non placées, réunies par cause : c'est la cause qui appelle une action. */
function ParCause({ rapport }) {
  const parCause = new Map();

  for (const semaine of rapport.semaines ?? []) {
    for (const non of semaine.nonPlacees ?? []) {
      const liste = parCause.get(non.cause) ?? [];
      liste.push({ ...non, semaine: semaine.semaine });
      parCause.set(non.cause, liste);
    }
  }

  if (parCause.size === 0) return null;

  return (
    <div className="space-y-3">
      {[...parCause.entries()].map(([cause, lignes]) => (
        <div key={cause} className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-xs font-semibold">{libelleCause(cause)}</p>
          {remedeCause(cause) && (
            <p className="mt-0.5 text-xs text-muted-foreground">{remedeCause(cause)}</p>
          )}
          <ul className="mt-2 space-y-0.5">
            {/*
              ⚠️ BORNÉ À SIX, avec le reste compté. Une génération d'année peut
              produire des centaines de lignes : les dérouler toutes noierait la
              cause, qui est justement ce qu'on vient lire.
            */}
            {lignes.slice(0, 6).map((ligne, rang) => (
              <li key={`${ligne.semaine}-${ligne.tacheId}-${rang}`} className="text-xs text-muted-foreground">
                {libelleSemaine(ligne.semaine, { court: true })} · {ligne.groupe} · {ligne.module} — {ligne.manquantes} séance(s)
              </li>
            ))}
            {lignes.length > 6 && (
              <li className="text-xs text-muted-foreground">
                … et {lignes.length - 6} autre(s)
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Ce que chaque relance rapporterait, demandé au serveur avant de cliquer.
 *
 * ═══ ⚠️ UN BOUTON QUI NE DIT PAS CE QU'IL FAIT EST UN PARI ═══
 * Le directeur cliquait, attendait, et découvrait après coup si ça avait servi.
 * Depuis que les consignes des formateurs sont souples, la réponse est souvent
 * **zéro** — le solveur les emploie déjà en dernier recours. Le dire AVANT
 * évite une attente pour rien, et envoie corriger la donnée plutôt que relancer.
 *
 * ⚠️ « JUSQU'À », JAMAIS UN CHIFFRE SEC : la simulation compte ce que le
 *    solveur PROPOSE ; à l'écriture, `poser()` peut encore refuser une séance.
 *    C'est un majorant, et l'annoncer comme tel est la seule façon honnête.
 *
 * ⚠️ À LA DEMANDE, PAS AUTOMATIQUEMENT : chaque simulation coûte quatre
 *    résolutions par semaine. Les déclencher à l'ouverture du rapport ferait
 *    payer ce calcul à tous ceux qui ne relanceront jamais.
 */
function Simulation({ semaines, propositions }) {
  const [gains, setGains] = useState(null);

  const calcul = useMutation({
    mutationFn: () => simuler(semaines),
    onSuccess: (resultat) => {
      const par = new Map(resultat.propositions.map((p) => [p.cle, p.gain]));
      setGains(par);
    },
  });

  if (gains) {
    const utiles = propositions.filter((p) => (gains.get(p.cle) ?? 0) > 0);
    if (utiles.length === 0) {
      return (
        <p className="mt-1.5 text-xs text-warning">
          {/*
            ⚠️ LE RÉSULTAT LE PLUS FRÉQUENT, ET LE PLUS UTILE. Il envoie
            corriger la carte ou le calendrier au lieu de relancer en boucle.
          */}
          Aucune relance ne récupérerait de séance ici — ce sont les données
          qu’il faut corriger, pas les réglages.
        </p>
      );
    }
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        Estimation :{' '}
        {utiles
          .map((p) => `${p.libelle} → jusqu’à ${gains.get(p.cle)} séance(s)`)
          .join(' · ')}
        .
      </p>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1 h-7 px-0 text-xs underline underline-offset-2"
      disabled={calcul.isPending}
      onClick={() => calcul.mutate()}
    >
      {calcul.isPending ? 'Estimation en cours…' : 'Que rapporterait une relance ?'}
    </Button>
  );
}

export default function RapportGeneration({ rapport, onRelancer }) {
  const total = rapport.total ?? {};
  const causes = causesRencontrees(rapport);
  const propositions = assouplissementsUtiles(causes);
  const incompletes = semainesIncompletes(rapport);

  /*
   * ⚠️ DEUX SIGNALEMENTS QUE L'ANCIEN AVALAIT EN SILENCE, et qui ne sont PAS
   *    des échecs de placement :
   *    · `ignorees` — un module planifié au chronogramme sans affectation dans
   *      la carte. Ses heures ne seront JAMAIS posées, quelle que soit la
   *      relance : c'est la carte qu'il faut corriger.
   *    · `refusees` — un placement que le solveur a proposé et que `poser()` a
   *      refusé. C'est le signal que le problème construit diverge de ce que le
   *      serveur accepte.
   */
  const ignorees = (rapport.semaines ?? []).flatMap((s) => s.ignorees ?? []);
  const refusees = (rapport.semaines ?? []).flatMap((s) => s.refusees ?? []);

  /*
   * ═══ ⚠️ DEUX DIAGNOSTICS, DEUX CORRECTIONS OPPOSÉES ═══ (2026-09-22)
   * Un groupe ABSENT de la carte demande de retirer son chronogramme ; un
   * module non affecté demande d'ajouter une affectation. Les réunir sous
   * « corrigez la carte » envoyait chercher au mauvais endroit — et sur
   * l'année réelle, les 39 cas signalés étaient tous du premier type.
   */
  const groupesAbsents = [
    ...new Set(
      ignorees
        .filter((entree) => entree.motif === MOTIFS_IGNOREE.GROUPE_ABSENT)
        .map((entree) => entree.groupe)
    ),
  ];
  const modulesSansAffectation = [
    ...new Set(
      ignorees
        .filter((entree) => entree.motif !== MOTIFS_IGNOREE.GROUPE_ABSENT)
        .map((entree) => `${entree.groupe} · ${entree.module}`)
    ),
  ];

  /*
   * ⚠️ PROPOSER UN BOUTON QUI NE PEUT PAS MARCHER EST PIRE QUE DE NE RIEN
   *    PROPOSER. OR-Tools est une dépendance FACULTATIVE : si elle manque sur
   *    le serveur, `choix.py` le dit dans le rapport au lieu de se taire — et
   *    l'écran doit relayer cette réponse, pas réinviter à cliquer.
   */
  const ortoolsAbsent = (rapport.semaines ?? []).some(
    (semaine) => semaine.rapport?.repli === REPLIS_MOTEUR.ORTOOLS_ABSENT
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chiffre valeur={total.placees ?? 0} libelle="séances posées" ton="succes" />
        <Chiffre valeur={total.remplacees ?? 0} libelle="remplacées" />
        <Chiffre
          valeur={total.nonPlacees ?? 0}
          libelle="non placées"
          ton={total.nonPlacees > 0 ? 'alerte' : 'neutre'}
        />
        <Chiffre
          valeur={total.echecs ?? 0}
          libelle="semaines en échec"
          ton={total.echecs > 0 ? 'alerte' : 'neutre'}
        />
      </div>

      {total.deconseillees > 0 && (
        /*
         * ═══ ⚠️ LE COÛT DE LA SOUPLESSE, À CÔTÉ DE SON GAIN ═══ (2026-09-22)
         * Depuis que les créneaux « à éviter » sont des consignes et non des
         * interdictions, le solveur s'y résout plutôt que de laisser une séance
         * non placée : +143 séances sur l'année réelle, pour 164 posées sur un
         * créneau que quelqu'un avait demandé à garder libre.
         *
         * ⚠️ **SANS CETTE LIGNE, LE DIRECTEUR L'APPREND PAR LES RÉCLAMATIONS.**
         *    Le formateur, lui, verrait son cours apparaître là où il avait
         *    demandé à ne pas en avoir, sans explication, et croirait à un
         *    défaut. L'arbitrage est assumé ; le taire ne l'est pas.
         */
        <Alerte
          type="info"
          titre="Des indisponibilités de formateurs n’ont pas pu être respectées"
        >
          <strong>{total.deconseillees} séance(s)</strong> sont posées sur un créneau
          où le formateur s’est déclaré indisponible. Le générateur ne s’y résout que faute de
          mieux : l’autre solution était de ne pas placer ces heures du tout. Elles
          sont signalées semaine par semaine ci-dessous.
        </Alerte>
      )}

      {total.horsSalle > 0 && (
        /*
         * ═══ ⚠️ LA SALLE DU MODULE EST IMPOSÉE DEPUIS LE 2026-10-03 ═══
         * Le générateur ne pose plus une séance hors de sa salle de lui-même :
         * ce compte n'est non nul que si la relance « toutes les salles » a
         * levé l'imposition, à la demande du directeur.
         *
         * ⚠️ **SANS CETTE LIGNE, PERSONNE NE SAIT QUE LA CONSIGNE A CÉDÉ.** Le
         *    cours apparaîtrait dans une salle ordinaire alors qu'il demande un
         *    atelier — et c'est le formateur qui le découvrirait devant sa
         *    classe, sans machine.
         */
        <Alerte type="info" titre="Des salles imposées ont été levées">
          <strong>{total.horsSalle} séance(s)</strong> sont posées ailleurs que dans la
          salle imposée pour leur module, parce que la relance « toutes les salles » a
          levé cette règle. Elles sont signalées semaine par semaine ci-dessous.
        </Alerte>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Par semaine</p>
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border px-3">
          {(rapport.semaines ?? []).map((semaine) => (
            <LigneSemaine key={semaine.semaine} semaine={semaine} />
          ))}
        </ul>
      </div>

      <ParCause rapport={rapport} />

      {groupesAbsents.length > 0 && (
        <Alerte
          type="avertissement"
          titre="Des chronogrammes portent sur des groupes absents de la carte"
        >
          Ces groupes n’apparaissent dans <strong>aucune affectation</strong> : ils
          n’existent pas dans la carte. Leurs heures ne seront jamais posées — ce sont
          ces <strong>chronogrammes</strong> qu’il faut retirer ou renommer.
          <ul className="mt-1.5 space-y-0.5">
            {groupesAbsents.slice(0, 8).map((groupe) => (
              <li key={groupe} className="text-xs">
                {groupe}
              </li>
            ))}
            {groupesAbsents.length > 8 && (
              <li className="text-xs">… et {groupesAbsents.length - 8} autre(s)</li>
            )}
          </ul>
        </Alerte>
      )}

      {modulesSansAffectation.length > 0 && (
        <Alerte type="avertissement" titre="Modules planifiés sans affectation">
          Leur chronogramme prévoit des heures, mais aucun formateur ne leur est affecté dans la
          carte. Ces heures ne seront jamais posées, quelle que soit la relance —{' '}
          <strong>c’est la carte d’établissement qu’il faut corriger</strong>.
          <ul className="mt-1.5 space-y-0.5">
            {modulesSansAffectation.slice(0, 8).map((libelle) => (
              <li key={libelle} className="text-xs">
                {libelle}
              </li>
            ))}
            {modulesSansAffectation.length > 8 && (
              <li className="text-xs">… et {modulesSansAffectation.length - 8} autre(s)</li>
            )}
          </ul>
        </Alerte>
      )}

      {refusees.length > 0 && (
        <Alerte type="erreur" titre={`${refusees.length} placement(s) refusé(s) à l’écriture`}>
          Le solveur les avait proposés, le serveur les a refusés — presque toujours parce que le
          module a déjà reçu toutes les heures que la carte lui accorde.
          <ul className="mt-1.5 space-y-0.5">
            {refusees.slice(0, 5).map((refus, rang) => (
              <li key={`${refus.tacheId}-${rang}`} className="text-xs">
                {refus.groupe} · {refus.module} ({refus.jour} {refus.seance}) — {refus.message}
              </li>
            ))}
          </ul>
        </Alerte>
      )}

      {/*
        ═══ ⚠️ C'EST ICI QUE LA RECHERCHE APPROFONDIE GAGNE SA PLACE ═══
        Elle ne sert que sur les semaines INCOMPLÈTES — une semaine remplie est
        optimale par définition, et `choix.py` ne l'y lance même pas. La
        proposer au moment où le rapport montre des séances non placées, c'est
        la proposer sur les seules semaines où elle peut rendre quelque chose :
        mesuré, 7 minutes au lieu de 15, pour le même gain.

        ⚠️ ON NE LA PROPOSE PAS SI ELLE VIENT DÉJÀ DE TOURNER : ces semaines
           sont restées incomplètes AVEC elle, relancer à l'identique
           redonnerait le même résultat après la même attente.
      */}
      {incompletes.length > 0 && rapport.moteur !== MOTEURS.CPSAT && (
        ortoolsAbsent ? (
          <Alerte type="info" titre="Recherche approfondie indisponible">
            Le serveur n’a pas OR-Tools installé. La génération rapide fonctionne normalement ;
            seule la recherche de meilleures grilles est hors service.
          </Alerte>
        ) : (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Telescope className="size-3.5 shrink-0" />
              Chercher une meilleure grille
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reprend les {incompletes.length} semaine(s) incomplète(s) avec une recherche
              complète — une vingtaine de secondes chacune, pour quelques séances de plus.
              La grille actuelle est conservée si rien de mieux n’est trouvé.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 text-xs"
              onClick={() => onRelancer(incompletes, {}, MOTEURS.CPSAT)}
            >
              Relancer en recherche approfondie
            </Button>
          </div>
        )
      )}

      {propositions.length > 0 && incompletes.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-semibold">Relancer les semaines incomplètes</p>
          <Simulation semaines={incompletes} propositions={propositions} />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {/*
              ⚠️ SEULES LES SEMAINES INCOMPLÈTES : relancer tout réécrirait les
              semaines réussies, donc les redistribuerait — et ferait perdre des
              placements peut-être ajustés à la main depuis.
            */}
            Seules les {incompletes.length} semaine(s) incomplète(s) seront régénérées.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {propositions.map((proposition) => (
              <Button
                key={proposition.cle}
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                title={proposition.explication}
                onClick={() => onRelancer(incompletes, { [proposition.cle]: true })}
              >
                {proposition.libelle}
              </Button>
            ))}
            {propositions.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  onRelancer(
                    incompletes,
                    Object.fromEntries(propositions.map((p) => [p.cle, true]))
                  )
                }
              >
                Les deux
              </Button>
            )}
          </div>
        </div>
      )}

      {rapport.graine != null && (
        <p className="text-xs text-muted-foreground">
          Graine <Badge variant="outline" className="font-mono text-[0.7rem]">{rapport.graine}</Badge>{' '}
          — conservée : la même génération se rejoue à l’identique.
        </p>
      )}
    </div>
  );
}
