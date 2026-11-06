import {loadEnvFile} from 'node:process';
import pg from 'pg';

loadEnvFile();
if(!process.env.SUPABASE_URL?.includes('jrjkxddjwcphdmjeqyfq')||!process.env.SUPABASE_DB_PASSWORD)throw Error('Hoora Supabase project configuration is required.');

const client=new pg.Client({host:'aws-0-ap-south-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.jrjkxddjwcphdmjeqyfq',password:process.env.SUPABASE_DB_PASSWORD,ssl:{rejectUnauthorized:false}});
const notes={
 'Booking flow clarity':`The booking flow in this **sample release** explains service choices before checkout. A customer can compare available slots, understand what a package includes, and review the selected vehicle on the same screen.

### What changed

- Package details stay visible while the customer chooses a slot.
- The slot list separates the earliest available options from later dates.
- The review step shows the selected service, vehicle, address and estimated time together.
- If a slot becomes unavailable, the customer stays in the flow and can pick another.

### Example journey

1. Open **Auto Care** and choose a service package.
2. Select the vehicle and confirm the service address.
3. Compare available slots and select a convenient time.
4. Review the complete booking summary before placing the request.
5. Return to the request screen to see the next step.

This example shows how a long contribution appears in the release reader. A real contributor can write several pages of Markdown, including headings, lists, tables, images and links. The content stays inside this one Auto Care section rather than being squeezed into a short summary card.

### Points for review

| Scenario | Expected guidance |
| --- | --- |
| No slots available today | Offer the next available date without losing the selected package. |
| Vehicle changed | Refresh package compatibility before checkout. |
| Address changed | Recheck service coverage and available times. |

> Sample content for layout and workflow testing. This is not a real product announcement.`,
 'Service progress details':`This sample contribution explains how a customer can follow a service request after it is accepted. The status page groups updates around inspection, work in progress and handover.

### Reading the status

- **Inspection:** the workshop reviews the vehicle and records the planned work.
- **Work in progress:** the customer sees the current step and any action needed from them.
- **Handover:** the final summary explains completed work and the next recommended action.

When an update requires attention, the page should show the responsible team and a clear next step. Internal notes stay separate from customer-facing copy. This is sample text used to verify multi-paragraph release sections and contributor attribution.`,
 'Accessory compatibility':`This sample contribution places compatibility guidance beside a product rather than hiding it at checkout. The guidance can use the selected vehicle to help the customer understand fitment before buying.

### Product information

1. Display the product category and essential details.
2. Show compatibility for the currently selected vehicle.
3. Explain why a product is unavailable when there is no match.
4. Keep a link to the relevant support document for unusual cases.

The release reader should preserve headings and numbered steps from the contributor's Markdown. This example does not describe an actual shipped feature.`,
 'Advisor follow-up queue':`This sample contribution shows how a service advisor could see the next action and due time for each open request. It represents a separate team contribution to the **same Customer App version**.

### Queue states

- New request awaiting a first response.
- Customer follow-up waiting for an advisor.
- Workshop update ready to share.
- Completed request waiting for a final check.

The advisor name and contribution date remain attached to this section after publication. This is sample content only.`,
};

await client.connect();
try{
 await client.query('begin');
 const {rows:[page]}=await client.query("select p.id,p.version,p.tags from public.docs_pages p join public.docs_published d on d.id=p.id where p.slug=$1 and p.kind='release' and 'sample'=any(p.tags) and 'sample'=any(d.tags) for update of p,d",['sample-customer-app-5-11-0']);
 if(!page)throw Error('The labeled Customer App sample release is missing. Run npm run seed:demo first.');
 const {rows:entries}=await client.query('select id,title,author_name from public.docs_entries where release_id=$1',[page.id]);
 for(const [title,body] of Object.entries(notes)){
  const entry=entries.find(row=>row.title===title&&row.author_name?.includes('(sample)'));
  if(!entry)throw Error(`Missing labeled sample contribution: ${title}`);
  await client.query('update public.docs_entries set body=$1 where id=$2',[body,entry.id]);
 }
 const {rows:[published]}=await client.query('select release_snapshot from public.docs_published where id=$1 for update',[page.id]);
 const snapshot=published.release_snapshot;
 snapshot.entries=snapshot.entries.map(entry=>({...entry,body:notes[entry.title]||entry.body}));
 const body=snapshot.entries.map(entry=>`## ${entry.vertical}\n\n### ${entry.title}\n\n${entry.body}\n\nAdded by ${entry.author}`).join('\n\n');
 await client.query('update public.docs_pages set body=$1 where id=$2',[body,page.id]);
 const {rows:[updated]}=await client.query('select revision from public.docs_pages where id=$1',[page.id]);
 await client.query('update public.docs_published set body=$1,release_snapshot=$2,revision=$3 where id=$4',[body,JSON.stringify(snapshot),updated.revision,page.id]);
 await client.query('commit');
 console.log('Expanded the labeled Customer App sample release. No employee document or notification was changed.');
}catch(error){await client.query('rollback');throw error;}finally{await client.end();}
