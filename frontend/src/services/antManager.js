/**
 * Shared ANT+ Manager instance
 * This module provides a singleton ANT manager that can be imported by all pages
 */

import { AntManagerWebUSB } from './antManagerWebUSB.js';
import { AntManagerEmulator } from './antManagerEmulator.js';

// Create singleton instance
let antManagerInstance = import.meta.hot?.data.manager || null;
if (import.meta.hot) import.meta.hot.dispose(data => { data.manager = antManagerInstance; });

// Check for emulator mode from URL parameter or localStorage
function shouldUseEmulator() {
  // Check URL parameter first (for easy testing)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('emulator')) {
    const enabled = urlParams.get('emulator') === 'true';
    sessionStorage.setItem('openride_session_emulator', String(enabled));
    return enabled;
  }

  const session = sessionStorage.getItem('openride_session_emulator');
  if (session !== null) return session === 'true';

  // Check localStorage
  const stored = localStorage.getItem('openride_use_emulator');
  return stored === 'true';
}

/**
 * Get or create the ANT manager instance
 * Uses emulator if ?emulator=true is in URL or localStorage has openride_use_emulator=true
 * AntProvider restores previously granted connections after subscribing to events.
 */
export function getAntManager() {
  if (!antManagerInstance) {
    const useEmulator = shouldUseEmulator();

    if (useEmulator) {
      antManagerInstance = new AntManagerEmulator();
      console.log('🎮 Created ANT+ Emulator instance (no hardware required)');
    } else {
      antManagerInstance = new AntManagerWebUSB();
      console.log('Created ANT+ WebUSB Manager instance');
    }
  }
  return antManagerInstance;
}

/**
 * Check if using emulator
 */
export function isEmulatorMode() {
  return antManagerInstance ? antManagerInstance instanceof AntManagerEmulator : shouldUseEmulator();
}

/**
 * Set emulator mode (saves to localStorage)
 */
export function setEmulatorMode(enabled) {
  sessionStorage.removeItem('openride_session_emulator');
  localStorage.setItem('openride_use_emulator', enabled ? 'true' : 'false');
  console.log(`Emulator mode ${enabled ? 'enabled' : 'disabled'}. Reload page to apply.`);
}

/**
 * Initialize ANT manager if not already connected
 * Returns true if already connected or successfully connected
 */
export async function ensureConnected() {
  const manager = getAntManager();

  if (manager.dongleStatus === 'connected') {
    return true;
  }

  const initialized = await manager.initialize();
  if (!initialized) {
    console.error('Failed to initialize ANT+ USB dongle');
  }
  return initialized;
}
