require('./guard-db.js');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Tables in database:', tables.map(t => t.table_name));

  const migrations = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    );
  `);
  console.log('Has _prisma_migrations:', migrations[0].exists);

  if (migrations[0].exists) {
    const records = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;
    `);
    console.log('Applied migrations in _prisma_migrations:', records);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
