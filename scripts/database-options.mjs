import { readFileSync } from 'node:fs';
/** Local maintenance always verifies Supabase's certificate and hostname. */
export function databaseOptions(env = process.env) {
  const project = 'jrjkxddjwcphdmjeqyfq';
  if (env.SUPABASE_URL !== `https://${project}.supabase.co` || !env.SUPABASE_DB_PASSWORD)
    throw Error('Hoora Supabase database configuration is required.');
  const certificate =
    env.SUPABASE_DB_CA_PATH || new URL('./certificates/supabase-prod-ca.crt', import.meta.url);
  return {
    host: env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.' + project,
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: true, ca: readFileSync(certificate, 'utf8') },
    connectionTimeoutMillis: 15000,
  };
}
