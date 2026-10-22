import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export default function ProjectMenu({ disabled, hasProject, onCreate, onDelete }) {
  const [open, setOpen] = useState(false);
  const root = useRef(), trigger = useRef();
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    root.current.querySelector('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function choose(action) { setOpen(false); trigger.current?.focus(); action(); }
  function navigate(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
  }
  return <div className="project-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="icon-button" aria-label="Project options" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><Plus size={18}/></button>
    {open && <div className="project-menu-items" role="menu" aria-label="Project actions" onKeyDown={navigate}>
      <button role="menuitem" onClick={() => choose(onCreate)}><Plus size={15}/>New project</button>
      <button role="menuitem" disabled={!hasProject} onClick={() => choose(onDelete)}><Trash2 size={15}/>Delete project</button>
    </div>}
  </div>;
}
