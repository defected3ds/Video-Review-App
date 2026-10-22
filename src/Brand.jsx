import React from 'react';
import logo from './assets/pipelife-logo.svg';
import lightLogo from './assets/pipelife-logo-light.svg';
import {useTheme} from './theme.js';

export default function Brand() {
  const theme=useTheme();
  return <div className="brand"><img className="brand-logo" src={theme==='dark'?lightLogo:logo} alt="Pipelife — Wienerberger"/><span className="brand-subtitle">Video review</span></div>;
}
