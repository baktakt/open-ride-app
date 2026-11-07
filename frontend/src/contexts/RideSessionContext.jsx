import React, { useCallback, useContext, useMemo, useState } from 'react';

import { RideSessionContext } from './contextObjects';

export function RideSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const startSession = useCallback(({ location, name, kind }) => {
    setSession({ location, path: `${location.pathname}${location.search}`, name, kind, elapsed: 0, paused: false, complete: false });
  }, []);
  const updateSession = useCallback(update => {
    setSession(previous => {
      if (!previous || Object.keys(update).every(key => previous[key] === update[key])) return previous;
      return { ...previous, ...update };
    });
  }, []);
  const endSession = useCallback(() => setSession(null), []);
  const value = useMemo(() => ({ session, startSession, updateSession, endSession }), [session, startSession, updateSession, endSession]);
  return <RideSessionContext.Provider value={value}>{children}</RideSessionContext.Provider>;
}

export function useRideSession() {
  return useContext(RideSessionContext);
}
