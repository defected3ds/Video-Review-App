import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export async function proxyMedia(fetchResponse,req,res,type) {
  if(req.get('range')&&!/^bytes=\d*-\d*$/.test(req.get('range')))return res.status(416).end();
  const controller=new AbortController();
  const abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
  try {
    const response=await fetchResponse(controller.signal);
    if(![200,206,416].includes(response.status)) {
      await response.body?.cancel();
      const error=new Error('The video source is unavailable. Check its storage connection and permissions.');
      error.status=response.status===404?404:503;throw error;
    }
    res.status(response.status).set({'Content-Type':type,'Cache-Control':'private, no-store','Accept-Ranges':'bytes'});
    for(const name of ['content-length','content-range'])if(response.headers.has(name))res.set(name,response.headers.get(name));
    if(response.status===416){await response.body?.cancel();return res.end();}
    if(!response.body)return res.end();
    await pipeline(Readable.fromWeb(response.body),res);
  }catch(error){if(!controller.signal.aborted)throw error;}
  finally{req.off('aborted',abort);res.off('close',abort);}
}
