import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AntProvider } from './contexts/AntContext';
import HomePage from './pages/HomePage';
import TrainingProgramPage from './pages/TrainingProgramPage';
import WorkoutPage from './pages/WorkoutPage';
import SettingsPage from './pages/SettingsPage';
import AiWorkoutPage from './pages/AiWorkoutPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import Footer from './components/Footer';

function AppShell() {
  const location = useLocation();
  // The workout page has its own full-screen layout; skip the footer there.
  const hideFooter = location.pathname.startsWith('/workout/');

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/training" element={<TrainingProgramPage />} />
        <Route path="/workout/:id" element={<WorkoutPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ai-workout" element={<AiWorkoutPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
      </Routes>
      {!hideFooter && <Footer />}
    </>
  );
}

function App() {
  return (
    <Router>
      <AntProvider>
        <AppShell />
      </AntProvider>
    </Router>
  );
}

export default App;
