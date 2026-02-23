/**
 * Bridge API exposed to Kotlin (JCEF) for view switching.
 */
interface Window {
  setView?: (view: 'chat' | 'demo' | 'management') => void;
}
