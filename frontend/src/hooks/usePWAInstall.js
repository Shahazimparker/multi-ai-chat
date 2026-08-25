// ============================================================
// FILE: frontend/src/hooks/usePWAInstall.js
// PURPOSE: Hook for PWA install prompt lifecycle and iOS detection
// ============================================================

import { useState, useEffect, useCallback } from 'react';

export const usePWAInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    // 1. Check if running in standalone mode (already installed)
    const isStandaloneMode =
      (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)')?.matches) ||
      window.navigator?.standalone === true ||
      (typeof document !== 'undefined' && document.referrer && document.referrer.includes('android-app://')) ||
      false;

    setIsInstalled(isStandaloneMode);

    // 2. Detect iOS / iPadOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    setIsIOS(isAppleDevice && !isStandaloneMode);

    // 3. Listen for Chromium/Android beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowIOSModal(false);
      console.log('[PWA] App installed successfully');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return outcome;
    }

    if (isIOS) {
      setShowIOSModal(true);
      return 'ios_guide';
    }

    return 'unsupported';
  }, [deferredPrompt, isIOS]);

  const canInstall = !isInstalled && (Boolean(deferredPrompt) || isIOS);

  return {
    canInstall,
    isInstalled,
    isIOS,
    showIOSModal,
    setShowIOSModal,
    installApp
  };
};

export default usePWAInstall;
