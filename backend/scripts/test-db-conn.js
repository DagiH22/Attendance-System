const { PrismaClient } = require('@prisma/client');
require('./guard-db.js');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRawUnsafe('SELECT current_database(), current_user, inet_server_addr(), inet_server_port();');
  console.log('Successfully connected to Postgres:', result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
