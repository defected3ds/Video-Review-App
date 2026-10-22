import React, {useRef} from 'react';
import {Pencil, Check, Trash2, X} from 'lucide-react';
import EmojiPicker from './EmojiPicker.jsx';
import {clock} from './review-utils.js';

export function DrawingPaths({annotations}) {
  return annotations.map((s,i)=>s.points.length===1?<circle key={i} cx={s.points[0].x*1000} cy={s.points[0].y*1000} r="3" fill={s.color}/>:<polyline key={i} points={s.points.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} fill="none" stroke={s.color} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>);
}
export function drawingAnchor(drawing) {
  const points=drawing.annotations.flatMap(s=>s.points);
  return {x:Math.max(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y))};
}
export function drawingPosition(drawing) {
  const point=drawingAnchor(drawing);
  return {left:`clamp(8px, ${point.x*100}%, calc(100% - 250px))`,...(point.y>.5?{bottom:`clamp(8px, ${(1-point.y)*100}%, calc(100% - 190px))`}:{top:`clamp(8px, calc(${point.y*100}% + 20px), calc(100% - 190px))`})};
}
export function DrawingEditor({drawing,guest,author,onAuthor,onChange,onAccept,onDelete,onClose,sending}) {
  const input=useRef();
  function emoji(value){const el=input.current,start=el?.selectionStart??drawing.body.length,end=el?.selectionEnd??start,next=drawing.body.slice(0,start)+value+drawing.body.slice(end);if(next.length>4000)return;onChange(next);requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+value.length,start+value.length);});}
  return <form className="pin-editor drawing-editor" aria-label="Drawing feedback editor" style={drawingPosition(drawing)} onSubmit={e=>{e.preventDefault();onAccept();}} onPointerDown={e=>e.stopPropagation()}>
    <div className="pin-editor-heading"><strong><Pencil size={13}/>Drawing · {clock(drawing.time,true)}</strong><button type="button" className="icon-button" aria-label="Close drawing editor" onClick={onClose}><X size={14}/></button></div>
    {<input aria-label="Drawing author" placeholder="Your name" required maxLength={80} value={author} onChange={e=>onAuthor(e.target.value)} disabled={sending}/>}
    <textarea ref={input} aria-label="Drawing explanation" placeholder="What does this drawing mean? (optional)" maxLength={4000} value={drawing.body} onChange={e=>onChange(e.target.value)} disabled={sending}/>
    <div className="pin-editor-actions"><EmojiPicker label="Add emoji to drawing" disabled={sending} onSelect={emoji}/><button type="button" className="secondary" disabled={sending} onClick={onDelete}><Trash2 size={13}/>Delete</button><button className="primary" disabled={sending||!author.trim()}><Check size={13}/>{sending?'Saving…':'Accept drawing'}</button></div>
  </form>;
}
