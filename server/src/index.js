import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',') }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const sign = u => jwt.sign({ sub: u.id, role: u.role }, JWT_SECRET, { expiresIn: '8h', issuer: 'dhanvexa-api' });
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try {
    if (!token) throw new Error('missing');
    req.user = jwt.verify(token, JWT_SECRET, { issuer: 'dhanvexa-api' });
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}
const allow = (...roles) => (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({error:'You do not have permission.'});
const safeUser = u => ({ id:u.id, name:u.name, email:u.email, phone:u.phone, role:u.role, createdAt:u.createdAt });
const products = [
 ['bank-account','Bank account','Banking','Explore savings and current account options from authorised providers.'],
 ['demat-account','Demat account','Investments','Learn about demat accounts and compare authorised broker terms.'],
 ['credit-card','Credit cards','Credit','Review fees, benefits and eligibility from issuing partners.'],
 ['personal-loan','Personal loans','Credit','Explore lender criteria and indicative loan options.'],
 ['insurance','Insurance','Protection','Connect with licensed insurance providers for product information.'],
 ['mutual-funds','Mutual funds','Investments','Learn about investment risks and regulated distribution channels.']
];
app.get('/api/health', (_req,res)=>res.json({ok:true,service:'Dhanvexa API',mode:'development-starter'}));
app.get('/api/products', async (_req,res)=>{
  const rows = await prisma.product.findMany({where:{active:true},orderBy:{name:'asc'}});
  res.json(rows);
});
app.post('/api/auth/register', async (req,res)=>{
  const schema=z.object({name:z.string().trim().min(2).max(80),email:z.string().email().max(150),phone:z.string().trim().max(20).optional(),password:z.string().min(10).max(100)});
  const parsed=schema.safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Enter a valid name, email and password (at least 10 characters).'});
  const {name,email,phone,password}=parsed.data;
  try {
    const passwordHash=await bcrypt.hash(password,12);
    const user=await prisma.user.create({data:{name,email:email.toLowerCase(),phone,passwordHash,role:'CUSTOMER'}});
    res.status(201).json({token:sign(user),user:safeUser(user)});
  } catch { res.status(409).json({error:'An account with this email may already exist.'}); }
});
app.post('/api/auth/login', async (req,res)=>{
  const parsed=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Enter your email and password.'});
  const user=await prisma.user.findUnique({where:{email:parsed.data.email.toLowerCase()}});
  if(!user || !(await bcrypt.compare(parsed.data.password,user.passwordHash))) return res.status(401).json({error:'Email or password is incorrect.'});
  res.json({token:sign(user),user:safeUser(user)});
});

const otpHash = (email, purpose, code) =>
  crypto.createHmac('sha256', JWT_SECRET)
    .update(`${email}:${purpose}:${code}`)
    .digest('hex');

app.post('/api/auth/otp/request', async (req,res) => {
  const parsed = z.object({
    email:z.string().email().max(150),
    purpose:z.enum(['LOGIN','RESET'])
  }).safeParse(req.body);

  if (!parsed.success)
    return res.status(400).json({error:'Enter a valid email and OTP purpose.'});

  const email = parsed.data.email.toLowerCase();
  const purpose = parsed.data.purpose;
  const user = await prisma.user.findUnique({where:{email}});

  if (!user)
    return res.json({ok:true,message:'If the account exists, an OTP will be sent.'});

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    return res.status(503).json({error:'Email service is not configured yet.'});

  const existing = await prisma.otpChallenge.findUnique({
    where:{email_purpose:{email,purpose}}
  });

  if (existing && Date.now() - existing.createdAt.getTime() < 60000)
    return res.status(429).json({error:'Please wait 60 seconds before requesting another OTP.'});

  const code = String(crypto.randomInt(100000,1000000));
  const codeHash = otpHash(email,purpose,code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.otpChallenge.upsert({
    where:{email_purpose:{email,purpose}},
    create:{email,purpose,codeHash,expiresAt,attempts:0},
    update:{codeHash,expiresAt,attempts:0,createdAt:new Date()}
  });

  const subject = purpose === 'LOGIN'
    ? 'Your DHANVEXA login OTP'
    : 'Your DHANVEXA password reset OTP';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        from:process.env.EMAIL_FROM,
        to:[email],
        subject,
        html:`<p>Your DHANVEXA verification code is:</p><h2>${code}</h2><p>This code expires in 10 minutes. Do not share it with anyone.</p>`
      })
    });

    if (!response.ok) {
      await prisma.otpChallenge.deleteMany({where:{email,purpose}});
      console.error('Email provider error:',await response.text());
      return res.status(502).json({error:'Could not send OTP. Please try again later.'});
    }
  } catch (error) {
    await prisma.otpChallenge.deleteMany({where:{email,purpose}});
    console.error('Email delivery error:',error);
    return res.status(502).json({error:'Could not send OTP. Please try again later.'});
  }

  res.json({ok:true,message:'OTP sent to your email. It expires in 10 minutes.'});
});

