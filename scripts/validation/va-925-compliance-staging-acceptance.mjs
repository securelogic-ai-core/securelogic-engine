/**
 * va-925-compliance-staging-acceptance.mjs — the #925 ruling on live staging.
 *
 * The design of this run is the point: it proves the protection is doing the
 * work rather than the fixture, by resolving the SAME requirement twice.
 *
 *   A. no obligation  -> Art-15-22 is truncated away (tier-4 floor is 37
 *                        against a nominal target of 15, so the discretionary
 *                        budget is zero and every privacy item goes)
 *   B. active obligation -> the same requirement survives, as its own protected
 *                        class, asked under the compliance domain
 *
 * Without step A, step B would prove nothing — the requirement might have
 * survived for some unrelated reason.
 *
 * Creates an obligation and engagements labelled `[VA-925 ACCEPTANCE]`, and
 * deactivates the obligation on the way out. Refuses a production database.
 */
import pg from 'pg';
import { createHmac } from 'node:crypto';
const BASE='https://securelogic-engine-staging.onrender.com/api';
const ORG='295b989a-89d6-49ec-a7ed-deb04489d068', USER='76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0';
const INTAKE={data_sensitivity:"internal",data_volume:"minimal",access_level:"none",operational_dependency:"low",
 recoverability:"hours",business_criticality:"low",regulatory_exposure:"none",regulatory_breach_notification:false,
 ai_involvement:"none",ai_autonomy:"none",hosting_model:"on_prem",fourth_party_exposure:"none",concentration:"low"};
const dbname=new URL(process.env.DATABASE_URL).pathname.slice(1);
if(/^securelogic$/i.test(dbname)){console.error('REFUSING PRODUCTION');process.exit(2);}
const b64=b=>Buffer.from(b).toString('base64url');
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:"HS256",typ:"JWT"}));
const pl=b64(JSON.stringify({sub:USER,org:ORG,role:"admin",se:1,type:"session",iat:now,exp:now+604800}));
const TOKEN=`${h}.${pl}.${createHmac("sha256",process.env.JWT_SECRET).update(`${h}.${pl}`).digest("base64url")}`;
const c=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
let fails=0,passes=0;const out=[];
const check=(r,l,ok,d)=>{ok?passes++:fails++;out.push(`${ok?'PASS':'FAIL'}  [${r}] ${l}${d===undefined?'':'  :: '+JSON.stringify(d)}`)};
async function api(m,p,body){const r=await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',authorization:`Bearer ${TOKEN}`},body:body===undefined?undefined:JSON.stringify(body)});
 const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:r.status,json:j,text:t}}
const q=async(s,p=[])=>{try{const r=await c.query(s,p);return r.rows}catch(e){out.push('QERR '+e.code+' '+(e.message||'').slice(0,90));return[]}};
out.push('DB: '+dbname);
const vend=(await q(`SELECT id FROM vendors WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,[ORG]))[0]?.id;
// a PRIVACY requirement — provably truncated at tier 4 (discretionary budget is 0)
const target=(await q(`SELECT r.id, r.reference_id FROM requirements r JOIN frameworks f ON f.id=r.framework_id
   WHERE f.organization_id=$1 AND 'privacy'=ANY(r.scope_tags) AND NOT ('core'=ANY(r.scope_tags))
   ORDER BY r.reference_id LIMIT 1`,[ORG]))[0];
out.push('TARGET requirement: '+JSON.stringify(target));
const mk=async t=>{const r=await api('POST','/vendor-engagements',{...INTAKE,vendor_id:vend,engagement_type:'targeted',title:`[VA-925 ACCEPTANCE] ${t}`});return r.json?.id??null};
const res=async id=>await api('POST',`/vendor-engagements/${id}/scope`,{});
const has=async(id,rid)=>((await q(`SELECT 1 FROM vendor_engagement_scope_items WHERE engagement_id=$1 AND requirement_id=$2`,[id,rid])).length>0);

// A. control: NO obligation -> the requirement is truncated
const eA=await mk('control, no obligation');
const rA=await res(eA);
check('A1','WITHOUT an obligation the privacy requirement is truncated away',
  !(await has(eA,target.id)),{composition:rA.json?.composition,truncated:rA.json?.truncated?{cap:rA.json.truncated.cap,dropped:rA.json.truncated.dropped_requirement_ids.length}:null});

// B. the same requirement, now reached by an ACTIVE obligation
const ob=(await q(`INSERT INTO obligations (organization_id,title,status) VALUES ($1,'[VA-925] active obligation','active') RETURNING id`,[ORG]))[0]?.id;
await q(`INSERT INTO obligation_mappings (obligation_id,requirement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[ob,target.id]);
const eB=await mk('obligation applies');
const rB=await res(eB);
const comp=rB.json?.composition??null;
check('B1','WITH an active obligation the SAME requirement survives the target',
  await has(eB,target.id),{requirement:target.reference_id,composition:comp});
check('B2','it is never named in dropped_requirement_ids',
  !(rB.json?.truncated?.dropped_requirement_ids??[]).includes(target.id),
  {dropped:(rB.json?.truncated?.dropped_requirement_ids??[]).length});
check('B3','compliance_protected is its OWN number, separate from the floor',
  comp!==null && comp.compliance_protected>=1 && comp.mandatory>=1 && comp.mandatory!==comp.compliance_protected,
  comp);
check('B4','the three-term identity holds',
  comp!==null && comp.mandatory+comp.compliance_protected+comp.discretionary===comp.total,comp);
check('B5','the overage covers BOTH protected classes',
  comp!==null && comp.mandatory_overage===Math.max(0,comp.mandatory+comp.compliance_protected-comp.nominal_target),comp);
const dom=await q(`SELECT domain,count(*)::int n FROM vendor_engagement_scope_items WHERE engagement_id=$1 AND domain IS NOT NULL GROUP BY 1`,[eB]);
check('B6','it is asked under the compliance domain',
  dom.some(d=>d.domain==='compliance'&&d.n>=1),{domains:dom});
// applicability record agrees
const ap=await q(`SELECT count(*)::int n FROM engagement_applicability WHERE engagement_id=$1 AND rule_id='S3.obligation'`,[eB]);
check('B7','#926 records the S3 applicability for the same engagement',(ap[0]?.n??0)>=1,ap[0]);

// C. 1.0.0 stays frozen
const eC=await mk('legacy 1.0.0');
await q(`UPDATE vendor_engagements SET scope_rule_version='1.0.0' WHERE id=$1`,[eC]);
const rC=await res(eC);
check('C1','a 1.0.0 engagement carries no composition and stays truncated at the cap',
  (rC.json?.composition??null)===null && rC.json?.scoped===15,
  {composition:rC.json?.composition??null,scoped:rC.json?.scoped});

await q(`UPDATE obligations SET status='not_applicable' WHERE id=$1`,[ob]);
await c.end();
console.log('\n'+out.join('\n'));
console.log(`\nRESULT: ${fails===0?'PASS':'FAIL'} ${passes}/${passes+fails}`);
process.exit(fails===0?0:1);
