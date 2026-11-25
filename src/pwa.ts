/**
 * PWA : enregistrement du service worker (production uniquement) et invite d'installation.
 * Si la page n'est pas encore « cross-origin isolated » (hébergeur sans en-têtes COOP/COEP),
 * un unique rechargement laisse le service worker injecter ces en-têtes.
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then(() => {
    if (window.crossOriginIsolated) return;
    let reloaded = false;
    try { reloaded = sessionStorage.getItem('aerosim-coi-reload') === '1'; } catch { /* stockage indisponible */ }
    if (reloaded) return; // évite toute boucle : le pont physique utilisera postMessage
    const reload = () => {
      try { sessionStorage.setItem('aerosim-coi-reload', '1'); } catch { /* ignoré */ }
      window.location.reload();
    };
    if (navigator.serviceWorker.controller) reload();
    else navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  }).catch((err) => console.warn('[PWA] service worker non enregistré :', err));
}

export type InstallState = 'installed' | 'available' | 'unavailable';

function getState(): InstallState {
  return installed ? 'installed' : deferred ? 'available' : 'unavailable';
}

export function useInstallState(): InstallState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getState, getState);
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  if (choice.outcome === 'accepted') installed = true;
  deferred = null;
  emit();
}
