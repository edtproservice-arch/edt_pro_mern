import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Presentation } from 'lucide-react';
import Teams from '@/components/icons/Teams';
import Alerte from '@/components/common/Alerte';
import BadgeRegional from '@/components/common/BadgeRegional';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import TableauTriable from '@/components/common/TableauTriable';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import CadreReglage from '@/features/parametres/CadreReglage';
import { nombre } from '@/lib/nombres';
import { chargerAffectationsConsultation } from './api';

/**
 * « Mes affectations » — ce qu'un formateur enseigne cette année (F14).
 * ← `affectationFormateur.html` (804 lignes), réduit à une LECTURE : la carte
 * elle-même ne se modifie que depuis « Paramètres → Affectations », côté
 * directeur.
 *
 * ═══ LE MÊME ÉCRAN QUE « PROGRAMME », L'AUTRE MOITIÉ DE LA QUESTION ═══
 * (2026-09-06, demande du porteur : « je veux que le même style de la page mon
 * programme stagiaire soit en affectations formateurs ».) Un formateur demande
 * « qu'est-ce que j'enseigne », un stagiaire « qu'est-ce qu'on m'enseigne » —
 * même table `Base.affectations`, lue par l'autre bout. Deux mises en page pour
 * une même donnée obligeaient à réapprendre l'écran en changeant de rôle, et
 * elles auraient divergé au premier ajustement (§4.2 du plan).
 */
