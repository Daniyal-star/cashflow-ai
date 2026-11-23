import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ReminderRecord, ReminderTone } from "../../shared/types.js";
import { createApp } from "../src/index.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { createDataStore } from "../src/data/store.js";
import { formatDateLabel, formatRupees } from "../src/ai/facts.js";
import { findRecentSentReminder, generateReminderText, type ReminderTextInput } from "../src/core/reminders.js";

// Response bodies are loosely typed on purpose: each test asserts only the fields the rules name.
interface ApiResult {
  status: number;
  body: any;
}

let server: Server;
let baseUrl: string;
let dataFile: string;

async function call(method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `reminders-test-${randomUUID()}.json`);
  createDataStore(dataFile).save(buildSeedDataset());
  const app = createApp({ dataFile });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  fs.rmSync(dataFile, { force: true });
});

// Seed facts: INV-1047 (cust-sharma, Sharma Textiles) is overdue and partly paid, INV-1049 is open with no payments,
// INV-1042 (cust-sharma) is fully paid.
const TONES: ReminderTone[] = ["friendly", "professional", "firm"];
const BASE: ReminderTextInput = {
  customerName: "Sharma Textiles",
  invoiceNumber: "INV-1047",
  balance: 1_000_000,
  dueDate: "2025-05-16",
  daysOverdue: 30,
  tone: "friendly",
  senderName: "Accounts Team",
};

function generate(overrides: Partial<ReminderTextInput>) {
  return generateReminderText({ ...BASE, ...overrides });
}

const ASOF = "2025-06-15";

function reminder(overrides: Partial<ReminderRecord>): ReminderRecord {
  return {
    id: "rem-test",
    invoiceId: "inv-1047",
    customerId: "cust-sharma",
    tone: "firm",
    date: "2025-06-10",
    balanceAtDraft: 1_000_000,
    status: "sent",
    sentAt: "2025-06-10",
    channels: ["whatsapp"],
    isDemoData: false,
    ...overrides,
  };
}

describe("reminder text generation", () => {
  it("each tone includes customer, invoice number, formatted balance and due date; subject prefix matches the tone", () => {
    const prefixes: Record<ReminderTone, string> = {
      friendly: "Reminder:",
      professional: "Payment reminder:",
      firm: "Urgent:",
    };
    const amount = formatRupees(BASE.balance);
    const due = formatDateLabel(BASE.dueDate);
    for (const tone of TONES) {
      const text = generate({ tone });
      expect(text.whatsapp.length).toBeGreaterThan(0);
      for (const field of [text.whatsapp, text.email.body]) {
        expect(field).toContain("Sharma Textiles");
        expect(field).toContain("INV-1047");
        expect(field).toContain(amount);
        expect(field).toContain(due);
      }
      expect(text.email.subject).toContain("INV-1047");
      expect(text.email.subject.startsWith(prefixes[tone])).toBe(true);
    }
  });

  it("no tone invents links, bank details or phone-like numbers", () => {
    const forbidden = ["http", "www.", "@", "UPI", "IFSC", "account number"];
    for (const tone of TONES) {
      const text = generate({ tone });
      const all = `${text.whatsapp}\n${text.email.subject}\n${text.email.body}`;
      for (const word of forbidden) {
        expect(all).not.toContain(word);
      }
      expect(/\d{10}/.test(all)).toBe(false);
    }
  });

  it("a partial balance of 4000 paise is shown instead of the invoice amount of 10000 paise", () => {
    for (const tone of TONES) {
      const text = generate({ tone, balance: 4000 });
      expect(text.whatsapp).toContain(formatRupees(4000));
      expect(text.whatsapp).not.toContain(formatRupees(10000));
      expect(text.email.body).toContain(formatRupees(4000));
      expect(text.email.body).not.toContain(formatRupees(10000));
    }
  });

  it("daysOverdue 0 omits the overdue wording for professional and firm", () => {
    for (const tone of ["professional", "firm"] as const) {
      const text = generate({ tone, daysOverdue: 0 });
      expect(text.whatsapp).not.toContain("past due");
      expect(text.whatsapp).not.toContain("after the due date");
      expect(text.email.body).not.toContain("past due");
      expect(text.email.body).not.toContain("after the due date");
    }
  });

  it("daysOverdue 1 says '1 day' and daysOverdue 14 says '14 days'", () => {
    const one = generate({ tone: "professional", daysOverdue: 1 });
    expect(one.whatsapp).toContain("1 day past due");
    expect(one.whatsapp).not.toContain("1 days");
    const oneFirm = generate({ tone: "firm", daysOverdue: 1 });
    expect(oneFirm.whatsapp).toContain("1 day after the due date");

    const fourteen = generate({ tone: "professional", daysOverdue: 14 });
    expect(fourteen.whatsapp).toContain("14 days past due");
    const fourteenFirm = generate({ tone: "firm", daysOverdue: 14 });
    expect(fourteenFirm.whatsapp).toContain("14 days after the due date");
  });

  it("a zero balance throws an error mentioning 'no outstanding balance'", () => {
    expect(() => generate({ balance: 0 })).toThrowError(/no outstanding balance/);
  });
});

describe("findRecentSentReminder", () => {
  it("returns a sent reminder 5 days before the as-of date", () => {
    const sent = reminder({ date: "2025-06-10" });
    expect(findRecentSentReminder([sent], "inv-1047", ASOF)?.id).toBe("rem-test");
  });

  it("returns undefined for a sent reminder 8 days before the as-of date", () => {
    const old = reminder({ date: "2025-06-07" });
    expect(findRecentSentReminder([old], "inv-1047", ASOF)).toBeUndefined();
  });

  it("returns undefined for a drafted (not sent) reminder", () => {
    const drafted = reminder({ status: "drafted", sentAt: undefined, date: "2025-06-14" });
    expect(findRecentSentReminder([drafted], "inv-1047", ASOF)).toBeUndefined();
  });

  it("returns undefined when reminders is undefined", () => {
    expect(findRecentSentReminder(undefined, "inv-1047", ASOF)).toBeUndefined();
  });
});

