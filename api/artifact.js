import { createHmac, timingSafeEqual } from "node:crypto";
import { serverClient, requireMember, serverKeyHeaders } from "../server/supabase.js";

const maxBytes = 10 * 1024 * 1024;
export function signTicket(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return (
    encoded +
    "." +
    createHmac("sha256", secret).update(encoded).digest("base64url")
  );
}
export function verifyTicket(ticket, secret) {
  if (typeof ticket !== "string" || ticket.length > 4096)
    throw new Error("Invalid preview link");
  const [data, signature, extra] = ticket.split(".");
  if (extra || !data || !signature) throw new Error("Invalid preview link");
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(data).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid preview link");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (!Number.isFinite(payload.expires) || payload.expires < Date.now())
    throw new Error(
      "This preview link expired. Reload the document to open it again.",
    );
  return payload;
}
export const artifactCsp =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: blob:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; connect-src https:; media-src https: data: blob:; worker-src blob:; frame-src https:; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-downloads; frame-ancestors 'self'";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const secret = process.env.ARTIFACT_SIGNING_SECRET;
    if (!secret || secret.length < 32)
      return res
        .status(503)
        .json({ error: "Artifact previews are not configured." });
    const call = serverClient();
    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!/^[a-f0-9-]{36}$/i.test(body.id || ""))
        return res.status(400).json({ error: "Invalid document" });
      let userId = null;
      if (body.draft === true) {
        const { user } = await requireMember(req, call);
        const allowed=await call('/rest/v1/rpc/docs_can_write_page_for',{method:'POST',body:JSON.stringify({document_id:body.id,viewer_id:user.id})});
        if(!allowed)return res.status(403).json({error:'Publisher access to this document is required to preview its draft.'});
        userId = user.id;
      }
      const scope = body.draft === true ? 'draft' : 'published';
      const rows = await call(
        `/rest/v1/${scope === 'draft' ? "docs_pages" : "docs_published"}?id=eq.${body.id}&select=id,format,artifact_path,revision`,
      );
      const page = rows[0];
      if (page?.format !== "html" || !page.artifact_path)
        return res.status(404).json({ error: "HTML artifact not found." });
      if(scope === 'published'){
        const isPublic = await call('/rest/v1/rpc/docs_is_public',{method:'POST',body:JSON.stringify({document_id:page.id})});
        if(!isPublic){
          const {user}=await requireMember(req,call);
          userId=user.id;
          const allowed=await call('/rest/v1/rpc/docs_can_read_published_for',{method:'POST',body:JSON.stringify({document_id:page.id,viewer_id:userId})});
          if(!allowed)return res.status(403).json({error:'This artifact has not been shared with your account.'});
        }
      }
      const ticket = signTicket(
        {
          id: page.id,
          path: page.artifact_path,
          revision: page.revision,
          userId,
          scope,
          expires: Date.now() + 5 * 60000,
        },
        secret,
      );
      return res
        .status(200)
        .json({ url: "/api/artifact?ticket=" + encodeURIComponent(ticket) });
    }
    if (req.method !== "GET")
      return res.status(405).json({ error: "Method not allowed" });
    const params = new URL(req.url, "https://hoora-docs.vercel.app")
      .searchParams;
    const ticket = verifyTicket(params.get("ticket"), secret);
    if (ticket.userId) {
      const members = await call(
        `/rest/v1/docs_members?id=eq.${ticket.userId}&select=active,password_setup_complete,role`,
      );
      if (!members[0]?.active || !members[0]?.password_setup_complete)
        return res
          .status(403)
          .json({ error: "Team access is no longer active." });
      if(ticket.scope==='draft'){
        const allowed=await call('/rest/v1/rpc/docs_can_write_page_for',{method:'POST',body:JSON.stringify({document_id:ticket.id,viewer_id:ticket.userId})});
        if(!allowed)return res.status(403).json({error:'Draft preview access was removed.'});
      }
      if(ticket.scope==='published'){
        const allowed=await call('/rest/v1/rpc/docs_can_read_published_for',{method:'POST',body:JSON.stringify({document_id:ticket.id,viewer_id:ticket.userId})});
        if(!allowed)return res.status(403).json({error:'This artifact is no longer shared with your account.'});
      }
    }
    if(ticket.scope!=='draft'&&!ticket.userId){
      const isPublic=await call('/rest/v1/rpc/docs_is_public',{method:'POST',body:JSON.stringify({document_id:ticket.id})});
      if(!isPublic)return res.status(403).json({error:'This document now requires team sign-in.'});
    }
    const rows = await call(
      `/rest/v1/${ticket.scope === 'draft' ? "docs_pages" : "docs_published"}?id=eq.${ticket.id}&select=artifact_path,revision`,
    );
    if (
      rows[0]?.artifact_path !== ticket.path ||
      rows[0]?.revision !== ticket.revision
    )
      return res.status(404).json({
        error: "This artifact changed or was unpublished. Reload the document.",
      });
    if (
      !new RegExp("^" + ticket.id + "/[a-zA-Z0-9_.-]+\\.html?$", "i").test(
        ticket.path,
      )
    )
      return res.status(400).json({ error: "Invalid artifact path." });
    const response = await fetch(
      process.env.SUPABASE_URL + "/storage/v1/object/hoora-docs/" + ticket.path,
      {
        headers: {
          ...serverKeyHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY),
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      return res.status(404).json({ error: "Artifact file not found." });
    if (Number(response.headers.get("content-length")) > maxBytes)
      return res
        .status(413)
        .json({ error: "HTML artifacts must be 10 MB or less." });
    // Both the HTTP response and the embedding iframe enforce an opaque origin.
    // Uploaded scripts can never access Hoora's cookies, storage, or parent DOM.
    res.setHeader("Content-Security-Policy", artifactCsp);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Type",
      params.has("download")
        ? "application/octet-stream"
        : "text/html; charset=utf-8",
    );
    res.setHeader(
      "Content-Disposition",
      (params.has("download") ? "attachment" : "inline") +
        '; filename="hoora-artifact.html"',
    );
    res.statusCode = 200;
    res.flushHeaders?.();
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy();
        return;
      }
      if (!res.write(chunk))
        await new Promise((resolve) => res.once("drain", resolve));
    }
    return res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    return res
      .status(error.status || 400)
      .json({ error: error.message || "Unable to open this artifact." });
  }
}
