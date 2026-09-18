import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Coquille commune aux écrans d'authentification.
 *
 * Composants shadcn tels quels (`Card`, `CardHeader`…) : aucune classe de
 * typographie, d'espacement ou d'ombre personnalisée — seule la palette de
 * couleurs vient de la charte (décision du 2026-08-14).
 */
export default function AuthLayout({ titre, sousTitre, largeur = 'max-w-md', children, pied }) {
  return (
    <div className="auth-layout flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className={`w-full ${largeur}`}>
        <div className="mb-6 flex justify-center">
          <Link to="/">
            <img src="/logo_edtpro.svg" alt="EDT Pro" className="h-10 w-auto" />
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{titre}</CardTitle>
            {sousTitre && <CardDescription>{sousTitre}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {pied && (
          <div className="mt-4 text-center text-sm text-muted-foreground">{pied}</div>
        )}
      </div>
    </div>
  );
}