describe("reminder draft and history over HTTP", () => {
  it("POST /draft returns 200 with whatsapp and email and leaves the data file bytes unchanged", async () => {
    const before = fs.readFileSync(dataFile);
    const res = await call("POST", "/api/reminders/draft", { invoiceId: "inv-1047", tone: "firm" });
    expect(res.status).toBe(200);
    expect(typeof res.body.whatsapp).toBe("string");
    expect(typeof res.body.email.subject).toBe("string");
    expect(typeof res.body.email.body).toBe("string");
    const after = fs.readFileSync(dataFile);
    expect(after.equals(before)).toBe(true);
  });

  it("POST /mark-sent returns 201 with status sent, and GET by invoiceId returns the record", async () => {
    const balanceBefore = (await call("GET", "/api/invoices/inv-1047")).body.balance;
    const created = await call("POST", "/api/reminders/mark-sent", {
      invoiceId: "inv-1047",
      tone: "firm",
      channels: ["whatsapp", "email"],
    });
    expect(created.status).toBe(201);
    expect(created.body.reminder.status).toBe("sent");

    const list = await call("GET", "/api/reminders?invoiceId=inv-1047");
    expect(list.status).toBe(200);
    expect((list.body as ReminderRecord[]).map((r) => r.id)).toContain(created.body.reminder.id);

    const stored = (createDataStore(dataFile).load().reminders ?? []).find(
      (r) => r.id === created.body.reminder.id,
    );
    expect(stored).toBeDefined();
    expect(stored!.invoiceId).toBe("inv-1047");
    expect(stored!.tone).toBe("firm");
    expect(stored!.balanceAtDraft).toBe(balanceBefore);
  });

  it("a second mark-sent for the same invoice returns 409 with existing.id, and the count stays at 1", async () => {
    const body = { invoiceId: "inv-1047", tone: "firm", channels: ["email"] };
    const first = await call("POST", "/api/reminders/mark-sent", body);
    expect(first.status).toBe(201);

    const dup = await call("POST", "/api/reminders/mark-sent", body);
    expect(dup.status).toBe(409);
    expect(dup.body.existing.id).toBe(first.body.reminder.id);

    const list = await call("GET", "/api/reminders?invoiceId=inv-1047");
    expect(list.body).toHaveLength(1);
  });

  it("a second mark-sent with force: true returns 201 and the count becomes 2", async () => {
    const body = { invoiceId: "inv-1047", tone: "firm", channels: ["email"] };
    await call("POST", "/api/reminders/mark-sent", body);

    const forced = await call("POST", "/api/reminders/mark-sent", { ...body, force: true });
    expect(forced.status).toBe(201);

    const list = await call("GET", "/api/reminders?invoiceId=inv-1047");
    expect(list.body).toHaveLength(2);
  });
});

describe("reminder invalid references and validation", () => {
  it("an unknown invoiceId returns 404 for draft, mark-sent and GET history", async () => {
    const draft = await call("POST", "/api/reminders/draft", { invoiceId: "inv-unknown", tone: "firm" });
    expect(draft.status).toBe(404);

    const sent = await call("POST", "/api/reminders/mark-sent", {
      invoiceId: "inv-unknown",
      tone: "firm",
      channels: ["email"],
    });
    expect(sent.status).toBe(404);

    const list = await call("GET", "/api/reminders?invoiceId=unknown");
    expect(list.status).toBe(404);
  });

  it("a draft for a fully paid invoice (INV-1042) returns 422 mentioning 'no outstanding balance'", async () => {
    const res = await call("POST", "/api/reminders/draft", { invoiceId: "inv-1042", tone: "friendly" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("no outstanding balance");
  });

  it("an invalid tone returns 400 on draft, and empty channels returns 400 on mark-sent", async () => {
    const badTone = await call("POST", "/api/reminders/draft", { invoiceId: "inv-1047", tone: "angry" });
    expect(badTone.status).toBe(400);

    const noChannels = await call("POST", "/api/reminders/mark-sent", {
      invoiceId: "inv-1047",
      tone: "firm",
      channels: [],
    });
    expect(noChannels.status).toBe(400);
  });
});

describe("reminder draft after a partial payment", () => {
  it("draft text uses the remaining balance (1 paise) after paying all but 1 paise of INV-1049", async () => {
    const before = await call("GET", "/api/invoices/inv-1049");
    const paid = await call("POST", "/api/invoices/inv-1049/payments", {
      date: "2025-06-15",
      amount: before.body.balance - 1,
    });
    expect(paid.status).toBe(201);

    const after = await call("GET", "/api/invoices/inv-1049");
    expect(after.body.balance).toBe(1);

    const draft = await call("POST", "/api/reminders/draft", { invoiceId: "inv-1049", tone: "firm" });
    expect(draft.status).toBe(200);
    expect(draft.body.whatsapp).toContain(formatRupees(after.body.balance));
    expect(draft.body.whatsapp).not.toContain(formatRupees(before.body.balance));
  });
});

describe("seed backward compatibility", () => {
  it("buildSeedDataset() has no reminders property", () => {
    expect("reminders" in buildSeedDataset()).toBe(false);
  });

  it("createDataStore loads a seed file without error and reports no reminders", () => {
    const loaded = createDataStore(dataFile).load();
    expect(loaded.invoices).toHaveLength(buildSeedDataset().invoices.length);
    expect(loaded.reminders ?? []).toHaveLength(0);
  });
});
