# Supabase database trust anchor

`supabase-prod-ca.crt` is the public Supabase Root 2021 CA, not a private key. It was downloaded over HTTPS from the [certificate URL used by Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json):

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

The certificate expires April 26, 2031. Maintenance scripts use it with certificate and hostname verification enabled, following [Supabase's SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement). `SUPABASE_DB_CA_PATH` can point to a replacement trusted certificate after an official rotation. Never disable verification to work around a connection error.