app.post('/api/auth/otp/verify-login', async (req,res) => {
  const parsed = z.object({
    email:z.string().email().max(150),
    code:z.string().regex(/^\d{6}$/)
  }).safeParse(req.body);

  if (!parsed.success)
    return res.status(400).json({error:'Enter a valid email and 6-digit OTP.'});

  const email = parsed.data.email.toLowerCase();
  const challenge = await prisma.otpChallenge.findUnique({
    where:{email_purpose:{email,purpose:'LOGIN'}}
  });

  if (!challenge || challenge.expiresAt < new Date())
    return res.status(400).json({error:'OTP is invalid or expired. Request a new one.'});

  if (challenge.attempts >= 5) {
    await prisma.otpChallenge.deleteMany({where:{email,purpose:'LOGIN'}});
    return res.status(429).json({error:'Too many incorrect attempts. Request a new OTP.'});
  }

  const expected = Buffer.from(challenge.codeHash,'hex');
  const supplied = Buffer.from(otpHash(email,'LOGIN',parsed.data.code),'hex');

  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected,supplied)) {
    await prisma.otpChallenge.update({
      where:{id:challenge.id},
      data:{attempts:{increment:1}}
    });
    return res.status(400).json({error:'OTP is incorrect.'});
  }

  const user = await prisma.user.findUnique({where:{email}});
  await prisma.otpChallenge.deleteMany({where:{email,purpose:'LOGIN'}});
  if (!user) return res.status(400).json({error:'Account not found.'});

  res.json({token:sign(user),user:safeUser(user)});
});

app.post('/api/auth/password/reset', async (req,res) => {
  const parsed = z.object({
    email:z.string().email().max(150),
    code:z.string().regex(/^\d{6}$/),
    password:z.string().min(10).max(100)
  }).safeParse(req.body);

  if (!parsed.success)
    return res.status(400).json({error:'Enter a valid email, 6-digit OTP and password of at least 10 characters.'});

  const email = parsed.data.email.toLowerCase();
  const challenge = await prisma.otpChallenge.findUnique({
    where:{email_purpose:{email,purpose:'RESET'}}
  });

  if (!challenge || challenge.expiresAt < new Date())
    return res.status(400).json({error:'OTP is invalid or expired. Request a new one.'});

  if (challenge.attempts >= 5) {
    await prisma.otpChallenge.deleteMany({where:{email,purpose:'RESET'}});
    return res.status(429).json({error:'Too many incorrect attempts. Request a new OTP.'});
  }

  const expected = Buffer.from(challenge.codeHash,'hex');
  const supplied = Buffer.from(otpHash(email,'RESET',parsed.data.code),'hex');

  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected,supplied)) {
    await prisma.otpChallenge.update({
      where:{id:challenge.id},
      data:{attempts:{increment:1}}
    });
    return res.status(400).json({error:'OTP is incorrect.'});
  }

  const passwordHash = await bcrypt.hash(parsed.data.password,12);

  await prisma.$transaction([
    prisma.user.update({where:{email},data:{passwordHash}}),
    prisma.otpChallenge.deleteMany({where:{email,purpose:'RESET'}})
  ]);

  res.json({ok:true,message:'Password changed successfully. You can now sign in.'});
});

