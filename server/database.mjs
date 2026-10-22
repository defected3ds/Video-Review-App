import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export function localDatabase(data) {
const db = new DatabaseSync(path.join(data, 'review.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, filename TEXT, size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'In review', duration REAL NOT NULL DEFAULT 0, fps REAL NOT NULL DEFAULT 25, poster TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), author TEXT NOT NULL, body TEXT NOT NULL, time REAL NOT NULL, frame INTEGER, annotations TEXT NOT NULL DEFAULT '[]', hotspot TEXT, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reviews (token TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), expires_at INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,nickname TEXT NOT NULL,nickname_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER);`);
// Keep databases created by the initial scaffold usable.
for (const [table, column, type] of [['comments','hotspot','TEXT'],['comments','frame','INTEGER'],['comments','annotations',"TEXT NOT NULL DEFAULT '[]'"],['assets','fps','REAL NOT NULL DEFAULT 25'],['reviews','expires_at','INTEGER'],['sessions','profile_id','TEXT REFERENCES profiles(id) ON DELETE SET NULL']]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
if (!db.prepare('SELECT id FROM projects LIMIT 1').get() && !db.prepare('SELECT id FROM owner').get()) {
  db.prepare('INSERT INTO projects (id,name,description) VALUES (?,?,?)').run('launch','Autumn campaign','Brand films and campaign feedback');
  db.prepare('INSERT INTO projects (id,name,description) VALUES (?,?,?)').run('guides','Installation guides','Product and installation videos');
  db.prepare('INSERT INTO assets (id,project_id,name,duration,poster) VALUES (?,?,?,?,?)').run('demo','launch','Welcome — sample video.mp4',8,'demo');
  db.prepare('INSERT INTO comments (id,asset_id,author,body,time,frame,hotspot) VALUES (?,?,?,?,?,?,?)').run('welcome','demo','Pipelife team','Try this pin: click the timestamp to return to this frame. Add your own feedback with Pin comment or Pencil.',2,50,JSON.stringify({x:0.62,y:0.5}));
}

  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  return {
    remote: false,
    owner: () => get('SELECT * FROM owner'),
    createOwner: value => run('INSERT INTO owner VALUES (1,?,?,?)',value.name,value.salt,value.password_hash),
    updateOwnerName: name => run('UPDATE owner SET name=? WHERE id=1',name),
    updatePassword: (salt,passwordHash) => run('UPDATE owner SET salt=?,password_hash=? WHERE id=1',salt,passwordHash),
    profile: id => get('SELECT * FROM profiles WHERE id=?',id),
    profileByKey: key => get('SELECT * FROM profiles WHERE nickname_key=?',key),
    profiles: () => all('SELECT id,nickname,created_at,last_seen_at FROM profiles ORDER BY last_seen_at DESC'),
    createProfile: value => run('INSERT INTO profiles (id,nickname,nickname_key) VALUES (?,?,?)',value.id,value.nickname,value.nickname_key),
    updateProfile: (id,nickname,nicknameKey) => run('UPDATE profiles SET nickname=?,nickname_key=? WHERE id=?',nickname,nicknameKey,id),
    touchProfile: (id,now) => run('UPDATE profiles SET last_seen_at=? WHERE id=?',now,id),
    session: (token,now) => get('SELECT token,profile_id FROM sessions WHERE token=? AND expires_at>?',token,now),
    clearSessions: now => run('DELETE FROM sessions WHERE expires_at<?',now),
    createSession: (token,expires,profileId=null) => run('INSERT INTO sessions (token,expires_at,profile_id) VALUES (?,?,?)',token,expires,profileId),
    deleteSession: token => run('DELETE FROM sessions WHERE token=?',token),
    clearAllSessions: () => run('DELETE FROM sessions'),
    projects: () => all('SELECT p.*, (SELECT count(*) FROM assets WHERE project_id=p.id) AS asset_count FROM projects p ORDER BY created_at,p.rowid'),
    project: id => get('SELECT * FROM projects WHERE id=?',id),
    createProject: (id,name) => run('INSERT INTO projects (id,name) VALUES (?,?)',id,name),
    deleteProject: id => {
      db.exec('BEGIN');
      try {
        run('DELETE FROM comments WHERE asset_id IN (SELECT id FROM assets WHERE project_id=?)',id);
        run('DELETE FROM reviews WHERE asset_id IN (SELECT id FROM assets WHERE project_id=?)',id);
        run('DELETE FROM assets WHERE project_id=?',id);run('DELETE FROM projects WHERE id=?',id);
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    assets: id => all('SELECT a.*, (SELECT count(*) FROM comments WHERE asset_id=a.id AND resolved=0) AS comment_count FROM assets a WHERE project_id=? ORDER BY created_at,a.rowid',id),
    reviewAssets: () => all('SELECT a.*,p.name AS project_name,(SELECT count(*) FROM comments WHERE asset_id=a.id AND resolved=0) AS comment_count FROM assets a JOIN projects p ON p.id=a.project_id ORDER BY a.created_at DESC,a.rowid DESC'),
    asset: id => get('SELECT * FROM assets WHERE id=?',id),
    createAsset: value => run('INSERT INTO assets (id,project_id,name,filename,size,duration,fps,poster) VALUES (?,?,?,?,?,?,?,?)',value.id,value.project_id,value.name,value.filename,value.size,value.duration,value.fps,value.poster),
    deleteAsset: id => {
      db.exec('BEGIN');
      try {
        run('DELETE FROM comments WHERE asset_id=?',id);run('DELETE FROM reviews WHERE asset_id=?',id);run('DELETE FROM assets WHERE id=?',id);
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    replaceVideo: (id,previous,value) => run('UPDATE assets SET filename=?,size=?,name=? WHERE id=? AND filename=?',value.filename,value.size,value.name,id,previous).changes,
    moveAsset: (id,previous,project) => run('UPDATE assets SET project_id=? WHERE id=? AND project_id=?',project,id,previous).changes,
    status: (id,status) => run('UPDATE assets SET status=? WHERE id=?',status,id),
    createReview: (token,id,expires) => run('INSERT INTO reviews (token,asset_id,expires_at) VALUES (?,?,?)',token,id,expires),
    review: (token,now) => get('SELECT asset_id FROM reviews WHERE token=? AND expires_at>?',token,now),
    deleteReviews: id => run('DELETE FROM reviews WHERE asset_id=?',id),
    comments: id => all('SELECT * FROM comments WHERE asset_id=? ORDER BY time,created_at,rowid',id),
    comment: id => get('SELECT * FROM comments WHERE id=?',id),
    createComment: value => run('INSERT INTO comments (id,asset_id,author,body,time,frame,annotations,hotspot) VALUES (?,?,?,?,?,?,?,?)',value.id,value.asset_id,value.author,value.body,value.time,value.frame,value.annotations,value.hotspot),
    resolve: (asset,id,value) => run('UPDATE comments SET resolved=? WHERE id=? AND asset_id=?',Number(value),id,asset).changes,
    connection: id => get('SELECT * FROM connections WHERE id=?',id),
    saveConnection: (id,payload,expires_at=null) => run('INSERT INTO connections (id,payload,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at',id,payload,expires_at),
    consumeConnection: id => get('DELETE FROM connections WHERE id=? RETURNING *',id),
    clearConnectionStates: now => run('DELETE FROM connections WHERE expires_at<?',now),
    close: () => db.close(),
  };
}

export function supabaseDatabase({url, key, fetcher = fetch, allowLocal = false}) {
  const base = new URL(url);
  if(base.protocol !== 'https:' && !(allowLocal && base.hostname==='127.0.0.1')) throw new Error('Supabase requires HTTPS.');
  if(base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Use the Supabase project origin URL.');
  if(!key) throw new Error('SUPABASE_SECRET_KEY is required when SUPABASE_URL is set.');
  const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})};
  let profileSchema;
  async function request(table, {method='GET', filters={}, body, select='*', order, upsert=false} = {}) {
    const target=new URL(`/rest/v1/pvr_${table}`,base);
    target.searchParams.set('select',select);
    for(const [name,value] of Object.entries(filters))target.searchParams.set(name,value);
    if(order)target.searchParams.set('order',order);
    const response=await fetcher(target,{method,headers:{...headers,'Content-Type':'application/json',Prefer:`return=representation${upsert?',resolution=merge-duplicates':''}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok) {
      // Never surface provider bodies or request headers: credentials stay server-side.
      const error=new Error(`Supabase database request failed (${response.status}). Check the server credential and database schema.`);
      const detail=await response.json().catch(()=>null);
      error.schemaMissing=['PGRST205','PGRST204','42703','42P01'].includes(detail?.code);
      error.status=response.status===409?409:503;throw error;
    }
    if(response.status===204)return [];
    return response.json();
  }
  const first=async(table,filters)=> (await request(table,{filters}))[0];
  const insert=(table,body)=>request(table,{method:'POST',body});
  const remove=(table,filters)=>request(table,{method:'DELETE',filters});
  return {
    remote:true,
    profilesReady:async()=>{
      if(profileSchema&&profileSchema.expires>Date.now())return profileSchema.ready;
      let ready=true;
      try{await Promise.all([request('profiles',{select:'id',filters:{limit:'0'}}),request('sessions',{select:'profile_id',filters:{limit:'0'}})]);}catch(error){if(!error.schemaMissing)throw error;ready=false;}
      profileSchema={ready,expires:Date.now()+15000};return ready;
    },
    owner:()=>first('owner',{id:'eq.1'}),
    createOwner:value=>insert('owner',{id:1,...value}),
    updateOwnerName:name=>request('owner',{method:'PATCH',filters:{id:'eq.1'},body:{name}}),
    updatePassword:(salt,password_hash)=>request('owner',{method:'PATCH',filters:{id:'eq.1'},body:{salt,password_hash}}),
    profile:id=>first('profiles',{id:`eq.${id}`}),
    profileByKey:key=>first('profiles',{nickname_key:`eq.${key}`}),
    profiles:()=>request('profiles',{select:'id,nickname,created_at,last_seen_at',order:'last_seen_at.desc,id.asc'}),
    createProfile:value=>insert('profiles',value),
    updateProfile:(id,nickname,nickname_key)=>request('profiles',{method:'PATCH',filters:{id:`eq.${id}`},body:{nickname,nickname_key}}),
    touchProfile:(id,last_seen_at)=>request('profiles',{method:'PATCH',filters:{id:`eq.${id}`},body:{last_seen_at}}),
    session:(token,now)=>first('sessions',{token:`eq.${token}`,expires_at:`gt.${now}`}),
    clearSessions:now=>remove('sessions',{expires_at:`lt.${now}`}),
    createSession:(token,expires_at,profile_id=null)=>insert('sessions',{token,expires_at,...(profile_id?{profile_id}:{})}),
    deleteSession:token=>remove('sessions',{token:`eq.${token}`}),
    clearAllSessions:()=>remove('sessions',{expires_at:'gte.0'}),
    projects:async()=> (await request('projects',{select:'*,pvr_assets(count)',order:'created_at.asc,id.asc'})).map(({pvr_assets,...p})=>({...p,asset_count:pvr_assets[0]?.count||0})),
    project:id=>first('projects',{id:`eq.${id}`}),
    createProject:(id,name)=>insert('projects',{id,name}),
    deleteProject:id=>remove('projects',{id:`eq.${id}`}),
    assets:async id=>(await request('assets',{filters:{project_id:`eq.${id}`,'pvr_comments.resolved':'eq.0'},select:'*,pvr_comments(count)',order:'created_at.asc,id.asc'})).map(({pvr_comments,...a})=>({...a,comment_count:pvr_comments[0]?.count||0})),
    reviewAssets:async()=>(await request('assets',{filters:{'pvr_comments.resolved':'eq.0'},select:'*,project:pvr_projects(name),pvr_comments(count)',order:'created_at.desc,id.asc'})).map(({project,pvr_comments,...a})=>({...a,project_name:project?.name||'Project',comment_count:pvr_comments[0]?.count||0})),
    asset:id=>first('assets',{id:`eq.${id}`}),
    createAsset:value=>insert('assets',value),
    deleteAsset:id=>remove('assets',{id:`eq.${id}`}),
    replaceVideo:async(id,previous,value)=>(await request('assets',{method:'PATCH',filters:{id:`eq.${id}`,filename:`eq.${previous}`},body:value})).length,
    moveAsset:async(id,previous,project_id)=>(await request('assets',{method:'PATCH',filters:{id:`eq.${id}`,project_id:`eq.${previous}`},body:{project_id}})).length,
    status:(id,status)=>request('assets',{method:'PATCH',filters:{id:`eq.${id}`},body:{status}}),
    createReview:(token,asset_id,expires_at)=>insert('reviews',{token,asset_id,expires_at}),
    review:(token,now)=>first('reviews',{token:`eq.${token}`,expires_at:`gt.${now}`}),
    deleteReviews:id=>remove('reviews',{asset_id:`eq.${id}`}),
    comments:id=>request('comments',{filters:{asset_id:`eq.${id}`},order:'time.asc,created_at.asc,id.asc'}),
    comment:id=>first('comments',{id:`eq.${id}`}),
    createComment:value=>insert('comments',value),
    resolve:async(asset,id,resolved)=>(await request('comments',{method:'PATCH',filters:{id:`eq.${id}`,asset_id:`eq.${asset}`},body:{resolved:Number(resolved)}})).length,
    connection:id=>first('connections',{id:`eq.${id}`}),
    saveConnection:(id,payload,expires_at=null)=>request('connections',{method:'POST',body:{id,payload,expires_at},upsert:true}),
    consumeConnection:async id=>(await remove('connections',{id:`eq.${id}`}))[0],
    clearConnectionStates:now=>remove('connections',{expires_at:`lt.${now}`}),
    close:()=>{},
  };
}
