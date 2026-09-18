import animate from 'tailwindcss-animate';

/**
 * Configuration Tailwind — **shadcn standard**.
 *
 * Décision du 2026-08-14 : on utilise shadcn tel quel et on ne conserve de la
 * charte Notion que la PALETTE DE COULEURS (bloc `colors` ci-dessous, adossé aux
 * variables CSS de `globals.css`).
 *
 * Ont donc été retirés, au profit des valeurs par défaut :
 *   - l'échelle typographique custom (`text-heading-1`, `text-body-md`…)
 *   - les rayons fixes en pixels (xs/sm/md/lg/xl) → dérivés de `--radius`
 *   - les espacements nommés (xxs…xxl) → échelle Tailwind
 *   - les ombres `notion-1` / `notion-2` → `shadow-sm`, `shadow-lg`
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))',
  				active: 'hsl(var(--primary-active))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			efm: {
  				DEFAULT: 'hsl(var(--efm))',
  				foreground: 'hsl(var(--efm-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			/* Gris FROID des en-têtes de tableau — voir globals.css. */
  			'tableau-tete': {
  				DEFAULT: 'hsl(var(--tableau-tete))',
  				foreground: 'hsl(var(--tableau-tete-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))',
  				sky: 'hsl(var(--accent-sky))',
  				'sky-deep': 'hsl(var(--accent-sky-deep))',
  				purple: 'hsl(var(--accent-purple))',
  				'purple-deep': 'hsl(var(--accent-purple-deep))',
  				'purple-mid': 'hsl(var(--accent-purple-mid))',
  				pink: 'hsl(var(--accent-pink))',
  				orange: 'hsl(var(--accent-orange))',
  				'orange-deep': 'hsl(var(--accent-orange-deep))',
  				teal: 'hsl(var(--accent-teal))',
  				cyan: 'hsl(var(--accent-cyan))',
  				green: 'hsl(var(--accent-green))',
  				'green-deep': 'hsl(var(--accent-green-deep))',
  				brown: 'hsl(var(--accent-brown))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [animate],
};
