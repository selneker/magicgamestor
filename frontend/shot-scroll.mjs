import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const GAMES=[{id:'pubg-mobile',name:'PUBG Mobile',slug:'pubg-mobile',active:true,sort_order:0,icon_url:'https://x/y.png',identity_fields:[],product_types:[]},{id:'free-fire',name:'Free Fire',slug:'free-fire',active:true,sort_order:1,icon_url:'https://x/z.png',identity_fields:[],product_types:[]}];
const PRODUCTS=[{id:'p1',slug:'60-uc',name:'60 UC',price:5000,old_price:5500,type:'uc',uc_amount:60,popular:true,game_id:'pubg-mobile',active:true,sort_order:0,purchasable:true},{id:'p4',slug:'prime-7',name:'Prime',price:2500,type:'prime',game_id:'pubg-mobile',active:true,sort_order:3,purchasable:true},{id:'p5',slug:'evo-x',name:'Pack évolutif',price:23500,type:'evo',game_id:'pubg-mobile',active:true,sort_order:4,purchasable:true}];
const P=process.argv[2]||'t1';
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://x');let f=join(process.cwd(),'build',decodeURIComponent(url.pathname));try{const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'text/html'});res.end(b);}catch{f=join(process.cwd(),'build','index.html');const b=await readFile(f);res.writeHead(200,{'Content-Type':'text/html'});res.end(b);}});
server.listen(0,'127.0.0.1',async()=>{const base='http://127.0.0.1:'+server.address().port;const b=await chromium.launch({executablePath:'/home/selneker/.local/chrome/chrome-linux64/chrome',args:['--no-sandbox']});
for(const vp of [{n:'1440',w:1440,h:900,m:false},{n:'390',w:390,h:844,m:true},{n:'320',w:320,h:640,m:true}]){
const ctx=await b.newContext({viewport:{width:vp.w,height:vp.h},isMobile:vp.m,hasTouch:vp.m});
const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.addInitScript("try{localStorage.setItem('mgs-theme','light');localStorage.setItem('mgs_lang','fr')}catch(e){}");
await pg.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;if(p.includes('/auth/me'))return r.fulfill({status:401,contentType:'application/json',body:'{}'});if(p.includes('/games'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(GAMES)});if(p.includes('/products'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(PRODUCTS)});return r.fulfill({status:200,contentType:'application/json',body:'[]'});});
await pg.goto(base+'/?capture',{waitUntil:'networkidle',timeout:60000});await pg.waitForTimeout(1800);
const h=await pg.evaluate(()=>document.body.scrollHeight);
// overflows horizontaux réels
const ow=await pg.evaluate(()=>{const bad=[];document.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();if(r.right>document.documentElement.clientWidth+1&&r.width>0)bad.push(el.className&&String(el.className).slice(0,60)+' r='+Math.round(r.right));});return bad.slice(0,8);});
await pg.screenshot({path:'/tmp/opencode/'+P+'-'+vp.n+'-a.png'});
for(const [name,y] of [['b',Math.floor(h*0.38)],['c',Math.floor(h*0.62)],['d',Math.floor(h*0.85)]]){await pg.evaluate(v=>window.scrollTo(0,v),y);await pg.waitForTimeout(500);await pg.screenshot({path:'/tmp/opencode/'+P+'-'+vp.n+'-'+name+'.png'});}
console.log(vp.n,'h='+h,'overflow='+(ow.length?ow.join(' ;; '):'aucun'),'errs='+errs.slice(0,3).join('|'));
await ctx.close();}
await b.close();server.close();});
