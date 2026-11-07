import { createContext } from 'react';

// Keep context identity separate from hot-reloaded providers and hooks.
export const AntContext = createContext(null);
export const RideSessionContext = createContext(null);
