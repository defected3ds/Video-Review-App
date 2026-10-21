// Subprocess-only test adapter: Google requests go to the local fake provider.
if(!process.env.MOCK_DRIVE_URL)throw new Error('Drive test provider URL is required.');
const original=globalThis.fetch;
globalThis.fetch=(input,options={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(['oauth2.googleapis.com','www.googleapis.com'].includes(url.hostname))return original(process.env.MOCK_DRIVE_URL,{...options,headers:{...options.headers,'x-provider-url':url.href}});
  return original(input,options);
};
