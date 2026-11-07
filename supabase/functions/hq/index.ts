import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI = Deno.env.get('GEMINI_API_KEY') || '';
const CRON = Deno.env.get('HQ_CRON_SECRET') || '';
const db = createClient(URL, SERVICE, {auth:{persistSession:false}});
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-hq-cron','Access-Control-Allow-Methods':'POST,OPTIONS'};
const response = (data:unknown,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{...cors,'Content-Type':'application/json'}});
const roles = [
 'World Scanner: research priorities, distinguish verified and unknown information',
 'Chief of Staff: executive briefing and decisions based on recorded results',
 'Audience Research: Marvel/DC movie commentary viewer demand and packaging evidence',
 'Production: filming, editing, quality control, creator-approved scripts',
 'Creative Director: exactly three titles under 60 characters with counts; one non-AI thumbnail concept',
 'Business Manager: user-provided revenue, costs, and monetization experiments',
 'Acting Agent: audition preparation and verifiable casting research plan',
 'Learning Coach: measurable SKILLPATH learning sprints',
 'Personal CRM: only user-provided contacts, no unsolicited outreach',
 'Life Manager: priorities and scheduling using provided dates only'
];
async function execute(job:any){
 const {data:claimed,error:claimError}=await db.from('hq_jobs').update({status:'running',updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','queued').select().maybeSingle();
 if(claimError||!claimed)return;
 try {
  if(!GEMINI)throw new Error('Gemini key not configured');
  const {data:prior}=await db.from('hq_jobs').select('agent,objective,result').eq('owner',job.owner).eq('status','completed').order('created_at',{ascending:false}).limit(5);
  const context=(prior||[]).map(x=>`${roles[x.agent]}\n${x.objective}\n${(x.result||'').slice(0,1000)}`).join('\n\n');
  const prompt=`You are the EliMatic HQ specialist: ${roles[job.agent]}.\nCEO retains all creative and financial decisions. You do NOT have web browsing, YouTube Analytics, calendar, casting portal, or email access. Never fabricate external facts or pretend to have performed external actions. Mark unknowns. No external messages, payments, publishing, applications or edits.\nMission: ${job.objective}\nRelevant prior completed reports (may be unrelated): ${context}\nReturn a concise evidence-aware action report.`;
  const res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.3,maxOutputTokens:2000}})});
  if(!res.ok)throw new Error(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data=await res.json();const result=(data.candidates?.[0]?.content?.parts||[]).map((p:any)=>p.text||'').join('');
  if(!result)throw new Error('No model output');
  await db.from('hq_jobs').update({status:'completed',result,updated_at:new Date().toISOString()}).eq('id',job.id);
 } catch(e){await db.from('hq_jobs').update({status:'error',error:String(e).slice(0,500),updated_at:new Date().toISOString()}).eq('id',job.id);}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 try{
  const body=await req.json();
  if(body.action==='tick'){
   if(!CRON||req.headers.get('x-hq-cron')!==CRON)return response({error:'Forbidden'},403);
   const now=new Date().toISOString();
   const {data:due,error:dueErr}=await db.from('hq_schedules').select('*').eq('enabled',true).lte('next_run',now).limit(20);
   if(dueErr)throw dueErr;
   for(const s of due||[]){
    const next=new Date(Math.max(Date.now(),new Date(s.next_run).getTime())+s.every_hours*3600000).toISOString();
    const {data:locked}=await db.from('hq_schedules').update({next_run:next}).eq('id',s.id).eq('next_run',s.next_run).select('id').maybeSingle();
    if(locked)await db.from('hq_jobs').insert({owner:s.owner,agent:s.agent,objective:s.objective,status:'queued'});
   }
   const {data:jobs}=await db.from('hq_jobs').select('*').eq('status','queued').order('created_at').limit(20);
   let executed=0;
   for(const job of jobs||[]){
    if(job.parent){const {data:parent}=await db.from('hq_jobs').select('status').eq('id',job.parent).maybeSingle();if(parent?.status!=='completed')continue;}
    await execute(job);executed++;
    if(executed>=2)break; // bounded execution for serverless time limits
   }
   return response({ok:true,created:(due||[]).length,executed});
  }
  const auth=req.headers.get('Authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!token)return response({error:'Sign in required'},401);
  const client=createClient(URL,ANON,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error:userErr}=await client.auth.getUser(token);
  if(userErr||!user)return response({error:'Unauthorized'},401);
  const owner=user.id;
  if(body.action==='create_job'){
   if(!Number.isInteger(body.agent)||body.agent<0||body.agent>9||typeof body.objective!=='string'||body.objective.trim().length<5||body.objective.length>10000)return response({error:'Invalid job'},400);
   const {data,error}=await db.from('hq_jobs').insert({owner,agent:body.agent,objective:body.objective,status:'queued'}).select('id').single();if(error)throw error;return response(data);
  }
  if(body.action==='schedule'){
   const hours=Number(body.every_hours);
   if(!Number.isInteger(body.agent)||body.agent<0||body.agent>9||!Number.isInteger(hours)||hours<1||hours>720||typeof body.objective!=='string'||body.objective.trim().length<5||body.objective.length>10000)return response({error:'Invalid schedule'},400);
   const {data,error}=await db.from('hq_schedules').insert({owner,agent:body.agent,objective:body.objective,every_hours:hours,next_run:new Date(Date.now()+hours*3600000).toISOString()}).select('id').single();if(error)throw error;return response(data);
  }
  if(body.action==='approve'||body.action==='cancel'){
   if(typeof body.id!=='string')return response({error:'Missing job ID'},400);
   const status=body.action==='approve'?'queued':'cancelled';const from=body.action==='approve'?'pending_approval':['queued','pending_approval'];
   let q=db.from('hq_jobs').update({status,updated_at:new Date().toISOString()}).eq('owner',owner).eq('id',body.id);
   q=typeof from==='string'?q.eq('status',from):q.in('status',from);
   const {data,error}=await q.select('id').maybeSingle();if(error)throw error;return response({ok:!!data});
  }
  if(body.action==='toggle_schedule'){
   if(typeof body.id!=='string'||typeof body.enabled!=='boolean')return response({error:'Invalid schedule toggle'},400);
   const {data,error}=await db.from('hq_schedules').update({enabled:body.enabled}).eq('owner',owner).eq('id',body.id).select('id').maybeSingle();if(error)throw error;return response({ok:!!data});
  }
  if(body.action==='workflow'){
   const flows:Record<string,[number,string][]>= {
    youtube:[[2,'Identify evidence needed to validate Marvel/DC movie commentary opportunities.'],[4,'Propose three title options and one human-made thumbnail concept.'],[3,'Produce an approved-video filming and editing plan.']],
    acting:[[0,'Identify credible acting research priorities and official casting sources.'],[6,'Prepare an audition readiness checklist and tracker.'],[9,'Prepare a realistic audition practice schedule.']],
    business:[[0,'Define market validation research for an EliMatic digital product.'],[5,'Assess user-supplied costs and revenue hypotheses.'],[1,'Prepare a decision memo with validation next steps.']]
   };
   const flow=flows[body.type];if(!flow)return response({error:'Unknown workflow'},400);
   const ids:string[]=[];
   for(let i=0;i<flow.length;i++){
    const [agent,objective]=flow[i];const {data,error}=await db.from('hq_jobs').insert({owner,agent,objective,status:i?'pending_approval':'queued',parent:i?ids[i-1]:null}).select('id').single();if(error)throw error;ids.push(data.id);
   }
   return response({ids});
  }
  return response({error:'Unknown action'},400);
 }catch(e){return response({error:String(e).slice(0,500)},500);}
});
