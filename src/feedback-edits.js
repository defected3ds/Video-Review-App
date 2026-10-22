const memory=new Map();
export function feedbackEditTokens(assetId){if(memory.has(assetId))return memory.get(assetId);try{const value=JSON.parse(localStorage.getItem('pipelife-feedback-edits:'+assetId)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value)){memory.set(assetId,value);return value;}}catch{}return {};}
export function rememberFeedbackEdit(assetId,comment){
  if(!comment.editToken)return feedbackEditTokens(assetId);
  const value={...feedbackEditTokens(assetId),[comment.id]:comment.editToken};memory.set(assetId,value);
  try{localStorage.setItem('pipelife-feedback-edits:'+assetId,JSON.stringify(value));}catch{}
  return value;
}
