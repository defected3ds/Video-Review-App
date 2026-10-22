import React from 'react';
import logo from './assets/pipelife-logo.svg';

export default function Brand() {
  return <div className="brand"><img className="brand-logo" src={logo} alt="Pipelife — Wienerberger"/><span className="brand-subtitle">Video review</span></div>;
}
