import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/notifications.js";
import { announcement } from "../server/email.js";
test('Publishers and viewers cannot preview or send announcements',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server';const original=fetch;let external=0;
 try{for(const role of ['publisher','viewer']){globalThis.fetch=async url=>{if(!url.startsWith('https://test.supabase.co'))external++;return new Response(JSON.stringify(url.endsWith('/auth/v1/user')?{id:'member'}:[{id:'member',role,active:true,password_setup_complete:true}]));};for(const action of ['preview','send-test']){const res={setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;}};await handler({method:'POST',headers:{authorization:'Bearer valid-session'},body:{action,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}},res);assert.equal(res.code,403);assert.match(res.data.error,/administrators/);}}assert.equal(external,0);}finally{globalThis.fetch=original;}
});
test("Announcement template escapes contributor content and includes the public release link", () => {
  const mail = announcement(
    {
      title: "<script>alert(1)</script>",
      slug: "demo-release",
      kind: "release",
      summary: "A & B",
      published_at: "2026-11-05",
      release_snapshot: {
        entries: [
          {
            vertical: "Garage",
            title: "<img onerror=alert(1)>",
            author: "A < B",
          },
        ],
      },
    },
    { name: "Rahul Tripathi" },
  );
  assert.ok(!mail.html.includes("<script>"));
  assert.match(mail.html, /&lt;img/);
  assert.match(
    mail.html,
    /https:\/\/hoora-docs.vercel.app\/#\/doc\/demo-release/,
  );
  assert.match(mail.html, /Workspace maintained by Rahul Tripathi/);
});
test("Outlook test endpoint fixes the only recipient and saves a copy in Sent Items", async () => {
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server";
  process.env.MICROSOFT_TENANT_ID = "tenant";
  const original = fetch;
  let sent;
  globalThis.fetch = async (url, options = {}) => {
    let data = {};
    if (url.endsWith("/auth/v1/user")) data = { id: "member" };
    else if (url.includes("/docs_members"))
      data = [
        {
          id: "member",
          active: true,
          role: "admin",
          password_setup_complete: true,
          auth_source: "microsoft",
          microsoft_subject: "subject",
          name: "Rahul",
        },
      ];
    else if (url.includes("/docs_published"))
      data = [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          title: "Release",
          slug: "release",
          kind: "release",
          summary: "Changes",
          published_at: "2026-11-05",
        },
      ];
    else if (url.includes("/oidc/userinfo")) data = { sub: "subject" };
    else if (url.endsWith("/me/sendMail")) {
      sent = JSON.parse(options.body);
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify(data));
  };
  const res = {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
  try {
    const providerToken =
      "x." +
      Buffer.from(
        JSON.stringify({ tid: "tenant", scp: "User.Read Mail.Send" }),
      ).toString("base64url") +
      ".x";
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer verified-supabase-session" },
        body: {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          action: "send-test",
          requestId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          providerToken,
        },
      },
      res,
    );
    assert.equal(res.code, 200, JSON.stringify(res.data));
    assert.deepEqual(sent.message.toRecipients, [
      { emailAddress: { address: "rahul@hoora.me" } },
    ]);
    assert.equal(sent.message.ccRecipients, undefined);
    assert.equal(sent.saveToSentItems, true);
  } finally {
    globalThis.fetch = original;
  }
});
