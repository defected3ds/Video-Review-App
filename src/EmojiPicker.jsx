import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smile } from 'lucide-react';

const emojis = [['👍','Thumbs up'],['👎','Thumbs down'],['❤️','Heart'],['😀','Smile'],['😂','Laugh'],['😍','Love'],['👏','Applause'],['🎉','Celebrate'],['🔥','Fire'],['✅','Check'],['❌','Cross'],['👀','Eyes'],['🤔','Thinking'],['💡','Idea'],['🙏','Thank you'],['🙌','Hooray'],['😊','Happy'],['🚀','Rocket']];

export default function EmojiPicker({ onSelect, disabled, label }) {
  const trigger = useRef(), menu = useRef();
  const [open, setOpen] = useState(false), [position, setPosition] = useState({left:0,top:0});
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function toggle() {
    if (!open) { const rect = trigger.current.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(innerWidth - 244, rect.right - 236)), top: Math.max(8, Math.min(innerHeight - 164, rect.top >= 172 ? rect.top - 164 : rect.bottom + 8)) }); }
    setOpen(value => !value);
  }
  return <><button ref={trigger} type="button" className="emoji-trigger icon-button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={toggle}><Smile size={18}/></button>{open && createPortal(<div ref={menu} className="emoji-popover" role="dialog" aria-label="Choose an emoji" style={position}><span>Add an emoji</span><div className="emoji-grid">{emojis.map(([emoji,name])=><button key={emoji} type="button" aria-label={`Insert ${name} emoji`} title={name} onClick={()=>{setOpen(false);onSelect(emoji);}}>{emoji}</button>)}</div></div>,document.fullscreenElement||document.body)}</>;
}
