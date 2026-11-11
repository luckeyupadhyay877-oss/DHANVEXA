import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
if((process.env.JWT_SECRET||'').length<32){console.error('Set JWT_SECRET in .env first.');process.exit(1);}
for(const [email,role,name] of [['owner@dhanvexa.local','OWNER','Dhanvexa Owner'],['admin@dhanvexa.local','ADMIN','Dhanvexa Admin']]){
 const passwordHash=await bcrypt.hash('ChangeMe123!',12);
 await prisma.user.upsert({where:{email},update:{passwordHash,role,name},create:{email,role,name,passwordHash}});
}
console.log('Seed users created. Change both demo passwords immediately.');
await prisma.$disconnect();
