import React from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import '../styles/legal.css';

export default function TermsOfServicePage() {
  return (
    <div className="legal-page">
      <TopBar showConnection={false} />

      <div className="legal-content">
        <Link to="/" className="legal-back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5m7-7-7 7 7 7"/>
          </svg>
          Back to Home
        </Link>

        <h1>Terms of Service</h1>
        <p className="legal-meta">Effective date: 1 January 2025 &mdash; Last updated: 1 January 2025</p>

        <p className="legal-intro">
          Please read these Terms of Service (&ldquo;Terms&rdquo;) carefully before using Open Ride
          (&ldquo;the Service&rdquo;, &ldquo;the Application&rdquo;, or &ldquo;the Software&rdquo;).
          By accessing or using the Service you agree to be bound by these Terms in their entirety.
          If you do not agree, you must immediately cease use of the Service.
        </p>

        <div className="legal-warning">
          <h2>Health &amp; Safety Warning</h2>
          <p>
            Indoor cycling and exercise activities involve inherent physical risks, including but not
            limited to cardiovascular events, musculoskeletal injury, and other medical emergencies.
            You should consult a qualified healthcare professional before beginning any exercise
            programme. The Service is not a medical device and does not provide medical advice,
            diagnosis, or treatment.
          </p>
          <p>
            By using the Service you acknowledge that you have assessed your own physical fitness and
            that you accept full and sole responsibility for any injury, illness, or adverse outcome
            arising from your use of the Service.
          </p>
        </div>

        <div className="legal-section">
          <h2>1. Acceptance of Terms</h2>
          <p>
            These Terms constitute a legally binding agreement between you (&ldquo;User&rdquo;,
            &ldquo;you&rdquo;) and the operator of Open Ride (&ldquo;Operator&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;). Your continued use of the Service constitutes
            your ongoing acceptance of these Terms and any updates thereto.
          </p>
          <p>
            We reserve the right to modify these Terms at any time. Material changes will be
            indicated by updating the &ldquo;Last updated&rdquo; date. Your continued use of the
            Service after any changes constitutes acceptance of the revised Terms.
          </p>
        </div>

        <div className="legal-section">
          <h2>2. Description of the Service</h2>
          <p>
            Open Ride is a privacy-first indoor cycling application that communicates with ANT+
            and Bluetooth fitness devices (smart trainers, heart rate monitors, power meters, etc.)
            via the WebUSB and Web Bluetooth browser APIs. The Service is provided &ldquo;as-is&rdquo;
            as free, open-source software. All user data is stored locally in your browser;
            no data is transmitted to or stored by the Operator.
          </p>
        </div>

        <div className="legal-section">
          <h2>3. User Responsibilities</h2>
          <p>You are solely and exclusively responsible for:</p>
          <ul>
            <li>
              assessing your physical fitness, health, and medical suitability before engaging
              in any exercise activity facilitated by the Service;
            </li>
            <li>
              the safe setup, installation, and use of any hardware (trainers, sensors, USB
              dongles, etc.) used with the Service;
            </li>
            <li>
              ensuring that your browser, operating system, and hardware are compatible with
              the Service;
            </li>
            <li>
              any workout data, training plans, or settings you create or import, and any
              decisions you make based on that data;
            </li>
            <li>
              compliance with all applicable local, national, and international laws and
              regulations in connection with your use of the Service;
            </li>
            <li>
              maintaining the security and confidentiality of your local device and browser
              data, including localStorage contents.
            </li>
          </ul>
        </div>

        <div className="legal-section">
          <h2>4. Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;, WITHOUT
            WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
            OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, RELIABILITY,
            NON-INFRINGEMENT, OR UNINTERRUPTED AVAILABILITY.
          </p>
          <p>
            We make no warranty or representation that: (a) the Service will meet your requirements
            or expectations; (b) the Service will be error-free, uninterrupted, or free from
            harmful components; (c) any data generated by the Service (including power, cadence,
            heart rate, or TSS figures) is accurate, complete, or suitable for any particular
            training purpose; or (d) defects in the Service will be corrected.
          </p>
          <p>
            Any reliance you place on the Service, its data, or its workout content is strictly
            at your own risk.
          </p>
        </div>

        <div className="legal-section">
          <h2>5. Limitation of Liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE OPERATOR, ITS CONTRIBUTORS,
            AFFILIATES, LICENSORS, EMPLOYEES, AGENTS, AND SERVICE PROVIDERS SHALL NOT BE LIABLE
            FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
            OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES,
            ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE SERVICE,
            EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            IN NO EVENT SHALL THE AGGREGATE LIABILITY OF THE OPERATOR FOR ALL CLAIMS RELATING
            TO THE SERVICE EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID FOR THE SERVICE IN THE
            TWELVE (12) MONTHS PRECEDING THE CLAIM OR (B) ONE EURO (&euro;1.00).
          </p>
          <p>
            Because some jurisdictions do not allow the exclusion or limitation of certain
            warranties or liability, the limitations above may apply to you only to the extent
            permitted by applicable law.
          </p>
        </div>

        <div className="legal-section">
          <h2>6. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless the Operator and its contributors
            from and against any and all claims, damages, losses, costs, and expenses (including
            reasonable legal fees) arising out of or relating to: (a) your use of or access to
            the Service; (b) your violation of these Terms; (c) your violation of any third-party
            right, including any intellectual-property, privacy, or proprietary right; or
            (d) any claim that your use of the Service caused damage to a third party.
          </p>
        </div>

        <div className="legal-section">
          <h2>7. Fitness and Medical Disclaimer</h2>
          <p>
            The Service and its workout content are designed for informational and recreational
            purposes only. Nothing in the Service constitutes professional medical advice, a
            medical diagnosis, treatment, or a substitute for professional medical advice.
            Always seek the advice of your physician or other qualified health provider before
            starting a new fitness programme or if you have any questions regarding a medical
            condition.
          </p>
          <p>
            Never disregard professional medical advice or delay in seeking it because of
            something you have read or experienced through the Service. If you experience chest
            pain, shortness of breath, dizziness, or any other potentially serious symptom,
            stop exercising immediately and seek emergency medical assistance.
          </p>
        </div>

        <div className="legal-section">
          <h2>8. Intellectual Property</h2>
          <p>
            The Service is released as open-source software. The source code is governed by its
            applicable open-source licence. Nothing in these Terms grants you rights in the
            Operator&rsquo;s trademarks, trade names, or branding.
          </p>
        </div>

        <div className="legal-section">
          <h2>9. Third-Party Hardware and Software</h2>
          <p>
            The Service interacts with third-party hardware (trainers, sensors, dongles) and
            browser APIs (WebUSB, Web Bluetooth). The Operator has no control over, and accepts
            no responsibility for, the accuracy, availability, safety, or compatibility of any
            third-party hardware or software. Use of such hardware or software is entirely at
            your own risk and subject to the terms of the respective manufacturers and browser
            vendors.
          </p>
        </div>

        <div className="legal-section">
          <h2>10. Termination</h2>
          <p>
            These Terms remain in effect for as long as you use the Service. You may cease use
            at any time by stopping your use of the Service and clearing your local browser data.
            We reserve the right to restrict or discontinue the Service at any time without notice
            or liability.
          </p>
        </div>

        <div className="legal-section">
          <h2>11. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the
            jurisdiction in which the Operator is established, without regard to its conflict-of-law
            provisions. Any dispute arising out of or relating to these Terms or the Service that
            cannot be resolved informally shall be subject to the exclusive jurisdiction of the
            competent courts of that jurisdiction.
          </p>
        </div>

        <div className="legal-section">
          <h2>12. Severability and Entire Agreement</h2>
          <p>
            If any provision of these Terms is found to be invalid or unenforceable by a court of
            competent jurisdiction, the remaining provisions shall continue in full force and effect.
            These Terms, together with the Privacy Policy, constitute the entire agreement between
            you and the Operator with respect to the Service and supersede all prior and
            contemporaneous agreements.
          </p>
        </div>

        <div className="legal-section">
          <h2>13. Contact</h2>
          <p>
            Questions about these Terms may be directed to the project&rsquo;s public issue tracker
            at <a href="https://github.com/anthropics/claude-code/issues" rel="noopener noreferrer" target="_blank" style={{color: 'var(--primary-blue)'}}>the project repository</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
