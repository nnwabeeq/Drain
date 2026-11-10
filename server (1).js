// Inverse Plinko: every slot costs credits. No dependencies, run with: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Drain</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Unbounded:wght@500;800&family=DM+Sans:wght@400;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{--felt:#123f35;--deep:#0a2a23;--brass:#c9a24b;--ivory:#efe6d0;--loss:#e0553f;--text:#efe6d0;--muted:#9bb5a8}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--deep);color:var(--text);font-family:'DM Sans',system-ui,sans-serif}\nmain{max-width:440px;margin:0 auto;padding:16px 16px 40px}\nh1{font-family:'Unbounded',sans-serif;font-weight:800;font-size:22px;margin:8px 0 16px}\n.bal{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px}\n.bal .n{font-family:'Unbounded',sans-serif;font-weight:500;font-size:34px;line-height:1;color:var(--brass)}\n.bal small{color:var(--muted);display:block;margin-bottom:4px}\ncanvas{width:100%;display:block;background:var(--felt);border-radius:14px}\n.bets{display:flex;gap:8px;margin:14px 0}\n.bets button{flex:1;padding:12px 0;border-radius:10px;border:1.5px solid var(--brass);background:transparent;color:var(--ivory);font:600 15px 'DM Sans'}\n.bets button[aria-pressed=true]{background:var(--brass);color:var(--deep)}\n.drop{width:100%;padding:16px;border:0;border-radius:12px;background:var(--loss);color:#fff;font:800 17px 'Unbounded';cursor:pointer}\n.drop:disabled{opacity:.5}\nbutton:focus-visible,input:focus-visible{outline:3px solid var(--ivory);outline-offset:2px}\n.msg{min-height:24px;margin:12px 0;color:var(--muted)}\n.msg b{color:var(--loss)}\n.card{background:var(--felt);border-radius:12px;padding:14px;margin-top:16px;color:var(--muted);line-height:1.5}\n.card a{color:var(--brass)}\ninput{width:100%;padding:13px;margin:6px 0;border-radius:10px;border:1.5px solid #2b5a4d;background:var(--deep);color:var(--ivory);font:16px 'DM Sans'}\n.row{display:flex;gap:8px}.row button{flex:1;padding:13px;border-radius:10px;border:1.5px solid var(--brass);background:transparent;color:var(--ivory);font:600 15px 'DM Sans'}\n.row .primary{background:var(--brass);color:var(--deep)}\n.link{background:none;border:0;color:var(--muted);text-decoration:underline;font:inherit;cursor:pointer}\n.hide{display:none}\n</style>\n</head>\n<body>\n<main>\n<h1>Drain</h1>\n\n<section id=\"auth\">\n  <input id=\"u\" placeholder=\"Username\" autocomplete=\"username\" autocapitalize=\"none\">\n  <input id=\"p\" type=\"password\" placeholder=\"Password (8+ characters)\" autocomplete=\"current-password\">\n  <div class=\"row\"><button class=\"primary\" id=\"login\">Log in</button><button id=\"register\">Create account</button></div>\n  <div class=\"msg\" id=\"autherr\" role=\"alert\"></div>\n</section>\n\n<section id=\"game\" class=\"hide\">\n  <div class=\"bal\"><div><small id=\"who\"></small><div class=\"n\" id=\"bal\">0</div></div><button class=\"link\" id=\"logout\">Log out</button></div>\n  <canvas id=\"c\"></canvas>\n  <div class=\"bets\" id=\"bets\" role=\"group\" aria-label=\"Bet size\"></div>\n  <button class=\"drop\" id=\"drop\">Drop ball</button>\n  <div class=\"msg\" id=\"msg\" aria-live=\"polite\"></div>\n  <div class=\"card\" id=\"topup\"></div>\n</section>\n</main>\n\n<script>\nconst $=id=>document.getElementById(id);\nlet cfg=null,bet=null,busy=false,landed=-1;\nconst api=async(path,data)=>{const r=await fetch(path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Something went wrong.');return j};\n\nasync function auth(kind){\n  try{cfg=await api('/api/'+kind,{username:$('u').value,password:$('p').value});enter()}\n  catch(e){$('autherr').textContent=e.message}\n}\n$('login').onclick=()=>auth('login');$('register').onclick=()=>auth('register');\n$('logout').onclick=async()=>{await api('/api/logout',{});location.reload()};\n\nfunction enter(){\n  $('auth').classList.add('hide');$('game').classList.remove('hide');\n  $('who').textContent=cfg.username;setBal(cfg.balance);\n  bet=bet&&cfg.bets.includes(bet)?bet:cfg.bets[0];\n  $('bets').innerHTML='';\n  cfg.bets.forEach(b=>{const el=document.createElement('button');el.textContent=b;el.setAttribute('aria-pressed',b===bet);\n    el.onclick=()=>{bet=b;[...$('bets').children].forEach(x=>x.setAttribute('aria-pressed',x===el))};$('bets').appendChild(el)});\n  if(cfg.demo){$('topup').innerHTML='Practice mode: credits are free. <button class=\"link\" id=\"refill\">Add 1,000 credits</button>';$('refill').onclick=async()=>{cfg=await api('/api/refill',{});setBal(cfg.balance)}}\n  else $('topup').innerHTML=`Add credits by sending a gift from the wishlist${cfg.throneUrl?` (<a href=\"${cfg.throneUrl}\" target=\"_blank\" rel=\"noopener\">open wishlist</a>)`:''} and writing <b style=\"color:var(--ivory)\">${cfg.username}</b> in the message. Every $1 gives ${cfg.creditsPerUsd} credits. Credits can't be withdrawn.`;\n  setup();draw();\n}\nconst setBal=n=>$('bal').textContent=n.toLocaleString();\n\n// ---- board ----\nconst W=360,H=520,DX=28,TOP=40,ROWH=34,cv=$('c'),ctx=cv.getContext('2d');\nlet ball=null;\nfunction setup(){const d=devicePixelRatio||1;cv.width=W*d;cv.height=H*d;cv.style.aspectRatio=W+'/'+H;ctx.setTransform(d,0,0,d,0,0)}\nconst pegX=(r,j)=>W/2+(j-r/2)*DX, rowY=r=>TOP+r*ROWH;\nfunction draw(){\n  ctx.clearRect(0,0,W,H);\n  const n=cfg.rows;\n  ctx.fillStyle='#efe6d0';\n  for(let r=0;r<n;r++)for(let j=0;j<=r;j++){ctx.beginPath();ctx.arc(pegX(r,j),rowY(r),3,0,7);ctx.fill()}\n  const sy=rowY(n)+10;\n  cfg.loss.forEach((m,i)=>{\n    const x=W/2+(i-n/2)*DX,k=Math.min(1,m/10);\n    ctx.fillStyle=i===landed?'#fff':`rgba(224,85,63,${.25+.7*k})`;\n    ctx.fillRect(x-DX/2+1.5,sy,DX-3,48);\n    ctx.fillStyle=i===landed?'#0a2a23':'#efe6d0';ctx.font='600 10px DM Sans';ctx.textAlign='center';\n    ctx.fillText('-'+m+'x',x,sy+28);\n  });\n  if(ball){ctx.fillStyle='#c9a24b';ctx.beginPath();ctx.arc(ball.x,ball.y,7,0,7);ctx.fill()}\n}\nfunction animate(dirs){\n  return new Promise(done=>{\n    const n=dirs.length,STEP=170,t0=performance.now();\n    const pts=[{x:W/2,y:rowY(0)-26}];let k=0;\n    for(let r=0;r<n;r++){pts.push({x:pegX(r,k),y:rowY(r)-8});k+=dirs[r]}\n    pts.push({x:W/2+(k-n/2)*DX,y:rowY(n)+30});\n    (function tick(now){\n      const t=Math.max(0,now-t0)/STEP,i=Math.min(Math.floor(t),pts.length-2),f=Math.min(t-i,1),a=pts[i],b=pts[i+1];\n      ball={x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f-Math.sin(f*Math.PI)*10};\n      draw();\n      if(t<pts.length-1)requestAnimationFrame(tick);else{ball=null;done()}\n    })(t0);\n  });\n}\n$('drop').onclick=async()=>{\n  if(busy)return;busy=true;$('drop').disabled=true;$('msg').textContent='';landed=-1;\n  try{\n    const r=await api('/api/drop',{bet});\n    await animate(r.dirs);landed=r.slot;draw();setBal(r.balance);cfg.balance=r.balance;\n    $('msg').innerHTML=r.lost?`Lost <b>${r.lost}</b> credits (${cfg.loss[r.slot]}x).`:'Nothing left to lose.';\n    if(r.balance<Math.min(...cfg.bets))$('msg').innerHTML+=' Add credits to keep playing.';\n  }catch(e){$('msg').textContent=e.message}\n  busy=false;$('drop').disabled=false;\n};\napi('/api/me').then(j=>{cfg=j;enter()}).catch(()=>{});\n</script>\n</body>\n</html>\n";

