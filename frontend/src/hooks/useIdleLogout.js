// ============================================================
// FILE: frontend/src/hooks/useIdleLogout.js
// PURPOSE: Sign the user out after a stretch of no interaction
// ============================================================

import { useEffect, useRef } from 'react';

// The activity clock lives in localStorage rather than a React ref so that
// every open tab shares one deadline. Working in tab A keeps tab B alive, and
// tab B notices the expiry on its own poll without needing to be told.
export const IDLE_ACTIVITY_KEY = 'last_activity';

const configuredMinutes = Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES);
export const IDLE_TIMEOUT_MS =
  (Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : 30) * 60 * 1000;

// How often we compare the clock against the deadline. The logout therefore
// lands somewhere in [timeout, timeout + POLL_INTERVAL_MS).
const POLL_INTERVAL_MS = 15 * 1000;

// mousemove alone would hammer localStorage hundreds of times a minute; one
// write per throttle window is plenty when the deadline is measured in tens of
// minutes.
const WRITE_THROTTLE_MS = 5 * 1000;

// Deliberately excludes focus/visibilitychange: coming back to the tab after an
// hour away must not reset the clock, it must trigger the expiry check.
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll'];

// localStorage throws in some privacy modes. Falling back to a module-level
// value keeps the timer working for that tab instead of crashing the app.
let memoryFallback = 0;

export const getLastActivity = () => {
  try {
    const raw = window.localStorage.getItem(IDLE_ACTIVITY_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return memoryFallback;
  }
};

export const markActivity = (at = Date.now()) => {
  memoryFallback = at;
  try {
    window.localStorage.setItem(IDLE_ACTIVITY_KEY, String(at));
  } catch {
    /* memoryFallback already holds it */
  }
};

export const clearActivity = () => {
  memoryFallback = 0;
  try {
    window.localStorage.removeItem(IDLE_ACTIVITY_KEY);
  } catch {
    /* nothing to clean up */
  }
};

/**
 * Calls `onIdle` once the user has been inactive for IDLE_TIMEOUT_MS.
 *
 * @param {boolean}  enabled - only arm the timer while someone is signed in
 * @param {Function} onIdle  - invoked at most once per idle period
 */
export const useIdleLogout = (enabled, onIdle) => {
  // Kept in a ref so a re-created callback doesn't tear down the listeners.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return undefined;

    // A fresh session starts its clock now. Without this, a login that lands in
    // a browser holding a stale timestamp would expire immediately.
    if (!getLastActivity()) markActivity();

    let lastWrite = 0;
    let firedFor = 0;

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      markActivity(now);
    };

    const checkIdle = () => {
      const last = getLastActivity();
      if (!last) return;
      if (Date.now() - last < IDLE_TIMEOUT_MS) return;
      // Guard against the poll and the visibility check both firing on the same
      // expired timestamp.
      if (firedFor === last) return;
      firedFor = last;
      onIdleRef.current?.();
    };

    // Background tabs get their timers clamped and sleeping machines stop them
    // entirely, so re-check the moment the tab is looked at again. Comparing
    // absolute timestamps means neither case can silently extend the session.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };

    // scroll doesn't bubble from inner containers, so listen in the capture
    // phase to see the message list and sidebar scrolling too.
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true, capture: true })
    );
    document.addEventListener('visibilitychange', handleVisibility);

    const pollId = window.setInterval(checkIdle, POLL_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, handleActivity, { capture: true })
      );
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(pollId);
    };
  }, [enabled]);
};

export default useIdleLogout;
