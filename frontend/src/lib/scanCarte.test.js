import { describe, it, expect } from 'vitest';
import { jetonDuQr } from './scanCarte';

const hotes = new Set(['edtpro.tech', 'www.edtpro.tech']);

describe('jetonDuQr (2026-10-31)', () => {
  it('lit le jeton d’un QR de carte EDT Pro', () => {
    expect(jetonDuQr('https://edtpro.tech/carte/abc.DEF-123_x', hotes)).toBe('abc.DEF-123_x');
    expect(jetonDuQr('  https://www.edtpro.tech/carte/abc/  ', hotes)).toBe('abc');
  });

  it('refuse un autre site, un autre chemin, ou un texte qui n’est pas un lien', () => {
    expect(jetonDuQr('https://pirate.example/carte/abc', hotes)).toBeNull();
    expect(jetonDuQr('https://edtpro.tech/app/accueil', hotes)).toBeNull();
    expect(jetonDuQr('https://edtpro.tech/carte/', hotes)).toBeNull();
    expect(jetonDuQr('https://edtpro.tech/carte/abc/autre', hotes)).toBeNull();
    expect(jetonDuQr('javascript:alert(1)', hotes)).toBeNull();
    expect(jetonDuQr('bonjour', hotes)).toBeNull();
    expect(jetonDuQr('', hotes)).toBeNull();
  });
});
