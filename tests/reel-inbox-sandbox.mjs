// Local-only UI test service. Never deploy or use as authentication infrastructure.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();const id='11111111-1111-4111-8111-111111111111';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;create table user_roles(user_id uuid,role text);insert into auth.users values('${id}');insert into user_roles values('${id}','owner');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261006020101_reel_inbox.sql',import.meta.url),'utf8'));
const user={id,email:'inbox-test@example.invalid',role:'authenticated',aud:'authenticated',is_anonymous:false,app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.'+Buffer.from('local-test-only').toString('base64url');
createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5186');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.end();return}
  const url=new URL(req.url,'http://127.0.0.1');let body='';for await(const chunk of req)body+=chunk;
  try{
    if(url.pathname==='/auth/v1/token'){res.end(JSON.stringify({access_token:token,refresh_token:'local-test-only',token_type:'bearer',expires_in:3600,user}));return}
    if(url.pathname==='/auth/v1/user'){if(req.headers.authorization!==`Bearer ${token}`){res.statusCode=401;res.end('{}');return}res.end(JSON.stringify(user));return}
    if(url.pathname==='/rest/v1/rpc/reel_inbox_command'){
      if(req.headers.apikey!=='local-service-test-only'){res.statusCode=403;res.end('{}');return}
      const p=JSON.parse(body);const r=await db.query('select public.reel_inbox_command($1,$2,$3,$4) as result',[p.p_action,p.p_user,JSON.stringify(p.p_payload),p.p_device_hash]);res.end(JSON.stringify(r.rows[0].result));return
    }
    if(url.pathname==='/rest/v1/profiles'){res.end(JSON.stringify(req.headers.accept?.includes('object')?{id,display_name:'UI TEST',email:user.email}:[]));return}
    res.end('[]');
  }catch{res.statusCode=400;res.end(JSON.stringify({message:'local test request failed'}))}
}).listen(5187,'127.0.0.1',()=>console.log('LOCAL UI TEST backend 127.0.0.1:5187; ephemeral data only'));
