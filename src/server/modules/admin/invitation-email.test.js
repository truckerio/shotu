import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sendInvitationEmail } from "../../email/invitation.js";

test("invitation email sends the secure join link with role and location context", async () => {
  let message;
  const result = await sendInvitationEmail({
    invitation: {
      name: "Taylor <Ops>",
      email: "surveillance@example.com",
      role: "surveillance",
    },
    inviteUrl: "https://workorders.example.com/?invite=secure-token&source=admin",
    locationNames: ["Chino <Yard>", "Chino <Yard>"],
  }, {
    mailer: {
      enabled: true,
      async send(input) {
        message = input;
      },
    },
  });

  assert.deepEqual(result, { status: "sent" });
  assert.equal(message.to, "surveillance@example.com");
  assert.equal(message.subject, "You're invited to Workorder");
  assert.match(message.text, /join Workorder as Surveillance/);
  assert.match(message.text, /Chino <Yard>/);
  assert.match(message.text, /expires in 7 days/);
  assert.match(message.html, /Taylor &lt;Ops&gt;/);
  assert.match(message.html, /Chino &lt;Yard&gt;/);
  assert.match(message.html, /invite=secure-token&amp;source=admin/);
  assert.doesNotMatch(message.html, /Taylor <Ops>/);
});

test("invitation creation reports when SMTP is unavailable without pretending it sent", async () => {
  let called = false;
  const result = await sendInvitationEmail({
    invitation: { name: "Taylor", email: "user@example.com", role: "office" },
    inviteUrl: "https://workorders.example.com/?invite=secure-token",
  }, {
    mailer: {
      enabled: false,
      async send() {
        called = true;
      },
    },
  });

  assert.deepEqual(result, { status: "not_configured" });
  assert.equal(called, false);
});

test("SMTP failure preserves a safe fallback status without exposing provider details", async () => {
  let logged;
  const result = await sendInvitationEmail({
    invitation: { name: "Taylor", email: "user@example.com", role: "admin" },
    inviteUrl: "https://workorders.example.com/?invite=secure-token",
  }, {
    mailer: {
      enabled: true,
      async send() {
        const error = new Error("Authentication failed for secret-password");
        error.code = "EAUTH";
        throw error;
      },
    },
    onError(details) {
      logged = details;
    },
  });

  assert.deepEqual(result, { status: "failed" });
  assert.deepEqual(logged, { code: "EAUTH", name: "Error" });
  assert.doesNotMatch(JSON.stringify(logged), /secret-password/);
});

test("create and resend invitation services both attempt automatic delivery", async () => {
  const source = await readFile(new URL("./admin.service.js", import.meta.url), "utf8");
  const createBody = source.slice(
    source.indexOf("export async function inviteLocationUser"),
    source.indexOf("export async function resendLocationInvitation"),
  );
  const resendBody = source.slice(
    source.indexOf("export async function resendLocationInvitation"),
    source.indexOf("export async function invitationDetail"),
  );

  assert.match(createBody, /delivery = await sendInvitationEmail/);
  assert.match(createBody, /locationNames: locations\.map/);
  assert.match(resendBody, /delivery: await sendInvitationEmail/);
  assert.match(resendBody, /locationNames: \[location\.name\]/);
});
