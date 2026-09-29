/**
 * Ce que l'environnement fournit à une page : globales du navigateur, du
 * langage, et bibliothèques chargées depuis un CDN.
 *
 * Employée par `references-libres.mjs` : tout identifiant lu sans être déclaré
 * ET absent de cette liste est suspect.
 *
 * ⚠️ N'Y AJOUTER QUE CE QUI EST RÉELLEMENT FOURNI. Chaque nom ajouté ici est un
 * nom que le détecteur cessera de signaler — c'est la seule façon de le rendre
 * aveugle à un vrai défaut. Une fonction du projet n'a rien à y faire : si elle
 * vient d'un `<script src>` LOCAL, l'outil la lit déjà toute seule.
 */

/** Globales du navigateur. */
const NAVIGATEUR = [
  'window', 'document', 'console', 'fetch', 'localStorage', 'sessionStorage',
  'navigator', 'location', 'history', 'alert', 'confirm', 'prompt', 'FormData',
  'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'AbortController',
  'Headers', 'Request', 'Response', 'matchMedia', 'structuredClone', 'btoa', 'atob',
  'queueMicrotask', 'Node', 'Element', 'HTMLElement', 'NodeList', 'DOMParser',
  'XMLHttpRequest', 'performance', 'crypto', 'screen', 'top', 'parent', 'self',
  'globalThis', 'process', 'print', 'open', 'close', 'scrollTo', 'getSelection',
  'SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis', 'Notification',
  'SpeechSynthesisUtterance', 'WebSocket', 'EventSource', 'IDBKeyRange', 'indexedDB',
  // Constructeurs d'éléments : `new Option(...)` est courant dans ces pages.
  'Option', 'AbortSignal', 'Text', 'Range', 'Worker', 'HTMLOptionElement',
  /* ⚠️ `event` EST LA GLOBALE IMPLICITE HISTORIQUE (`window.event`) : elle
     existe encore, mais elle est DÉPRÉCIÉE et ne vaut que pendant la
     propagation d'un événement. Reconnue ici pour ne pas crier au loup — un
     gestionnaire devrait néanmoins recevoir son événement en PARAMÈTRE. */
  'event',
];

/** Globales du langage. */
const LANGAGE = [
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Function',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'Intl',
  'Uint8Array', 'Int8Array', 'Float32Array', 'ArrayBuffer', 'BigInt', 'escape',
];

/**
 * Bibliothèques chargées par CDN dans ces pages.
 *
 * ⚠️ ELLES SONT ÉNUMÉRÉES À LA MAIN parce que l'outil ne va pas sur le réseau :
 * il lit les `<script src>` LOCAUX, jamais les distants.
 */
const CDN = [
  'Chart', 'ChartDataLabels', 'jspdf', 'jsPDF', 'XLSX', 'feather', 'TomSelect',
  'qrcode', 'html2canvas', 'Swal', 'jQuery', '$', 'moment', 'dayjs', 'lucide',
  'FullCalendar',
];

export const GLOBALES_FOURNIES = new Set([...NAVIGATEUR, ...LANGAGE, ...CDN]);
