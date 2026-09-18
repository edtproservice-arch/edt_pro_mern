/**
 * Détecteur de RÉFÉRENCES LIBRES dans le JS inline d'une page.
 *
 * C'est le défaut qui a produit « subGroups is not defined » : une variable
 * lue mais jamais déclarée. Aucun contrôle statique ne la voit — elle ne se
 * manifeste qu'au clic. Babel, lui, la donne : `programme.scope.globals`.
 *
 * Usage : node _libres_tmp.mjs <fichier.html>
 */
import fs from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

const html = fs.readFileSync(process.argv[2], 'utf8');

const blocs = [];
const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  blocs.push({ code: m[1], ligne: html.slice(0, m.index).split('\n').length });
}

const connus = new Set([
  // Navigateur
  'window', 'document', 'console', 'fetch', 'localStorage', 'sessionStorage',
  'navigator', 'location', 'history', 'alert', 'confirm', 'prompt', 'FormData',
  'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'AbortController',
  'Headers', 'Request', 'Response', 'getComputedStyle', 'matchMedia',
  'structuredClone', 'queueMicrotask', 'btoa', 'atob', 'Node', 'Element',
  'HTMLElement', 'NodeList', 'DOMParser', 'XMLHttpRequest', 'performance',
  'crypto', 'screen', 'top', 'parent', 'self', 'globalThis', 'process',
  'SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis',
  'SpeechSynthesisUtterance', 'print', 'open', 'close', 'scrollTo',
  // Langage
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Function',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'Uint8Array', 'Int8Array', 'Float32Array', 'ArrayBuffer', 'Intl', 'BigInt',
  // Chargées par <script src> ou CDN
  'Chart', 'ChartDataLabels', 'jspdf', 'jsPDF', 'XLSX', 'feather', 'TomSelect',
  'qrcode', 'html2canvas', 'Swal', 'bootstrap', 'jQuery', '$', 'moment',
  'dayjs', 'tailwind', 'lucide', 'SchoolYearFilter',
]);

// UN SEUL programme : les blocs inline partagent la portée globale du document.
// Les analyser séparément ferait passer pour « libre » toute fonction déclarée
// dans un bloc et appelée depuis un autre.
const separateur = String.fromCharCode(10) + ';' + String.fromCharCode(10);
const codeEntier = blocs.map((b) => b.code).join(separateur);

const ast = parse(codeEntier, { sourceType: 'script', errorRecovery: true });

let total = 0;
traverse(ast, {
  Program(chemin) {
    const noms = Object.keys(chemin.scope.globals).sort();
    for (const nom of noms) {
      if (connus.has(nom)) continue;
      total += 1;
      const ref = chemin.scope.globals[nom];
      console.log(`  ${nom.padEnd(32)} (1re reference ligne ${ref.loc?.start?.line ?? '?'} du JS concatene)`);
    }
  },
});

console.log(`\n${blocs.length} bloc(s) inline — ${total} identifiant(s) NON DECLARE(S).`);
