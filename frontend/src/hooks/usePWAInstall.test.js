import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePWAInstall } from './usePWAInstall';

describe('usePWAInstall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state when not installed', () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isInstalled).toBe(false);
    expect(result.current.showIOSModal).toBe(false);
  });

  it('captures beforeinstallprompt event and marks app as installable', () => {
    const { result } = renderHook(() => usePWAInstall());

    const mockPromptEvent = new Event('beforeinstallprompt');
    mockPromptEvent.prompt = vi.fn();
    mockPromptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    act(() => {
      window.dispatchEvent(mockPromptEvent);
    });

    expect(result.current.canInstall).toBe(true);
  });
});