export default function PageMesAffectations() {
  const requete = useQuery({
    queryKey: ['consultation', 'affectations'],
    queryFn: chargerAffectationsConsultation,
    retry: false,
  });

  const affectations = requete.data?.affectations ?? [];

  /*
   * ⚠️ LES TROIS CARTES DISENT SA CHARGE, et c'est ce que la liste seule ne
   * disait pas : on lisait dix-sept lignes sans savoir ce qu'elles pèsent
   * ensemble, ni ce que le distanciel y représente.
   *
   * ⚠️ ELLES SOMMENT SANS DÉDOUBLONNER, et c'est juste ICI : le serveur rend
   * UNE ligne par affectation — le libellé d'ensemble d'une séance mutualisée
   * (« GM101 GM102 ») n'y est pas éclaté, précisément pour que sa charge ne
   * compte qu'une fois. Éclater et sommer aurait doublé son synchrone.
   */
  const total = useMemo(() => {
    const presentiel = affectations.reduce((somme, ligne) => somme + (ligne.presentiel ?? 0), 0);
    const synchrone = affectations.reduce((somme, ligne) => somme + (ligne.synchrone ?? 0), 0);
    const global = presentiel + synchrone;

    return {
      presentiel,
      synchrone,
      global,
      /*
       * ═══ ⚠️ UNE LIGNE N'EST PAS UN MODULE ═══ (2026-09-06, en corrigeant la
       * ventilation de « Suivi de l'avancement ».) Chaque ligne est un couple
       * (groupe, module) : le même module enseigné à trois groupes en fait
       * trois. Écrire « 18 modules » face aux « 11 module(s) » de l'avancement —
       * qui, lui, agrège par CODE — laissait croire à une seconde
       * contradiction. Les deux nombres sont justes, ils ne comptent pas la
       * même chose : on les nomme donc tous les deux.
       */
      modules: new Set(affectations.map((ligne) => ligne.module)).size,
      // ⚠️ Une part de zéro heure n'est pas « 0 % », c'est une part qui n'existe
      // pas : la division ferait `NaN`, affiché tel quel.
      part: (valeur) => (global > 0 ? Math.round((valeur / global) * 100) : 0),
    };
  }, [affectations]);

  return (
    <CadreReglage
      titre="Mes affectations"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {affectations.length === 0 ? (
        <Alerte type="info" titre="Aucune affectation">
          Vous n’êtes affecté à aucun module cette année scolaire.
        </Alerte>
      ) : (
        <div className="space-y-4">
          {/* ⚠️ TROIS CARTES, PAS QUATRE : `BandeCartes` en pose quatre par
              rangée par défaut, ce qui laisserait ici une case vide. */}
          <BandeCartes className="sm:grid-cols-3 lg:grid-cols-3">
            <CarteStat
              Icone={Clock}
              libelle="Masse horaire globale"
              valeur={`${nombre(total.global)} h`}
              teinte="text-primary"
              fond="bg-primary/10"
              /* ⚠️ La seconde mention n'apparaît QUE si elle diffère : sans
                 module enseigné à plusieurs groupes, elle redirait le premier
                 nombre. */
              detail={
                total.modules === affectations.length
                  ? `${affectations.length} module${affectations.length > 1 ? 's' : ''}`
                  : `${total.modules} module${total.modules > 1 ? 's' : ''} · ${affectations.length} affectations`
              }
            />
            <CarteStat
              Icone={Presentation}
              libelle="Présentiel"
              valeur={`${nombre(total.presentiel)} h`}
              teinte="text-accent-teal"
              fond="bg-accent-teal/10"
              detail={`${total.part(total.presentiel)} % du total`}
            />
            <CarteStat
              Icone={Teams}
              libelle="Synchrone"
              valeur={`${nombre(total.synchrone)} h`}
              teinte="text-accent-purple-deep"
              fond="bg-accent-purple/20"
              detail={`${total.part(total.synchrone)} % du total`}
            />
          </BandeCartes>

          {/*
            ⚠️ `TableauTriable` ET `cartesSous="md"` — les mêmes réglages que
            « Programme », pour les mêmes raisons : le tri sert sur une vingtaine
            de lignes, et six colonnes de texte ne tiennent pas sur un téléphone.
            Sans `pleinePage`, dont l'en-tête collant s'accrocherait au conteneur
            défilant de la coquille et non à la page.
          */}
          <TableauTriable
            cartesSous="md"
            /* En-tête collant : voir le commentaire de « Mon avancement » — on
               remonte de la marge du conteneur défilant de la coquille. */
            collant={`-${MARGE_PAGE}px`}
            vide="Aucune affectation."
            cleLigne={(ligne) => `${ligne.groupe}-${ligne.module}`}
            lignes={affectations}
            colonnes={[
              /*
                ⚠️ LA COLONNE « GROUPE » EST TOUJOURS LÀ, contrairement à
                « Programme » où elle ne paraît qu'à partir de deux : un
                stagiaire n'a qu'un groupe dans la plupart des cas, un formateur
                en a toujours plusieurs — c'est même la première chose qu'il
                cherche dans cette liste.
              */
              {
                id: 'groupe',
                entete: 'Groupe',
                enroule: true,
                tri: (ligne) => ligne.groupe,
                rendu: (ligne) => <span className="font-medium">{ligne.groupe}</span>,
              },
              {
                id: 'module',
                entete: 'Module',
                enroule: true,
                tri: (ligne) => ligne.intitule || ligne.module,
                rendu: (ligne) => (
                  <>
                    {/* Le NOM d'abord, le code en dessous : c'est le nom qu'on
                        vient lire, le code sert à le retrouver ailleurs. */}
                    <div className="font-medium">{ligne.intitule || ligne.module}</div>
                    {ligne.intitule && (
                      <div className="text-xs text-muted-foreground">{ligne.module}</div>
                    )}
                  </>
                ),
              },
              {
                id: 'masse',
                entete: 'Masse horaire',
                // ⚠️ ON TRIE SUR LE TOTAL, pas sur le texte affiché : « 90 h »
                // passerait avant « 140 h » en ordre alphabétique.
                tri: (ligne) => (ligne.presentiel ?? 0) + (ligne.synchrone ?? 0),
                rendu: (ligne) => (
                  /* ⚠️ UNE LIGNE PAR NATURE D'HEURES, et seulement si elle en
                     porte : « 0 h Synchrone » sur chaque rangée d'une charge
                     presque entièrement présentielle n'apprend rien et double la
                     hauteur du tableau. */
                  <div className="space-y-0.5">
                    {ligne.presentiel > 0 && (
                      <Masse
                        Icone={Presentation}
                        teinte="text-accent-teal"
                        heures={ligne.presentiel}
                        libelle="Présentiel"
                      />
                    )}
                    {ligne.synchrone > 0 && (
                      <Masse
                        Icone={Teams}
                        teinte="text-accent-purple-deep"
                        heures={ligne.synchrone}
                        libelle="Synchrone"
                      />
                    )}
                    {ligne.presentiel === 0 && ligne.synchrone === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                ),
              },
              {
                id: 'statut',
                entete: 'Statut',
                tri: (ligne) => (ligne.estRegional ? 0 : 1),
                // ⚠️ LA MÊME PASTILLE QUE « PROGRAMME » ET QUE LA CARTE
                // D'AFFECTATIONS — « Local » porte le même cadre : deux valeurs
                // de même nature dans une colonne « Statut ».
                rendu: (ligne) => <BadgeRegional estRegional={ligne.estRegional} />,
              },
              {
                id: 'semestre',
                entete: 'Semestre',
                tri: (ligne) => ligne.semestre ?? '',
                rendu: (ligne) => <BadgeSemestre semestre={ligne.semestre} long />,
              },
            ]}
          />
        </div>
      )}
    </CadreReglage>
  );
}

function Masse({ Icone, teinte, heures, libelle }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
      <Icone className={`size-3.5 shrink-0 ${teinte}`} />
      <span className="tabular-nums">{nombre(heures)} h</span>
      <span className="text-muted-foreground">{libelle}</span>
    </span>
  );
}