app.get('/api/me',auth,async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.sub}});
  if(!user) return res.status(401).json({error:'Account not found.'});
  res.json(safeUser(user));
});
app.post('/api/applications',auth,allow('CUSTOMER'),async(req,res)=>{
  const parsed=z.object({productId:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Choose a product.'});
  const product=await prisma.product.findFirst({where:{id:parsed.data.productId,active:true}});
  if(!product) return res.status(404).json({error:'Product is not available.'});
  const referralCode=typeof req.body.referralCode==='string'?req.body.referralCode.trim().toUpperCase():'';
  const referrer=referralCode?await prisma.user.findFirst({where:{role:'PARTNER',partnerProfile:{referralCode,status:'APPROVED'}}}):null;
  if(referrer)await prisma.user.updateMany({where:{id:req.user.sub,referredByPartnerId:null},data:{referredByPartnerId:referrer.id}});
  const customer=await prisma.user.findUnique({where:{id:req.user.sub},select:{referredByPartnerId:true}});
  const application=await prisma.application.create({data:{reference:'DH-'+crypto.randomBytes(4).toString('hex').toUpperCase(),userId:req.user.sub,productId:product.id,partnerId:customer?.referredByPartnerId||referrer?.id||null}});
  res.status(201).json(application);
});
app.get('/api/my/applications',auth,allow('CUSTOMER'),async(req,res)=>{
  const rows=await prisma.application.findMany({where:{userId:req.user.sub},include:{product:{select:{name:true,category:true}}},orderBy:{createdAt:'desc'}});
  res.json(rows);
});

// Partner onboarding: partners are pending until an administrator approves them.
app.post('/api/partners/register',async(req,res)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(80),email:z.string().email().max(150),phone:z.string().trim().min(8).max(20),password:z.string().min(10).max(100)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Enter name, valid email, mobile and a password of at least 10 characters.'});
  const {name,email,phone,password}=parsed.data;
  try{
    const passwordHash=await bcrypt.hash(password,12);const referralCode='DH'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const user=await prisma.user.create({data:{name,email:email.toLowerCase(),phone,passwordHash,role:'PARTNER',partnerProfile:{create:{referralCode}}},include:{partnerProfile:true}});
    res.status(201).json({message:'Partner application submitted. Admin approval is required before referrals can be tracked.',user:safeUser(user),status:user.partnerProfile.status,referralCode:null});
  }catch{res.status(409).json({error:'This email may already be registered.'});}
});
app.get('/api/partner/dashboard',auth,allow('PARTNER'),async(req,res)=>{
 const profile=await prisma.partnerProfile.findUnique({where:{userId:req.user.sub}});if(!profile)return res.status(404).json({error:'Partner profile not found.'});
 const [referrals,applications,commissions,payouts]=await Promise.all([
  prisma.user.count({where:{referredByPartnerId:req.user.sub}}),prisma.application.findMany({where:{partnerId:req.user.sub},include:{user:{select:{name:true}},product:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100}),
  prisma.commission.findMany({where:{partnerId:req.user.sub},orderBy:{createdAt:'desc'}}),prisma.payout.findMany({where:{partnerId:req.user.sub},orderBy:{requestedAt:'desc'}})
 ]);
 const sum=st=>commissions.filter(c=>c.status===st).reduce((a,c)=>a+c.commissionAmount,0);
 res.json({profile:{referralCode:profile.referralCode,status:profile.status,payoutName:profile.payoutName,payoutUpi:profile.payoutUpi},referralLink:`${process.env.PUBLIC_CLIENT_URL||process.env.CLIENT_ORIGIN||'http://localhost:5173'}?ref=${profile.referralCode}`,referrals,applications,commissions,payouts,totals:{pending:sum('PENDING'),confirmed:sum('CONFIRMED'),paid:sum('PAID')}});
});
app.patch('/api/partner/payout-details',auth,allow('PARTNER'),async(req,res)=>{
 const parsed=z.object({payoutName:z.string().trim().min(2).max(80),payoutUpi:z.string().trim().max(100).optional(),payoutBankName:z.string().trim().max(80).optional(),payoutAccountLast4:z.string().regex(/^\d{4}$/).optional(),payoutIfsc:z.string().trim().max(11).optional()}).refine(x=>x.payoutUpi|| (x.payoutBankName&&x.payoutAccountLast4&&x.payoutIfsc),{message:'Add UPI or bank payout details.'}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Add a valid UPI ID or bank details (only last 4 account digits).'});
 const row=await prisma.partnerProfile.update({where:{userId:req.user.sub},data:parsed.data});res.json({ok:true,payoutName:row.payoutName});
});
app.post('/api/partner/payouts',auth,allow('PARTNER'),async(req,res)=>{
 const parsed=z.object({amount:z.number().positive().max(1000000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a valid payout amount.'});
 const [profile,confirmed,requested]=await Promise.all([prisma.partnerProfile.findUnique({where:{userId:req.user.sub}}),prisma.commission.aggregate({where:{partnerId:req.user.sub,status:'CONFIRMED'},_sum:{commissionAmount:true}}),prisma.payout.aggregate({where:{partnerId:req.user.sub,status:{in:['REQUESTED','APPROVED']}},_sum:{amount:true}})]);
 if(profile?.status!=='APPROVED')return res.status(403).json({error:'Partner approval is required.'});
 const available=(confirmed._sum.commissionAmount||0)-(requested._sum.amount||0);if(parsed.data.amount>available)return res.status(400).json({error:'Requested amount exceeds confirmed unpaid commission.'});
 const payout=await prisma.payout.create({data:{partnerId:req.user.sub,amount:parsed.data.amount}});res.status(201).json(payout);
});
app.get('/api/admin/partners',auth,allow('ADMIN','OWNER'),async(_req,res)=>res.json(await prisma.partnerProfile.findMany({include:{user:{select:{id:true,name:true,email:true,phone:true,createdAt:true}}},orderBy:{createdAt:'desc'}})));
app.patch('/api/admin/partners/:id',auth,allow('ADMIN','OWNER'),async(req,res)=>{
 const parsed=z.object({status:z.enum(['APPROVED','REJECTED','SUSPENDED']),rejectionReason:z.string().max(300).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid partner status.'});
 const row=await prisma.partnerProfile.update({where:{id:req.params.id},data:{status:parsed.data.status,rejectionReason:parsed.data.rejectionReason||null,approvedAt:parsed.data.status==='APPROVED'?new Date():null}});res.json(row);
});
app.post('/api/admin/commissions',auth,allow('ADMIN','OWNER'),async(req,res)=>{
 const parsed=z.object({applicationId:z.string().min(1),commissionAmount:z.number().positive().max(1000000),grossAmount:z.number().min(0).optional(),providerName:z.string().max(100).optional(),providerReference:z.string().max(100).optional(),note:z.string().max(500).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Provide application, provider-confirmed commission amount and details.'});
 const a=await prisma.application.findUnique({where:{id:parsed.data.applicationId}});if(!a?.partnerId)return res.status(400).json({error:'This application has no approved partner referral.'});
 const profile=await prisma.partnerProfile.findUnique({where:{userId:a.partnerId}});if(profile?.status!=='APPROVED')return res.status(400).json({error:'Referring partner is not approved.'});
 try{const c=await prisma.commission.create({data:{...parsed.data,partnerId:a.partnerId}});res.status(201).json(c);}catch{res.status(409).json({error:'A commission record already exists for this application.'});}
});
app.patch('/api/admin/commissions/:id',auth,allow('ADMIN','OWNER'),async(req,res)=>{
 const parsed=z.object({status:z.enum(['CONFIRMED','REJECTED','PAID']),note:z.string().max(500).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid commission status.'});
 const c=await prisma.commission.update({where:{id:req.params.id},data:{status:parsed.data.status,note:parsed.data.note,confirmedAt:parsed.data.status==='CONFIRMED'?new Date():undefined,paidAt:parsed.data.status==='PAID'?new Date():undefined}});res.json(c);
});
app.get('/api/admin/commissions',auth,allow('ADMIN','OWNER'),async(_req,res)=>{
 const rows=await prisma.commission.findMany({
  include:{partner:{select:{name:true,email:true}},application:{select:{reference:true}}},
  orderBy:{createdAt:'desc'},take:300
 });
 res.json(rows);
});
app.get('/api/admin/payouts',auth,allow('ADMIN','OWNER'),async(_req,res)=>{const rows=await prisma.payout.findMany({include:{partner:{select:{name:true,email:true,partnerProfile:{select:{payoutUpi:true,payoutBankName:true,payoutAccountLast4:true,payoutIfsc:true,payoutName:true}}}}},orderBy:{requestedAt:'desc'},take:300});res.json(rows);});
app.patch('/api/admin/payouts/:id',auth,allow('ADMIN','OWNER'),async(req,res)=>{
 const parsed=z.object({status:z.enum(['APPROVED','REJECTED','PAID']),paymentReference:z.string().max(120).optional(),note:z.string().max(500).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid payout update.'});
 const row=await prisma.payout.update({where:{id:req.params.id},data:{status:parsed.data.status,paymentReference:parsed.data.paymentReference,note:parsed.data.note,processedAt:['REJECTED','PAID'].includes(parsed.data.status)?new Date():undefined}});
 res.json(row);
});
app.get('/api/owner/partner-summary',auth,allow('OWNER'),async(_req,res)=>{
 const [partners,referrals,commissions,payouts]=await Promise.all([prisma.partnerProfile.count(),prisma.application.count({where:{partnerId:{not:null}}}),prisma.commission.aggregate({_sum:{commissionAmount:true}}),prisma.payout.aggregate({where:{status:{in:['REQUESTED','APPROVED']}},_sum:{amount:true}})]);
 res.json({partners,referrals,totalCommission:commissions._sum.commissionAmount||0,pendingPayouts:payouts._sum.amount||0});
});

app.get('/api/admin/summary',auth,allow('ADMIN','OWNER'),async(_req,res)=>{
  const [users,applications,pending,productsCount]=await Promise.all([
    prisma.user.count({where:{role:'CUSTOMER'}}),prisma.application.count(),
    prisma.application.count({where:{status:{in:['RECEIVED','UNDER_REVIEW','NEED_INFO']}}}),prisma.product.count({where:{active:true}})
  ]);
  res.json({users,applications,pending,products:productsCount});
});
app.get('/api/admin/users',auth,allow('ADMIN','OWNER'),async(_req,res)=>{
  const rows=await prisma.user.findMany({where:{role:'CUSTOMER'},select:{id:true,name:true,email:true,phone:true,createdAt:true},orderBy:{createdAt:'desc'},take:200});
  res.json(rows);
});
app.get('/api/admin/applications',auth,allow('ADMIN','OWNER'),async(_req,res)=>{
  const rows=await prisma.application.findMany({include:{user:{select:{name:true,email:true}},product:{select:{name:true}}},orderBy:{createdAt:'desc'},take:300});
  res.json(rows);
});
app.patch('/api/admin/applications/:id',auth,allow('ADMIN','OWNER'),async(req,res)=>{
  const parsed=z.object({status:z.enum(['RECEIVED','UNDER_REVIEW','PARTNER_PENDING','APPROVED','REJECTED','NEED_INFO']),note:z.string().max(500).optional()}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Invalid status update.'});
  try {
    const row=await prisma.application.update({where:{id:req.params.id},data:parsed.data});
    res.json(row);
  } catch { res.status(404).json({error:'Application not found.'}); }
});
app.get('/api/owner/summary',auth,allow('OWNER'),async(_req,res)=>{
  const [users,admins,applications,approved,pending]=await Promise.all([
    prisma.user.count({where:{role:'CUSTOMER'}}),prisma.user.count({where:{role:'ADMIN'}}),prisma.application.count(),
    prisma.application.count({where:{status:'APPROVED'}}),prisma.application.count({where:{status:{in:['RECEIVED','UNDER_REVIEW','NEED_INFO']}}})
  ]);
  res.json({users,admins,applications,approved,pending,financialIntegrations:'Not connected'});
});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Unexpected server error.'});});
async function start(){
  for(const [slug,name,category,description] of products){
    await prisma.product.upsert({where:{slug},update:{name,category,description},create:{slug,name,category,description}});
  }
  app.listen(PORT,()=>console.log(`Dhanvexa API listening on http://localhost:${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1)});
