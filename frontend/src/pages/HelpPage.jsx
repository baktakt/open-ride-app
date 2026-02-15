import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import '../styles/helppage.css';

const FAQ_ITEMS = [
  {
    question: 'What hardware do I need to use Open Ride?',
    answer:
      'You need a smart trainer that supports ANT+ FE-C or Bluetooth FTMS, an ANT+ USB dongle (for ANT+ mode), and a computer running a Chromium-based browser (Chrome, Edge, Brave, etc.) that supports WebUSB. Alternatively, you can try the built-in emulator with no hardware at all.'
  },
  {
    question: 'Which browsers are supported?',
    answer:
      'Open Ride requires WebUSB or Web Bluetooth support, which is available in Chromium-based browsers such as Google Chrome, Microsoft Edge, and Brave. Firefox and Safari do not currently support WebUSB.'
  },
  {
    question: 'Do I need to create an account?',
    answer:
      'No. Open Ride is completely privacy-first. There are no accounts, no cloud storage, and no tracking. All your data (settings, workout history, training programs) is stored locally in your browser\'s localStorage.'
  },
  {
    question: 'What is FTP and why should I set it?',
    answer:
      'FTP (Functional Threshold Power) is the maximum power you can sustain for roughly one hour. Workouts use your FTP to calculate target power zones. You can set your FTP in the Settings page. If you don\'t know yours, 200W is a reasonable starting point.'
  },
  {
    question: 'Can I use Open Ride without a power meter?',
    answer:
      'Yes, if your smart trainer has a built-in power meter (most smart trainers do). The trainer reports power data over ANT+ FE-C or Bluetooth FTMS. A separate power meter is not required.'
  },
  {
    question: 'What is the emulator mode?',
    answer:
      'Emulator mode simulates a smart trainer in software so you can explore the app, preview workouts, and test features without any physical hardware. Enable it by adding ?emulator=true to the URL or toggling it in Settings.'
  },
  {
    question: 'How do I create custom workouts?',
    answer:
      'You can create workouts using the AI Workout generator, which builds structured workouts based on your goals and fitness level. You can also import .orw workout files through the Settings page.'
  },
  {
    question: 'Will my data be lost if I clear my browser data?',
    answer:
      'Yes. Since all data is stored in localStorage, clearing your browser data will remove your settings, workout history, and training programs. Use the Export feature in Settings to back up your data before clearing.'
  },
  {
    question: 'Can I use Open Ride on my phone or tablet?',
    answer:
      'The interface is mobile-friendly, but WebUSB is not available on most mobile browsers. You may be able to connect via Bluetooth on Android Chrome. For the full experience, a desktop or laptop is recommended.'
  },
  {
    question: 'What workout file format does Open Ride use?',
    answer:
      'Open Ride uses the .orw (Open Ride Workout) XML format. These files define workout segments with target power, cadence, and duration. You can find example files in the workouts directory of the project.'
  }
];

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState(null);

  const toggleFaq = useCallback((index) => {
    setOpenFaq((prev) => (prev === index ? null : index));
  }, []);

  return (
    <div className="help-page">
      <TopBar showConnection={false} />

      <div className="help-content">
        <Link to="/" className="help-back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5m7-7-7 7 7 7"/>
          </svg>
          Back to Home
        </Link>

        <h1>Help &amp; Guide</h1>
        <p className="help-subtitle">Everything you need to get riding with Open Ride.</p>

        {/* ---- Getting Started ---- */}
        <div className="help-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.73-2.56 6.86-6 7.75v2.06c4.56-.93 8-4.96 8-9.81 0-4.85-3.44-8.88-8-9.81l-.01-.14zM5.07 8.05l-1.43-1.43C2.02 8.56 1.05 10.87 1 13.38h2.02c.05-1.87.75-3.58 1.88-4.94l.17-.39zM3.02 15.38H1c.28 3.37 2.29 6.23 5.08 7.74l1.01-1.74C4.94 20.18 3.28 17.99 3.02 15.38zM9 22.45c.99.34 2.04.55 3.13.55v-2.02c-.74 0-1.45-.13-2.13-.35l-1 1.82zM12 6c-3.87 0-7 3.13-7 7 0 3.47 2.52 6.34 5.83 6.89L12 18l1.17 1.89C16.48 19.34 19 16.47 19 13c0-3.87-3.13-7-7-7zm1 10h-2v-2h2v2zm0-4h-2V7h2v5z"/>
            </svg>
            <h2>Getting Started</h2>
          </div>
          <div className="help-steps">
            <div className="help-step">
              <div className="help-step-number">1</div>
              <div className="help-step-content">
                <h3>Set up your profile</h3>
                <p>
                  Go to <Link to="/settings">Settings</Link> and enter your FTP (Functional Threshold Power),
                  maximum heart rate, weight, and preferred units. These values are used to personalise
                  workout intensity zones.
                </p>
              </div>
            </div>
            <div className="help-step">
              <div className="help-step-number">2</div>
              <div className="help-step-content">
                <h3>Connect your trainer</h3>
                <p>
                  Plug in your ANT+ USB dongle and click <strong>Connect Devices</strong> in the
                  top bar. Your browser will prompt you to select the USB device. Once connected,
                  Open Ride will automatically discover your trainer and sensors.
                </p>
              </div>
            </div>
            <div className="help-step">
              <div className="help-step-number">3</div>
              <div className="help-step-content">
                <h3>Pick a workout</h3>
                <p>
                  Browse the workout library on the <Link to="/">Home</Link> page. Workouts are
                  organised by category and show estimated duration and intensity. Click a workout
                  to see its structure, then hit <strong>Start</strong> to begin.
                </p>
              </div>
            </div>
            <div className="help-step">
              <div className="help-step-number">4</div>
              <div className="help-step-content">
                <h3>Ride!</h3>
                <p>
                  During a workout, the app controls your trainer&rsquo;s resistance automatically.
                  You&rsquo;ll see real-time power, cadence, heart rate, and elapsed time. Follow
                  the target power zones shown on screen and complete each segment.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Using the Emulator ---- */}
        <div className="help-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
            <h2>Emulator Mode</h2>
          </div>
          <p className="help-text">
            Don&rsquo;t have hardware yet? No problem. Open Ride includes a built-in trainer emulator
            that simulates realistic power, cadence, and heart-rate data. To enable it:
          </p>
          <ul className="help-list">
            <li>Add <code>?emulator=true</code> to the URL, or</li>
            <li>Toggle the emulator option in <Link to="/settings">Settings</Link>.</li>
          </ul>
          <p className="help-text">
            The emulator badge will appear in the top navigation bar when active.
            All workout features work identically in emulator mode.
          </p>
        </div>

        {/* ---- Training Programs ---- */}
        <div className="help-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
            </svg>
            <h2>Training Programs</h2>
          </div>
          <p className="help-text">
            The <Link to="/training">Training</Link> page lets you build a weekly training schedule.
            Assign workouts to specific days of the week to create a structured plan. Your program
            is saved locally and persists between sessions.
          </p>
        </div>

        {/* ---- AI Workouts ---- */}
        <div className="help-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
            </svg>
            <h2>AI Workouts</h2>
          </div>
          <p className="help-text">
            The <Link to="/ai-workout">AI Workout</Link> generator creates personalised structured
            workouts based on your goals, available time, and fitness level. Enter your preferences
            and the AI will generate a complete workout with warm-up, intervals, and cool-down
            segments tailored to you.
          </p>
        </div>

        {/* ---- Data & Privacy ---- */}
        <div className="help-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            </svg>
            <h2>Data &amp; Privacy</h2>
          </div>
          <p className="help-text">
            Open Ride stores all data locally in your browser. Nothing is sent to any server.
            Your settings, workout history, and training programs live in localStorage under
            keys prefixed with <code>openride_</code>.
          </p>
          <ul className="help-list">
            <li><strong>Export:</strong> Back up your data from the Settings page using the Export button.</li>
            <li><strong>Import:</strong> Restore a previous backup using the Import button in Settings.</li>
            <li><strong>Delete:</strong> Clear your browser data or localStorage to remove everything.</li>
          </ul>
        </div>

        {/* ---- FAQ ---- */}
        <div className="help-section help-faq-section">
          <div className="help-section-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
            <h2>Frequently Asked Questions</h2>
          </div>
          <div className="faq-list">
            {FAQ_ITEMS.map((item, index) => (
              <div key={index} className={`faq-item ${openFaq === index ? 'open' : ''}`}>
                <button
                  type="button"
                  className="faq-question"
                  onClick={() => toggleFaq(index)}
                  aria-expanded={openFaq === index}
                >
                  <span>{item.question}</span>
                  <svg
                    className="faq-chevron"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {openFaq === index && (
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
