import React, { useEffect, useRef, useState } from 'react';

const storageKey = 'pipelife-sidebar-width', defaultWidth = 280, minimum = 210;
const maximum = () => Math.min(520, Math.max(minimum, innerWidth - 760));
const clamp = width => Math.max(minimum, Math.min(maximum(), width));
function savedWidth() {
  try { const value = Number(localStorage.getItem(storageKey)); if (Number.isFinite(value) && value >= minimum && value <= 520) return value; } catch {}
  return defaultWidth;
}

export default function ProjectSidebar({ children, resizable = true }) {
  const [preferredWidth, setPreferredWidth] = useState(savedWidth), [viewport, setViewport] = useState(innerWidth), [resizing, setResizing] = useState(false);
  const drag = useRef(null);
  const width = clamp(preferredWidth), max = Math.min(520, Math.max(minimum, viewport - 760));
  useEffect(() => {
    const resize = () => setViewport(innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('resizing-sidebar', resizing);
    return () => document.documentElement.classList.remove('resizing-sidebar');
  }, [resizing]);
  function save(value) {
    const next = clamp(value); setPreferredWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch {}
  }
  function finish(cancel = false) {
    const active = drag.current; if (!active) return;
    drag.current = null; setResizing(false);
    if (cancel) setPreferredWidth(active.original); else save(active.width);
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
  }
  function start(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    drag.current = { x: event.clientX, width, startWidth: width, original: preferredWidth, target: event.currentTarget, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId); setResizing(true);
  }
  function move(event) {
    const active = drag.current; if (!active || event.pointerId !== active.pointerId) return;
    active.width = clamp(active.startWidth + event.clientX - active.x); setPreferredWidth(active.width);
  }
  function key(event) {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); return; }
    const step = event.shiftKey ? 40 : 20;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: minimum, End: max }[event.key];
    if (next !== undefined) { event.preventDefault(); save(next); }
  }
  return <aside className="sidebar project-sidebar" style={{ '--project-sidebar-width': `${width}px` }}>
    <div id="project-sidebar-content" className="sidebar-content">{children}</div>
    {resizable && <div className={`sidebar-resizer ${resizing ? 'resizing' : ''}`} role="separator" tabIndex={0} aria-label="Resize project sidebar" aria-orientation="vertical" aria-controls="project-sidebar-content" aria-valuemin={minimum} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} pixels`} title="Drag to resize · Arrow keys to adjust · Double-click to reset" onPointerDown={start} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()} onKeyDown={key} onDoubleClick={() => save(defaultWidth)}/>}
  </aside>;
}
