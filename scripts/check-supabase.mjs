import { supabaseDatabase } from '../server/database.mjs';
try {
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)throw new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in secure environment settings first.');
  const db=supabaseDatabase({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY});
  await db.owner();await db.projects();await db.connection('schema-check-not-a-record');
  console.log('Supabase connection and application schema verified. No records changed.');
} catch(error) {
  // Do not print request details, headers, environment values, or provider bodies.
  console.error(error.message.startsWith('Supabase')||error.message.startsWith('Configure')?error.message:'Supabase connectivity failed. Check the network policy and project availability.');
  process.exitCode=1;
}
