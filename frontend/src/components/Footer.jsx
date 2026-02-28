import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/legal.css';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <span className="site-footer__copy">
        &copy; {year} Open Ride. All rights reserved.
      </span>
      <nav className="site-footer__links" aria-label="Footer navigation">
        <Link to="/help" className="site-footer__link">Help</Link>
        <Link to="/terms" className="site-footer__link">Terms of Service</Link>
        <Link to="/privacy" className="site-footer__link">Privacy Policy</Link>
      </nav>
    </footer>
  );
}
