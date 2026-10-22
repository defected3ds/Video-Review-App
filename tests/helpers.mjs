import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function startServer(dataDir, overrides = {}) {
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_TOKEN_ENCRYPTION_KEY:'',B2_KEY_ID:'',B2_APPLICATION_KEY:'',B2_BUCKET_ID:'',R2_ACCOUNT_ID:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET_NAME:'',R2_TEST_ENDPOINT:'',APP_URL:'',NODE_OPTIONS:'',NODE_ENV:'test',DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:'0',...overrides},stdio:['ignore','pipe','pipe']});
  let output='';
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error(`Server failed to start: ${output}`));},10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
    child.stderr.on('data',chunk=>{output+=chunk;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(!output.match(/listening on/))reject(new Error(`Server exited ${code}: ${output}`));});
  });
  return {base,async stop(){if(child.exitCode!==null)return;const exit=once(child,'exit');child.kill('SIGTERM');await exit;}};
}

// Existing review workflow fixtures sign in as scoped guests, never as workspace owners.
export function createReviewGuest(getBase,password='review') {
  const cookies=new Map();
  return async route=>{
    const token=route.match(/^\/api\/reviews\/([^/?]+)/)?.[1];if(!token)return {};
    if(!cookies.has(token)){
      const response=await fetch(`${getBase()}/api/reviews/${token}/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});
      if(response.status===404)return {};
      if(!response.ok)throw new Error(`Review fixture sign-in failed (${response.status})`);
      cookies.set(token,response.headers.get('set-cookie').split(';')[0]);
    }
    return {cookie:cookies.get(token)};
  };
}
