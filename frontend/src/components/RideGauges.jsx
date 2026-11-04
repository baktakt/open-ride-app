import React from 'react';
import '../styles/ride-gauges.css';

export function EffortGauge({ label, value, unit, target = 0, freeMax = 400, allOut = false, bias = 100 }) {
  const isPower = unit === 'W';
  const tolerance = Math.max(isPower ? 2 : 3, Math.round(target * (isPower ? 0.03 : 0.04)));
  const delta = value - target;
  const status = !target ? 'free' : Math.abs(delta) <= tolerance ? 'on' : delta > 0 ? 'over' : 'under';
  const statusText = !target ? (allOut ? 'ALL OUT' : 'FREE RIDE') : status === 'on' ? 'ON TARGET' :
    isPower ? (delta > 0 ? 'LESS POWER' : 'MORE POWER') : (delta > 0 ? 'SPIN SLOWER' : 'SPIN FASTER');
  const position = Math.max(0, Math.min(100, value / (target ? target * 2 : freeMax) * 100));
  const okWidth = target ? Math.min(32, Math.max(12, tolerance / target * 280)) : 0;
  return (
    <div className={`metric-card gauge-card status-${status}`} style={{ '--gauge-position': `${position}%`, '--ok-width': `${okWidth}%` }}>
      <div className="gauge-header"><div className="metric-label">{label}</div><div className="gauge-status">{statusText}</div></div>
      <div className="gauge-body"><div className="gauge-value">{value}<span>{unit}</span></div></div>
      <div className="gauge-line" aria-hidden="true"><div className="gauge-track" /><div className="gauge-ok" /><div className="gauge-needle" /></div>
      <div className="gauge-footer"><span className="gauge-target">
        {target ? <>Target <strong>{target}</strong> {unit}{bias !== 100 && <span className="metric-bias"> ({bias}%)</span>}</> : <>No target · {unit === 'W' ? 'Ride at your own pace' : 'Choose your cadence'}</>}
      </span></div>
    </div>
  );
}

export function MetricCard({ label, value, unit, className = '' }) {
  return <div className={`metric-card ${className}`}><div className="metric-label">{label}</div><div className="metric-value"><span>{value}</span><span className="metric-unit">{unit}</span></div></div>;
}

export default function RideGauges({ telemetry, ftp = 200 }) {
  return <div className="workout-metrics">
    <div className="metrics-top">
      <EffortGauge label="POWER" value={Math.round(telemetry.power || 0)} unit="W" freeMax={ftp * 2} />
      <EffortGauge label="CADENCE" value={Math.round(telemetry.cadence || 0)} unit="rpm" freeMax={160} />
    </div>
    <div className="metrics-bottom">
      <MetricCard label="HEART RATE" value={telemetry.heartRate || '--'} unit="bpm" className="heart-rate" />
      <MetricCard label="SPEED" value={(telemetry.speed || 0).toFixed(1)} unit="km/h" className="speed" />
    </div>
  </div>;
}
