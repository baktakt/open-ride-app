import React from 'react';
import { RideSessionProvider, useRideSession } from './contexts/RideSessionContext';
import ActiveSessionBar from './components/ActiveSessionBar';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AntProvider } from './contexts/AntContext';
import HomePage from './pages/HomePage';
import TrainingProgramPage from './pages/TrainingProgramPage';
import WorkoutPage from './pages/WorkoutPage';
import SettingsPage from './pages/SettingsPage';
import AiWorkoutPage from './pages/AiWorkoutPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import HelpPage from './pages/HelpPage';
import RoutePage from './pages/RoutePage';
import Footer from './components/Footer';
import { initUsers } from './services/userManager';

// Run once at module load — before any component renders.
// Creates the initial user record from existing data on first launch.
initUsers();

function AppShell() {
  const location = useLocation();
  const { session, endSession } = useRideSession();
  const path = `${location.pathname}${location.search}`;
  const activity = location.pathname === '/route' || location.pathname.startsWith('/workout/');
  const showActivity = activity && (!session || session.path === path);
  const activityLocation = session?.location || (activity ? location : null);
  // The workout page has its own full-screen layout; skip the footer there.
  const hideFooter = location.pathname.startsWith('/workout/') || location.pathname === '/route';

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <ActiveSessionBar />
      {activityLocation && (
        <div key={`${activityLocation.pathname}${activityLocation.search}`} hidden={!showActivity} className="session-page">
          <Routes location={activityLocation}>
            <Route path="/workout/:id" element={<WorkoutPage isVisible={showActivity} />} />
            <Route path="/route" element={<RoutePage isVisible={showActivity} />} />
          </Routes>
        </div>
      )}
      {activity && !showActivity && (
        <main id="main-content" className="session-conflict">
          <h1>{session.complete ? 'Your last ride is complete' : session.paused ? 'Your ride is paused' : 'Your ride is still running'}</h1>
          <p>{session.name}</p>
          <Link to={session.path}>{session.complete ? 'View summary' : 'Return to ride'}</Link>
          {session.complete && <button onClick={endSession}>Open this new ride</button>}
        </main>
      )}
      <Routes>
        <Route path="/workout/:id" element={null} />
        <Route path="/route" element={null} />
        <Route path="/" element={<HomePage />} />
        <Route path="/training" element={<TrainingProgramPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ai-workout" element={<AiWorkoutPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
      {!hideFooter && <Footer />}
    </>
  );
}

function App() {
  return (
    <Router>
      <AntProvider>
        <RideSessionProvider>
          <AppShell />
        </RideSessionProvider>
      </AntProvider>
    </Router>
  );
}

export default App;
