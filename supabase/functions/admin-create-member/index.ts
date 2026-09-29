import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
Deno.serve(async (req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return respond({error:"Use POST."},405);
 const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return respond({error:"Supabase function secrets are not configured."},500);
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return respond({error:"Sign in first."},401);
 try{
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userError}=await caller.auth.getUser();
  if(userError||!user)return respond({error:"Your session is invalid. Sign in again."},401);
  const {data:profile,error:profileError}=await caller.from("profiles").select("role,active").eq("id",user.id).maybeSingle();
  if(profileError||!profile?.active||profile.role!=="super_admin")return respond({error:"Only an active super admin can add members."},403);
  const body=await req.json();const email=String(body.email||"").trim().toLowerCase();const full_name=String(body.full_name||"").trim();const password=String(body.password||"");const role=String(body.role||"student");const enrollment_number=String(body.enrollment_number||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||full_name.length<2||full_name.length>100||password.length<8)return respond({error:"Enter a valid email, a name between 2 and 100 characters, and a password of at least 8 characters."},400);
  if(!["supervisor","student_leader","student"].includes(role))return respond({error:"Choose a valid member role."},400);
  if(["student","student_leader"].includes(role)&&(enrollment_number.length<1||enrollment_number.length>40))return respond({error:"Enter an enrollment number between 1 and 40 characters for students and student leaders."},400);
  const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name,enrollment_number:["student","student_leader"].includes(role)?enrollment_number:null}});
  if(createError||!created.user)return respond({error:createError?.message||"Could not create the account."},400);
  const {error:updateError}=await admin.from("profiles").update({full_name,role,active:true,requested_role:null,enrollment_number:["student","student_leader"].includes(role)?enrollment_number:null}).eq("id",created.user.id);
  if(updateError)return respond({error:`Account created, but profile setup failed: ${updateError.message}`},500);
  return respond({message:`Account created for ${email}. Share the password securely.`,member:{id:created.user.id,email,full_name,role,enrollment_number:["student","student_leader"].includes(role)?enrollment_number:null}});
 }catch(e){return respond({error:e instanceof Error?e.message:"Unexpected error."},500)}
});
