import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(ROOT, 'data', 'demo.json');
const PORT = Number(process.env.PORT || 3000);
const ROLES = ['buyer','seller','logistics','finance','admin'];
const STAGES = [
  {key:'product',name:'Product & quantity'},
  {key:'pricing',name:'Pricing & currency'},
  {key:'payment',name:'Payment method & terms'},
  {key:'delivery',name:'Delivery terms (Incoterms)'},
  {key:'logistics',name:'Shipping & insurance'},
  {key:'documents',name:'Documentation & inspection'},
  {key:'agreement',name:'Final agreement'}
];
const stamp = () => new Date().toISOString();
const sampleCompanies = [
  {id:'b1',name:'Northbridge Foods Ltd (DEMO)',country:'United Kingdom',role:'buyer',rating:76,verified:'Sample reviewed'},
  {id:'s1',name:'Ghana Cocoa Co-op (DEMO)',country:'Ghana',role:'seller',rating:83,verified:'Sample reviewed'},
  {id:'s2',name:'Gulf Coast Foods Export (DEMO)',country:'Ghana',role:'seller',rating:71,verified:'Sample pending'},
  {id:'l1',name:'Atlantic Cold Chain (DEMO)',country:'Ghana',role:'logistics',rating:79,verified:'Sample reviewed'},
  {id:'f1',name:'Trade Finance Partner (DEMO)',country:'Ghana',role:'finance',rating:80,verified:'Sample reviewed'}
];
const seed = () => ({
  meta:{demo:true,createdAt:stamp(),notice:'All companies, transactions, ratings and documents are fictional. No payments are executed.'},
  companies:sampleCompanies,
  listings:[
    {id:'p1',name:'Cocoa powder (sample)',sellerId:'s1',origin:'Ghana',qty:'20 tonnes',price:35000,currency:'USD',category:'Agriculture'},
    {id:'p2',name:'Surimi / crab sticks (sample)',sellerId:'s2',origin:'International supply',qty:'1 reefer container',price:50000,currency:'USD',category:'Frozen seafood'},
    {id:'p3',name:'Shea butter (sample)',sellerId:'s1',origin:'Ghana',qty:'5 tonnes',price:18000,currency:'USD',category:'Cosmetics ingredients'}
  ],
  deals:[{
    id:'deal1',title:'Ghana cocoa → UK buyer',buyerId:'b1',sellerId:'s1',listingId:'p1',currency:'USD',createdAt:stamp(),status:'negotiating',
    stages:STAGES.map((s,i)=>({...s,status:i===0?'agreed':i===1?'pending':'not_started',revision:i===0?1:0,
       current:i===0?{text:'Cocoa powder, 20 tonnes, Ghana → UK',by:'buyer',at:stamp(),revision:1}:i===1?{text:'USD 35,000 total; subject to both parties agreeing.',by:'seller',at:stamp(),revision:1}:null,
       approvals:i===0?['buyer','seller']:[],history:i===0?[{id:randomUUID(),type:'agreement',by:'seller',text:'Both parties accepted product specification.',at:stamp()}]:i===1?[{id:randomUUID(),type:'proposal',by:'seller',text:'USD 35,000 total; subject to both parties agreeing.',at:stamp()}]:[]
    })),
    evidence:[],messages:[],audit:[{id:randomUUID(),type:'deal_created',by:'system',at:stamp(),text:'Fictional demo transaction created'}]
  }],
  inquiries:[],partnerships:[]
});
fs.mkdirSync(path.dirname(DB),{recursive:true});
if(!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seed(),null,2));
let store = JSON.parse(fs.readFileSync(DB,'utf8'));
function save(){const temp=DB+'.tmp';fs.writeFileSync(temp,JSON.stringify(store,null,2));fs.renameSync(temp,DB);}
function fail(code,message){return {code,error:message};}
function requireRole(role){if(!ROLES.includes(role)) throw fail(400,'Invalid demo role');}
function getDeal(id){const d=store.deals.find(x=>x.id===id);if(!d)throw fail(404,'Deal not found');return d;}
function stageOf(d,key){const s=d.stages.find(x=>x.key===key);if(!s)throw fail(404,'Stage not found');return s;}
function audit(d,type,role,text){d.audit.unshift({id:randomUUID(),type,by:role,at:stamp(),text});}
function parseBody(req){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>100000){reject(fail(413,'Request too large'));req.destroy();}});req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch{reject(fail(400,'Invalid JSON'));}});req.on('error',reject);});}
function reply(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'same-origin'});res.end(JSON.stringify(obj));}
function assertRole(role,allowed){requireRole(role);if(!allowed.includes(role))throw fail(403,'This role cannot perform that action');}
function assertText(value,field,max=1200){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(400,`Invalid ${field}`);return value.trim();}
function assertRevision(s,body){if(Number(body.revision)!==s.revision)throw fail(409,'Terms changed; refresh before acting');}
async function api(req,res,url){
 const role=req.headers['x-demo-role'] || 'buyer'; requireRole(role);
 const pathname=url.pathname;
 if(req.method==='GET'&&pathname==='/api/state')return reply(res,200,store);
 if(req.method==='POST'&&pathname==='/api/reset'){
  assertRole(role,['admin']); store=seed();save();return reply(res,200,{ok:true});
 }
 if(req.method==='POST'&&pathname==='/api/inquiries'){
  assertRole(role,['buyer']);const body=await parseBody(req);
  const listing=store.listings.find(x=>x.id===body.listingId);if(!listing)throw fail(404,'Listing not found');
  const message=assertText(body.message,'message',500);const inq={id:randomUUID(),by:role,listingId:listing.id,message,at:stamp()};store.inquiries.unshift(inq);save();return reply(res,201,inq);
 }
 if(req.method==='POST'&&pathname==='/api/partnerships'){
  const b=await parseBody(req);const entry={id:randomUUID(),name:assertText(b.name,'name',100),company:assertText(b.company,'company',100),type:assertText(b.type,'type',50),message:assertText(b.message,'message',500),at:stamp(),status:'new'};
  store.partnerships.unshift(entry);save();return reply(res,201,entry);
 }
 let match=pathname.match(/^\/api\/deals\/([^/]+)\/stages\/([^/]+)\/(propose|respond)$/);
 if(req.method==='POST'&&match){
  const d=getDeal(match[1]),s=stageOf(d,match[2]),action=match[3];assertRole(role,['buyer','seller']);
  const body=await parseBody(req);assertRevision(s,body);
  if(action==='propose'){
   if(s.status==='pending'&&s.current?.by!==role)throw fail(409,'Respond to the other party’s existing proposal first');
   const text=assertText(body.text,'proposed terms');s.revision++;s.current={text,by:role,at:stamp(),revision:s.revision};s.approvals=[role];s.status='pending';
   s.history.unshift({id:randomUUID(),type:'proposal',by:role,text,at:stamp(),revision:s.revision});audit(d,'stage_proposed',role,`${s.name}: ${text}`);
  }else{
   if(s.status!=='pending'||!s.current)throw fail(409,'No open proposal');
   if(s.current.by===role)throw fail(403,'Proposing party cannot accept own proposal');
   const decision=body.decision;
   if(decision==='accept'){
    s.approvals=['buyer','seller'];s.status='agreed';s.history.unshift({id:randomUUID(),type:'accepted',by:role,text:'Accepted current revision',at:stamp(),revision:s.revision});audit(d,'stage_agreed',role,s.name);
   }else if(decision==='counter'){
    const text=assertText(body.text,'counter-offer');s.revision++;s.current={text,by:role,at:stamp(),revision:s.revision};s.approvals=[role];s.status='pending';
    s.history.unshift({id:randomUUID(),type:'counter_offer',by:role,text,at:stamp(),revision:s.revision});audit(d,'stage_countered',role,`${s.name}: ${text}`);
   }else if(decision==='reject'){
    s.status='rejected';s.approvals=[];s.history.unshift({id:randomUUID(),type:'rejected',by:role,text:assertText(body.text||'Declined','reason'),at:stamp(),revision:s.revision});audit(d,'stage_rejected',role,s.name);
   }else throw fail(400,'Unknown response');
  }
  save();return reply(res,200,{stage:s,dealStatus:d.status});
 }
 match=pathname.match(/^\/api\/deals\/([^/]+)\/evidence$/);
 if(req.method==='POST'&&match){
  const d=getDeal(match[1]);assertRole(role,['buyer','seller','logistics','finance']);const b=await parseBody(req);
  const type=assertText(b.type,'evidence type',80);const note=assertText(b.note,'evidence description',500);
  const e={id:randomUUID(),type,note,by:role,at:stamp(),status:'submitted_unverified'};d.evidence.unshift(e);audit(d,'evidence_submitted',role,type);save();return reply(res,201,e);
 }
 match=pathname.match(/^\/api\/deals\/([^/]+)\/messages$/);
 if(req.method==='POST'&&match){
  const d=getDeal(match[1]);const b=await parseBody(req);const text=assertText(b.text,'message',1000);const m={id:randomUUID(),text,by:role,at:stamp()};d.messages.unshift(m);audit(d,'message',role,'Message added');save();return reply(res,201,m);
 }
 if(req.method==='POST'&&pathname==='/api/deals'){
  assertRole(role,['buyer']);const b=await parseBody(req);const listing=store.listings.find(x=>x.id===b.listingId);if(!listing)throw fail(404,'Listing not found');
  const d={id:randomUUID(),title:`${listing.name} → buyer`,buyerId:'b1',sellerId:listing.sellerId,listingId:listing.id,currency:listing.currency,createdAt:stamp(),status:'negotiating',
   stages:STAGES.map(s=>({...s,status:'not_started',revision:0,current:null,approvals:[],history:[]})),evidence:[],messages:[],audit:[]};audit(d,'deal_created',role,'New trade room opened');store.deals.unshift(d);save();return reply(res,201,d);
 }
 if(req.method==='POST'&&pathname==='/api/complete'){
  assertRole(role,['admin']);const b=await parseBody(req),d=getDeal(b.dealId);
  if(d.stages.some(s=>s.status!=='agreed'))throw fail(409,'All terms must be agreed before demo completion');
  d.status='demo_completed';audit(d,'demo_completed',role,'Demo completed; no real funds moved');save();return reply(res,200,d);
 }
 throw fail(404,'API route not found');
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const srv=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/'))return await api(req,res,url);
  if(req.method!=='GET')return reply(res,405,{error:'Method not allowed'});
  const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  const target=path.resolve(ROOT,'public',rel);
  if(!target.startsWith(path.resolve(ROOT,'public')+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile())return reply(res,404,{error:'Not found'});
  res.writeHead(200,{'Content-Type':MIME[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(target).pipe(res);
 }catch(error){const code=Number(error.code)||500;reply(res,code,{error:code===500?'Internal server error':error.error});if(code===500)console.error(error);}
});
srv.listen(PORT,()=>console.log(`Trade Trust Africa demo running: http://localhost:${PORT}`));
