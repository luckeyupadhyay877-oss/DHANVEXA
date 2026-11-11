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
  const application=await prisma.application.create({data:{reference:'DH-'+crypto.randomBytes(4).toString('hex').toUpperCase(),userId:req.user.sub,productId:product.id}});
  res.status(201).json(application);
});
app.get('/api/my/applications',auth,allow('CUSTOMER'),async(req,res)=>{
  const rows=await prisma.application.findMany({where:{userId:req.user.sub},include:{product:{select:{name:true,category:true}}},orderBy:{createdAt:'desc'}});
  res.json(rows);
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
