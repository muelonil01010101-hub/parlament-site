const WEEK = 7 * 86400;
const headers = {"content-type":"application/json; charset=utf-8", "cache-control":"no-store", "access-control-allow-origin":"*", "access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS", "access-control-allow-headers":"content-type,x-key,x-admin-token,x-member-token", "access-control-max-age":"86400", "x-content-type-options":"nosniff"};
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers});
const err = (message, status=400) => json({error:message}, status);
const date = () => new Date().toISOString().slice(0,10);
const rand = n => { const b=new Uint8Array(n); crypto.getRandomValues(b); return [...b].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase(); };
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const unhex = s => new Uint8Array((s.match(/.{2}/g)||[]).map(x=>parseInt(x,16)));
async function hashPassword(password, saltHex, pepper) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const input = new Uint8Array(salt.length + new TextEncoder().encode(password).length);
  input.set(salt); input.set(new TextEncoder().encode(password),salt.length);
  return {salt:hex(salt), hash:hex(await crypto.subtle.sign("HMAC",key,input))};
}
async function verify(password, salt, expected, pepper) {
  const got = await hashPassword(password, salt, pepper), a=unhex(got.hash), b=unhex(expected);
  if(a.length!==b.length)return false; let diff=0; for(let i=0;i<a.length;i++)diff|=a[i]^b[i]; return diff===0;
}
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
async function notify(env, text) {
  try {
    if (env.DISCORD_WEBHOOK) await fetch(env.DISCORD_WEBHOOK,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:text})});
    if (env.TG_TOKEN && env.TG_CHAT) await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:env.TG_CHAT,text})});
  } catch (_) {}
}
async function memberByKey(db,key) { return key ? one(db,"SELECT id,nick,role,d,bio,mkey FROM members WHERE mkey=?",key.trim().toUpperCase().slice(0,12)) : null; }
async function memberBySession(db,tok) { return tok ? one(db,"SELECT m.id,m.nick,m.role,m.d,m.bio,m.mkey FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.tok=? AND s.ts>?",tok,Math.floor(Date.now()/1000)-WEEK) : null; }
async function membersJson(db, isAdmin) {
  const members=await rows(db,"SELECT id,nick,role,d,bio,mkey FROM members ORDER BY id"), achievements=await rows(db,"SELECT id,member_id,title FROM ach ORDER BY id");
  return members.map(m=>({id:m.id,nick:m.nick,role:m.role,d:m.d,bio:m.bio,...(isAdmin?{key:m.mkey}:{}),ach:achievements.filter(a=>a.member_id===m.id).map(a=>({id:a.id,title:a.title}))}));
}
async function pollsJson(db,key) {
  const me=await memberByKey(db,key), polls=await rows(db,"SELECT id,q,closed FROM polls ORDER BY id DESC");
  for(const p of polls){p.opts=await rows(db,"SELECT o.id,o.t,(SELECT COUNT(*) FROM votes v WHERE v.opt_id=o.id) n FROM opts o WHERE o.poll_id=? ORDER BY o.id",p.id);const v=me&&await one(db,"SELECT opt_id FROM votes WHERE poll_id=? AND member_id=?",p.id,me.id);p.mine=v?v.opt_id:null;}
  return polls;
}
function clean(v,n){return String(v??"").trim().slice(0,n)}
async function limited(db,k,limit,period){const now=Math.floor(Date.now()/1000),r=await one(db,"SELECT n,since FROM rate_limits WHERE k=?",k);if(r&&now-r.since<period&&r.n>=limit)return true;if(!r||now-r.since>=period)await run(db,"INSERT INTO rate_limits(k,n,since) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=1,since=excluded.since",k,1,now);else await run(db,"UPDATE rate_limits SET n=n+1 WHERE k=?",k);return false}
async function handleRequest({request,env}) {
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
  const db=env.DB, url=new URL(request.url), path=url.pathname.replace(/^\/api\/?/,"");
  let body={}; if(["POST","PUT"].includes(request.method)){try{body=await request.json();}catch{return err("Некорректные данные");} if(!body||typeof body!=="object"||Array.isArray(body))return err("Некорректные данные");}
  const token=request.headers.get("X-Admin-Token")||"";
  const session=token?await one(db,"SELECT tok FROM sessions WHERE tok=? AND ts>?",token,Math.floor(Date.now()/1000)-WEEK):null;
  const admin=!!session, memberToken=request.headers.get("X-Member-Token")||"";
  const memberSession=await memberBySession(db,memberToken);
  const key=request.headers.get("X-Key")||memberSession?.mkey||"";
  try {
    if(request.method==="GET"&&path==="news") return json(await rows(db,"SELECT id,d,t,b FROM news ORDER BY id DESC"));
    if(request.method==="GET"&&path==="rules"){const r=await one(db,"SELECT v FROM kv WHERE k='rules'");return json(r?JSON.parse(r.v):[]);}
    if(request.method==="GET"&&path==="members") return json(await membersJson(db,admin));
    if(request.method==="GET"&&path==="me"){
      const m=memberSession||await memberByKey(db,key);
      const hasPassword=!!(m&&await one(db,"SELECT member_id FROM member_auth WHERE member_id=?",m.id));
      return json({admin,member:m?.nick||null,profile:m?{id:m.id,nick:m.nick,role:m.role,d:m.d,bio:m.bio,hasPassword}:null});
    }
    if(request.method==="GET"&&path==="polls") return json(await pollsJson(db,key));
    if(request.method==="GET"&&path==="status") {
      const ip=request.headers.get("CF-Connecting-IP")||"unknown";if(await limited(db,"status:"+ip,30,600))return err("ПОДОЖДИТЕ НЕМНОГО",429);const code=clean(url.searchParams.get("code"),12).toUpperCase(); if(!code)return err("ЗАЯВКА НЕ НАЙДЕНА",404);
      const r=await one(db,"SELECT nick,d,status FROM apps WHERE code=?",code);if(!r)return err("ЗАЯВКА НЕ НАЙДЕНА",404);
      if(r.status==="accepted"){const m=await one(db,"SELECT mkey FROM members WHERE lower(nick)=lower(?)",r.nick);if(m)r.key=m.mkey;}return json(r);
    }
    if(request.method==="POST"&&path==="apply") {
      const nick=clean(body.nick,60),contact=clean(body.contact,200),about=clean(body.about,1000),ip=request.headers.get("CF-Connecting-IP")||"unknown";if(!nick)return err("ВВЕДИТЕ НИК");if(!contact)return err("УКАЖИТЕ КОНТАКТ");if(await limited(db,"apply:"+ip,5,3600))return err("СЛИШКОМ МНОГО ЗАЯВОК",429);
      if(await one(db,"SELECT id FROM apps WHERE status='new' AND lower(nick)=lower(?)",nick))return err("ЗАЯВКА С ЭТИМ НИКОМ УЖЕ НА РАССМОТРЕНИИ",409);
      const code=rand(3);await run(db,"INSERT INTO apps(d,nick,contact,about,status,code) VALUES(?,?,?,?,'new',?)",date(),nick,contact,about,code);await notify(env,`Новая заявка в клан: ${nick} (${contact})`);return json({ok:1,code});
    }
    if(request.method==="POST"&&path==="login") {
      const ip=request.headers.get("CF-Connecting-IP")||"unknown", now=Math.floor(Date.now()/1000), attempt=await one(db,"SELECT n,since FROM login_attempts WHERE ip=?",ip);
      if(attempt&&now-attempt.since<600&&attempt.n>=5)return err("ПОДОЖДИТЕ 10 МИНУТ",429);
      const password=clean(body.password,200);if(!password)return err("НЕВЕРНО",401);
      let auth=await one(db,"SELECT salt,hash FROM admin_auth WHERE id=1");
      if(!auth){if(!env.AUTH_PEPPER||!env.ADMIN_PASSWORD||password!==env.ADMIN_PASSWORD){await run(db,"INSERT INTO login_attempts(ip,n,since) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET n=CASE WHEN ?-since<600 THEN n+1 ELSE 1 END,since=CASE WHEN ?-since<600 THEN since ELSE ? END",ip,now,now,now,now);return err("НЕВЕРНО",401);}const h=await hashPassword(password,undefined,env.AUTH_PEPPER);await run(db,"INSERT OR IGNORE INTO admin_auth(id,salt,hash) VALUES(1,?,?)",h.salt,h.hash);auth=await one(db,"SELECT salt,hash FROM admin_auth WHERE id=1");}
      if(!await verify(password,auth.salt,auth.hash,env.AUTH_PEPPER)){await run(db,"INSERT INTO login_attempts(ip,n,since) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET n=CASE WHEN ?-since<600 THEN n+1 ELSE 1 END,since=CASE WHEN ?-since<600 THEN since ELSE ? END",ip,now,now,now,now);return err("НЕВЕРНО",401);}
      await run(db,"DELETE FROM login_attempts WHERE ip=?",ip);const tok=rand(32);await run(db,"INSERT INTO sessions(tok,ts) VALUES(?,?)",tok,now);return json({ok:1,token:tok});
    }
    if(request.method==="POST"&&path==="logout") {if(token)await run(db,"DELETE FROM sessions WHERE tok=?",token);return json({ok:1});}
    if(request.method==="POST"&&path==="member-login") {
      const ip=request.headers.get("CF-Connecting-IP")||"unknown";
      if(await limited(db,"member-login:"+ip,10,600))return err("СЛИШКОМ МНОГО ПОПЫТОК. ПОДОЖДИТЕ 10 МИНУТ",429);
      const suppliedKey=clean(body.key,20).toUpperCase(), nick=clean(body.nick,60), password=clean(body.password,200);
      let mem=suppliedKey?await memberByKey(db,suppliedKey):null;
      if(!mem&&nick&&password){
        mem=await one(db,"SELECT id,nick,role,d,bio,mkey FROM members WHERE lower(nick)=lower(?)",nick);
        const auth=mem&&await one(db,"SELECT salt,hash FROM member_auth WHERE member_id=?",mem.id);
        if(!auth||!env.AUTH_PEPPER||!await verify(password,auth.salt,auth.hash,env.AUTH_PEPPER))mem=null;
      }
      if(!mem)return err("КЛЮЧ ИЛИ ЛОГИН/ПАРОЛЬ НЕВЕРНЫ",401);
      const tok=rand(32);await run(db,"INSERT INTO member_sessions(tok,member_id,ts) VALUES(?,?,?)",tok,mem.id,Math.floor(Date.now()/1000));
      return json({ok:1,token:tok,member:mem.nick});
    }
    if(request.method==="POST"&&path==="member-logout") {if(memberToken)await run(db,"DELETE FROM member_sessions WHERE tok=?",memberToken);return json({ok:1});}
    if(request.method==="GET"&&path==="profile") {
      if(!memberSession)return err("ВОЙДИТЕ В АККАУНТ УЧАСТНИКА",401);
      const auth=await one(db,"SELECT member_id FROM member_auth WHERE member_id=?",memberSession.id);
      return json({...memberSession,hasPassword:!!auth});
    }
    if(request.method==="PUT"&&path==="profile") {
      if(!memberSession)return err("ВОЙДИТЕ В АККАУНТ УЧАСТНИКА",401);
      const bio=clean(body.bio,500);await run(db,"UPDATE members SET bio=? WHERE id=?",bio,memberSession.id);return json({ok:1});
    }
    if(request.method==="POST"&&path==="member-password") {
      if(!memberSession)return err("ВОЙДИТЕ В АККАУНТ УЧАСТНИКА",401);
      if(!env.AUTH_PEPPER)return err("СЕРВЕР НЕ НАСТРОЕН",500);
      const next=clean(body.password,200), current=clean(body.current,200), existing=await one(db,"SELECT salt,hash FROM member_auth WHERE member_id=?",memberSession.id);
      if(next.length<8)return err("ПАРОЛЬ ДОЛЖЕН БЫТЬ НЕ МЕНЬШЕ 8 СИМВОЛОВ");
      if(existing&&!await verify(current,existing.salt,existing.hash,env.AUTH_PEPPER))return err("ТЕКУЩИЙ ПАРОЛЬ НЕВЕРНЫЙ",401);
      const h=await hashPassword(next,undefined,env.AUTH_PEPPER);
      await run(db,"INSERT INTO member_auth(member_id,salt,hash) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash",memberSession.id,h.salt,h.hash);
      return json({ok:1});
    }
    if(request.method==="POST"&&path==="change-password") {
      if(!admin)return err("НЕТ ДОСТУПА",403);const current=clean(body.current,200), next=clean(body.password,200);if(next.length<8)return err("НОВЫЙ ПАРОЛЬ: МИНИМУМ 8 СИМВОЛОВ");
      const auth=await one(db,"SELECT salt,hash FROM admin_auth WHERE id=1");if(!auth||!await verify(current,auth.salt,auth.hash,env.AUTH_PEPPER))return err("ТЕКУЩИЙ ПАРОЛЬ НЕВЕРНЫЙ",401);
      const h=await hashPassword(next,undefined,env.AUTH_PEPPER);await run(db,"UPDATE admin_auth SET salt=?,hash=? WHERE id=1",h.salt,h.hash);await run(db,"DELETE FROM sessions");const tok=rand(32);await run(db,"INSERT INTO sessions(tok,ts) VALUES(?,?)",tok,Math.floor(Date.now()/1000));return json({ok:1,token:tok});
    }
    if(!admin)return err("НЕТ ДОСТУПА",403);
    if(request.method==="GET"&&path==="applications")return json(await rows(db,"SELECT id,d,nick,contact,about,status,code FROM apps ORDER BY id DESC"));
    if(request.method==="POST"&&path==="news"&&clean(body.t,200)) {await run(db,"INSERT INTO news(d,t,b) VALUES(?,?,?)",date(),clean(body.t,200),clean(body.b,5000));return json({ok:1});}
    let m=path.match(/^news\/(\d+)$/);if(request.method==="PUT"&&m&&clean(body.t,200)){await run(db,"UPDATE news SET t=?,b=? WHERE id=?",clean(body.t,200),clean(body.b,5000),+m[1]);return json({ok:1});}
    if(request.method==="POST"&&path==="members"&&clean(body.nick,50)){await run(db,"INSERT INTO members(nick,role,d,mkey) VALUES(?,?,?,?)",clean(body.nick,50),clean(body.role,50)||"Участник",date(),rand(3));return json({ok:1});}
    if(request.method==="PUT"&&path==="rules"){const rules=(Array.isArray(body.rules)?body.rules:[]).map(x=>clean(x,300)).filter(Boolean).slice(0,50);await run(db,"INSERT INTO kv(k,v) VALUES('rules',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",JSON.stringify(rules));return json({ok:1});}
    m=path.match(/^applications\/(\d+)\/(accept|reject)$/);if(request.method==="POST"&&m){const app=await one(db,"SELECT nick FROM apps WHERE id=?",+m[1]);if(!app)return err("Заявка не найдена",404);const accepted=m[2]==="accept";await run(db,"UPDATE apps SET status=? WHERE id=?",accepted?"accepted":"rejected",+m[1]);if(accepted&&!await one(db,"SELECT id FROM members WHERE lower(nick)=lower(?)",app.nick))await run(db,"INSERT INTO members(nick,role,d,mkey) VALUES(?,'Новичок',?,?)",app.nick,date(),rand(3));return json({ok:1});}
    if(request.method==="PUT"&&(m=path.match(/^members\/(\d+)$/))){await run(db,"UPDATE members SET role=?,bio=? WHERE id=?",clean(body.role,50)||"Участник",clean(body.bio,500),+m[1]);return json({ok:1});}
    if(request.method==="POST"&&(m=path.match(/^members\/(\d+)\/ach$/))&&clean(body.title,80)){await run(db,"INSERT INTO ach(member_id,title) VALUES(?,?)",+m[1],clean(body.title,80));return json({ok:1});}
    if(request.method==="POST"&&path==="vote") {const mem=await memberByKey(db,key);if(!mem)return err("НУЖЕН КЛЮЧ УЧАСТНИКА",403);const p=await one(db,"SELECT closed FROM polls WHERE id=?",+body.poll),o=await one(db,"SELECT id FROM opts WHERE id=? AND poll_id=?",+body.opt,+body.poll);if(!p||p.closed||!o)return err("ГОЛОСОВАНИЕ ЗАКРЫТО ИЛИ НЕ НАЙДЕНО");await run(db,"INSERT INTO votes(poll_id,member_id,opt_id) VALUES(?,?,?) ON CONFLICT(poll_id,member_id) DO UPDATE SET opt_id=excluded.opt_id",+body.poll,mem.id,+body.opt);return json({ok:1});}
    if(request.method==="POST"&&path==="polls") {const opts=(Array.isArray(body.options)?body.options:[]).map(x=>clean(x,100)).filter(Boolean).slice(0,8),q=clean(body.q,200);if(!q||opts.length<2)return err("НУЖЕН ВОПРОС И МИНИМУМ 2 ВАРИАНТА");const res=await run(db,"INSERT INTO polls(q,d) VALUES(?,?)",q,date()),id=res.meta.last_row_id;for(const o of opts)await run(db,"INSERT INTO opts(poll_id,t) VALUES(?,?)",id,o);return json({ok:1});}
    if(request.method==="POST"&&(m=path.match(/^polls\/(\d+)\/toggle$/))){await run(db,"UPDATE polls SET closed=1-COALESCE(closed,0) WHERE id=?",+m[1]);return json({ok:1});}
    m=path.match(/^(news|members|applications|ach|polls)\/(\d+)$/);if(request.method==="DELETE"&&m){const table={applications:"apps"}[m[1]]||m[1],id=+m[2];if(table==="members"){await run(db,"DELETE FROM ach WHERE member_id=?",id);await run(db,"DELETE FROM votes WHERE member_id=?",id);}if(table==="polls"){await run(db,"DELETE FROM votes WHERE poll_id=?",id);await run(db,"DELETE FROM opts WHERE poll_id=?",id);}await run(db,`DELETE FROM ${table} WHERE id=?`,id);return json({ok:1});}
    return err("Не найдено",404);
  } catch(e) { console.error(e); return err("Внутренняя ошибка сервера",500); }
}


export async function onRequest(ctx) {
  try { return await handleRequest(ctx); }
  catch (e) { console.error(e); return json({error:"Внутренняя ошибка сервера"},500); }
}

export default { fetch(request, env) { return onRequest({request, env}); } };