const PORT = +(process.env.PORT || 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me';
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-too';
const CREDITS_PER_USD = +(process.env.CREDITS_PER_USD || 100);
const THRONE_URL = process.env.THRONE_URL || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const DEMO = process.env.DEMO_MODE === '1'; // free refills, no Throne needed
const ALLOW_TEST = process.env.ALLOW_TEST === '1'; // accept Throne test events
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');

const ROWS = 10;                                   // 10 rows -> 11 slots
const LOSS = [10, 5, 3, 2, 1, 0.5, 1, 2, 3, 5, 10]; // loss multiplier per slot, biggest at the edges
const BETS = [10, 50, 100, 500];

let db = { users: {}, sessions: {}, pending: [], seen: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
const save = () => { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); };

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const tries = {};
function limited(ip) {
  const now = Date.now(), t = (tries[ip] = (tries[ip] || []).filter(x => now - x < 600000));
  if (t.length >= 15) return true; t.push(now); return false;
}

function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 20000) { req.destroy(); no(); } });
    req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } });
  });
}
function userFrom(req) {
  const m = /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = db.sessions[sha(m[1])];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.u] || null;
}
function startSession(res, uname) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(tok)] = { u: uname, exp: Date.now() + 30 * 864e5 };
  save();
  return { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${COOKIE_SECURE ? '; Secure' : ''}` };
}
const view = u => ({
  username: u.name, balance: u.balance, rows: ROWS, loss: LOSS, bets: BETS,
  creditsPerUsd: CREDITS_PER_USD, throneUrl: THRONE_URL, demo: DEMO,
});

// find a key anywhere in a nested object (Throne's exact payload shape may vary)
function find(o, keys) {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase()) && o[k] != null && typeof o[k] !== 'object') return o[k];
  for (const k of Object.keys(o)) { const r = find(o[k], keys); if (r !== undefined) return r; }
}

function handleGift(p) {
  const amount = parseFloat(find(p, ['amount', 'price']));
  const currency = String(find(p, ['currency']) || 'USD').toUpperCase();
  const message = String(find(p, ['message']) || '').toLowerCase();
  const gifter = String(find(p, ['gifter', 'sender', 'name', 'from']) || '');
  const isTest = String(find(p, ['istest'])) === 'true';
  const id = find(p, ['id', 'eventid', 'giftid']);
  if (isTest && !ALLOW_TEST) return 'test event ignored';
  if (!(amount > 0)) return 'no amount';
  if (id !== undefined) { if (db.seen[id]) return 'duplicate'; db.seen[id] = 1; }
  const credits = Math.floor(amount * CREDITS_PER_USD);
  const hits = Object.keys(db.users).filter(n => new RegExp(`(^|[^a-z0-9_])${n}($|[^a-z0-9_])`).test(message));
  if (hits.length === 1 && currency === 'USD') {
    db.users[hits[0]].balance += credits; save(); return `credited ${credits} to ${hits[0]}`;
  }
  db.pending.push({ id: crypto.randomUUID(), amount, currency, credits, message, gifter, at: Date.now() });
  save(); return 'no unique username match, saved as pending';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress;
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (url.pathname === `/webhook/throne/${WEBHOOK_SECRET}` && req.method === 'POST') {
      const r = handleGift(await body(req)); console.log('webhook:', r); return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/admin/')) {
      const b = req.method === 'POST' ? await body(req) : {};
      if ((url.searchParams.get('key') || b.key) !== ADMIN_KEY) return json(res, 403, { error: 'forbidden' });
      if (url.pathname === '/admin/pending') return json(res, 200, db.pending);
      if (url.pathname === '/admin/credit') { // {pendingId, username}
        const i = db.pending.findIndex(p => p.id === b.pendingId), u = db.users[String(b.username || '').toLowerCase()];
        if (i < 0 || !u) return json(res, 400, { error: 'bad pendingId or username' });
        u.balance += db.pending[i].credits; db.pending.splice(i, 1); save(); return json(res, 200, { balance: u.balance });
      }
    }
    if (url.pathname === '/api/register' || url.pathname === '/api/login') {
      if (req.method !== 'POST') return json(res, 405, {});
      if (limited(ip)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const b = await body(req), name = String(b.username || '').toLowerCase(), pw = String(b.password || '');
      if (url.pathname === '/api/register') {
        if (!/^[a-z0-9_]{3,20}$/.test(name)) return json(res, 400, { error: 'Username: 3-20 letters, numbers or underscores.' });
        if (pw.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
        if (db.users[name]) return json(res, 400, { error: 'That username is taken.' });
        const salt = crypto.randomBytes(16).toString('hex');
        db.users[name] = { name, salt, hash: hashPw(pw, salt), balance: DEMO ? 1000 : 0 };
        return json(res, 200, view(db.users[name]), startSession(res, name));
      }
      const u = db.users[name];
      if (!u || !crypto.timingSafeEqual(Buffer.from(hashPw(pw, u.salt)), Buffer.from(u.hash)))
        return json(res, 400, { error: 'Wrong username or password.' });
      return json(res, 200, view(u), startSession(res, name));
    }
    const user = userFrom(req);
    if (url.pathname === '/api/logout') {
      const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ''); if (m) { delete db.sessions[sha(m[1])]; save(); }
      return json(res, 200, {}, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/' });
    }
    if (!user) return json(res, 401, { error: 'Log in first.' });
    if (url.pathname === '/api/me') return json(res, 200, view(user));
    if (url.pathname === '/api/refill' && req.method === 'POST') {
      if (!DEMO) return json(res, 403, { error: 'Refills are off.' });
      user.balance += 1000; save(); return json(res, 200, view(user));
    }
    if (url.pathname === '/api/drop' && req.method === 'POST') {
      const bet = +(await body(req)).bet;
      if (!BETS.includes(bet)) return json(res, 400, { error: 'Invalid bet.' });
      if (user.balance < bet) return json(res, 400, { error: 'Not enough credits.' });
      const dirs = Array.from({ length: ROWS }, () => crypto.randomInt(2)); // 0 left, 1 right
      const slot = dirs.reduce((a, b) => a + b, 0);
      const lost = Math.min(Math.round(bet * LOSS[slot]), user.balance);
      user.balance -= lost; save();
      return json(res, 200, { dirs, slot, lost, balance: user.balance });
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); json(res, 500, { error: 'Server error' }); }
});
server.listen(PORT, () => console.log(`Plinko on http://localhost:${PORT}`));
