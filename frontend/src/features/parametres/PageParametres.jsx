import { Link } from 'react-router-dom';
import { ChevronRight, Monitor, Moon, Sun } from 'lucide-react';
import { NAVIGATION } from '@/components/layout/navigation';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { useTheme } from '@/lib/theme';
import CadreReglage from './CadreReglage';

/**
 * Accueil des Paramètres — la carte d'établissement, en dix portes.
 * ← les douze panneaux de `profile.html` (F13)
 *
 * ═══ POURQUOI CETTE PAGE EXISTE ═══
 * « Paramètres » ne menait nulle part : cliquer dessus dépliait le sous-menu,
 * et c'était tout. Arriver sur une page vide — ou sur rien — quand on suit un
 * lien du menu principal se lit comme une panne.
 *
 * Elle sert aussi de vue d'ensemble : le sous-menu montre dix intitulés côte à
 * côte, sans dire ce que chacun règle. « Formations » et « Formateurs » se
 * ressemblent trop pour être distingués par leur seul nom.
 *
 * ⚠️ La liste vient de `navigation.js`, LA définition unique du menu — elle
 * n'est pas recopiée ici. Une entrée ajoutée au sous-menu apparaît donc dans la
 * barre latérale ET sur cette page, sans risque de divergence.
 */
const PARAMETRES = NAVIGATION.find((entree) => entree.url === '/app/parametres');

export default function PageParametres() {
  const entrees = PARAMETRES?.sousMenu ?? [];

  return (
    <CadreReglage titre="Paramètres">
      <BasculeTheme />

      {/*
        Toutes les entrées sont présentées à égalité, sans distinguer celles
        dont l'écran est encore en attente : c'est l'écran lui-même qui annonce
        sa phase quand on l'ouvre. Marquer ici ET là revenait à le dire deux
        fois, et à faire d'une page de navigation un tableau d'avancement.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entrees.map((entree) => (
          <Carte key={entree.url} {...entree} />
        ))}
      </div>
    </CadreReglage>
  );
}

/** Une porte. */
function Carte({ titre, url, icone: Icone, resume }) {
  return (
    <Link
      to={url}
      className="group flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-muted"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icone className="size-5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{titre}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{resume}</span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

const CHOIX = [
  { cle: 'clair', libelle: 'Clair', Icone: Sun },
  { cle: 'sombre', libelle: 'Sombre', Icone: Moon },
  { cle: 'systeme', libelle: 'Système', Icone: Monitor },
];

/**
 * Le bouton de bascule clair / sombre (2026-09-28, demande du porteur : « le
 * mode sombre pour toute la plateforme, avec le bouton de bascule en page
 * Paramètres »). « Système » suit le réglage de l'appareil. Le choix est retenu
 * dans ce navigateur et vaut pour toutes les pages, connexion comprise.
 */
function BasculeTheme() {
  const { choix, definir } = useTheme();

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium">Apparence</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Thème clair, sombre, ou celui de votre appareil. Retenu sur ce navigateur.
        </span>
      </span>

      <ButtonGroup>
        {CHOIX.map(({ cle, libelle, Icone }) => (
          <Button
            key={cle}
            type="button"
            variant={choix === cle ? 'default' : 'outline'}
            size="sm"
            aria-pressed={choix === cle}
            className="h-8 gap-1.5 text-xs"
            onClick={() => definir(cle)}
          >
            <Icone className="size-3.5" />
            {libelle}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}
