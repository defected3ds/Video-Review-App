import React,{useRef} from 'react';
import {Pencil,MapPin,Check,X} from 'lucide-react';
import EmojiPicker from './EmojiPicker.jsx';
import {drawingPosition} from './DrawingFeedback.jsx';
import {clock} from './review-utils.js';
export default function FeedbackEditor({editing,onChange,onSave,onCancel,sending}){
  const input=useRef();
  function emoji(value){const el=input.current,start=el?.selectionStart??editing.body.length,end=el?.selectionEnd??start,next=editing.body.slice(0,start)+value+editing.body.slice(end);if(next.length>4000)return;onChange(next);requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+value.length,start+value.length);});}
  return <form className="pin-editor feedback-editor" aria-label="Edit feedback" style={drawingPosition(editing)} onSubmit={event=>{event.preventDefault();onSave();}} onPointerDown={event=>event.stopPropagation()}><div className="pin-editor-heading"><strong>{editing.drawing?<Pencil size={13}/>:<MapPin size={13}/>}Edit · {clock(editing.time,true)}</strong><button type="button" className="icon-button" aria-label="Cancel feedback edit" onClick={onCancel} disabled={sending}><X size={14}/></button></div><textarea ref={input} aria-label="Edited feedback text" autoFocus maxLength={4000} placeholder="Explain this feedback…" value={editing.body} onChange={event=>onChange(event.target.value)} disabled={sending}/><p className="edit-hint">{editing.drawing?'Draw to add strokes. Use Undo or Clear to redraw.':'Use Pin comment to move the pin.'} The timestamp stays the same.</p><div className="pin-editor-actions"><EmojiPicker label="Add emoji to edited feedback" disabled={sending} onSelect={emoji}/><button type="button" className="secondary" disabled={sending} onClick={onCancel}>Cancel</button><button className="primary" disabled={sending||!editing.body.trim()}><Check size={13}/>{sending?'Saving…':'Save changes'}</button></div></form>;
}
