import React,{useEffect,useState} from 'react';
import {UserRound,Check,X} from 'lucide-react';
import {commenterName,rememberCommenter} from './commenter.js';
import {initials} from './review-utils.js';
export default function CommenterMenu(){
  const [name,setName]=useState(commenterName),[open,setOpen]=useState(false),[draft,setDraft]=useState('');
  useEffect(()=>{const update=()=>setName(commenterName());window.addEventListener('pipelife-commenter-change',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('pipelife-commenter-change',update);window.removeEventListener('storage',update);};},[]);
  return <div className="commenter-menu"><button className="avatar" aria-label="Commenter profile" title={name?`Commenting as ${name}`:'Choose your commenter name'} onClick={()=>{setDraft(name);setOpen(!open);}}>{name?initials(name):<UserRound size={18}/>}</button>{open&&<form className="commenter-popover" aria-label="Commenter profile" onSubmit={event=>{event.preventDefault();rememberCommenter(draft);setOpen(false);}}><div><strong>Commenter name</strong><button type="button" className="icon-button" aria-label="Close commenter profile" onClick={()=>setOpen(false)}><X size={14}/></button></div><p>This browser remembers your name for comments and drawings.</p><input autoFocus required maxLength={80} aria-label="Commenter display name" autoComplete="nickname" value={draft} onChange={event=>setDraft(event.target.value)}/><button className="primary" disabled={!draft.trim()}><Check size={14}/>Save name</button></form>}</div>;
}
