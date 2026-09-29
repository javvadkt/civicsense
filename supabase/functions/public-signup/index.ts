import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json",
};
const SIGNUP_VERSION="enrollment-v2";
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return respond({error:"Use POST."},405);

  const url=Deno.env.get("SUPABASE_URL");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return respond({error:"Signup is not configured on the server."},500);

  try{
    const body=await req.json();
    const email=String(body.email||"").trim().toLowerCase();
    const full_name=String(body.full_name||"").trim();
    const password=String(body.password||"");
    const requested_role=String(body.requested_role||"");
    const enrollment_number=String(body.enrollment_number||"").trim();

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return respond({error:"Enter a valid email address."},400);
    if(full_name.length<2||full_name.length>100)return respond({error:"Your name must be between 2 and 100 characters."},400);
    if(password.length<8)return respond({error:"Choose a password with at least 8 characters."},400);
    if(!["student","supervisor"].includes(requested_role))return respond({error:"Choose Student or Teacher."},400);
    if(requested_role==="student"&&(enrollment_number.length<1||enrollment_number.length>40))return respond({error:"Enter an enrollment number between 1 and 40 characters."},400);

    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data,error}=await admin.auth.admin.createUser({
      email,
      password,
      email_confirm:true,
      user_metadata:{full_name,requested_role,enrollment_number:requested_role==="student"?enrollment_number:null},
    });
    if(error||!data.user)return respond({error:error?.message||"Could not create your account."},400);

    // Write the profile fields explicitly as well as setting auth metadata.
    // This keeps enrollment numbers even if the database auth trigger is stale.
    const {error:profileError}=await admin.from("profiles").upsert({
      id:data.user.id,
      full_name,
      role:"student",
      active:false,
      requested_role,
      enrollment_number:requested_role==="student"?enrollment_number:null,
    },{onConflict:"id"});
    if(profileError){
      await admin.auth.admin.deleteUser(data.user.id);
      return respond({error:`Account setup failed: ${profileError.message}`},500);
    }

    // The profile trigger and explicit upsert both leave the account inactive.
    // A super admin must activate it before any workspace data is available.
    return respond({
      message:"Account created. No email verification is needed. Wait for a super admin to activate your account.",
      signup_version:SIGNUP_VERSION,
      member:{id:data.user.id,email,full_name,requested_role,enrollment_number:requested_role==="student"?enrollment_number:null},
    },201);
  }catch(error){
    return respond({error:error instanceof Error?error.message:"Unexpected error."},500);
  }
});
