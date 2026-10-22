// A display name is remembered on this browser independently of sign-in.
export const commenterNameKey='pipelife-profile-nickname';
let memoryName='';
export function commenterName(){try{return localStorage.getItem(commenterNameKey)||memoryName;}catch{return memoryName;}}
export function rememberCommenter(value){
  memoryName=value.trim().slice(0,80);
  try{localStorage.setItem(commenterNameKey,memoryName);}catch{}
  window.dispatchEvent(new CustomEvent('pipelife-commenter-change',{detail:memoryName}));
}
