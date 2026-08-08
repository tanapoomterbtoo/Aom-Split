/**
 * Node integration tests for Aom Split core + URL helpers.
 * Run: node test/flow-test.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadScripts(ctx) {
  for (const f of ["js/money.js", "js/store.js", "js/ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx);
  }
}

function makeCtx(pathname, search = "", href) {
  const origin = "https://tanapoomterbtoo.github.io";
  const full = href || origin + pathname + search;
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const location = {
    href: full,
    pathname,
    search,
    origin,
    hash: "",
    assign(url) {
      this._assigned = url;
      // parse
      if (url.startsWith("http")) {
        const u = new URL(url);
        this.href = url;
        this.pathname = u.pathname;
        this.search = u.search;
      } else if (url.startsWith("/")) {
        this.href = origin + url;
        const q = url.indexOf("?");
        this.pathname = q >= 0 ? url.slice(0, q) : url;
        this.search = q >= 0 ? url.slice(q) : "";
      } else {
        this._relative = url;
      }
    },
    replace(url) {
      this.assign(url);
      this._replaced = true;
    },
  };
  const document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    getElementById() {
      return null;
    },
    createElement() {
      return { style: {}, setAttribute() {}, select() {} };
    },
  };
  const ctx = {
    window: null,
    globalThis: null,
    console,
    URL,
    localStorage,
    location,
    document,
    navigator: {},
    clearTimeout,
    setTimeout,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadScripts(ctx);
  return ctx;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.error("  ✗", msg);
  }
}

console.log("1) URL helpers on GitHub Pages paths");
{
  const cases = [
    ["/Aom-Split/", "/Aom-Split/session.html?id=x"],
    ["/Aom-Split", "/Aom-Split/session.html?id=x"],
    ["/Aom-Split/index.html", "/Aom-Split/session.html?id=x"],
    ["/Aom-Split/session.html", "/Aom-Split/session.html?id=x"],
  ];
  for (const [pathname, expectPrefix] of cases) {
    const ctx = makeCtx(pathname, "");
    const url = ctx.AomUI.pageUrl("session.html", { id: "x" });
    assert(url === expectPrefix || url.startsWith(expectPrefix.split("?")[0]), `${pathname} -> ${url}`);
    assert(url.includes("id=x"), `${pathname} has id`);
    assert(!url.startsWith("/session.html"), `${pathname} not broken root /session.html`);
  }
}

console.log("2) Money settle demo balances");
{
  const ctx = makeCtx("/Aom-Split/");
  const arm = "a",
    beam = "b",
    cha = "c";
  const session = {
    id: "s1",
    title: "t",
    members: [
      { id: arm, displayName: "อาร์ม" },
      { id: beam, displayName: "บีม" },
      { id: cha, displayName: "ชา" },
    ],
    expenses: [
      {
        id: "e1",
        amountMinor: 90000,
        paidByMemberId: arm,
        splitMode: "equal",
        participants: [arm, beam, cha],
      },
      {
        id: "e2",
        amountMinor: 120000,
        paidByMemberId: beam,
        splitMode: "shares",
        participants: [arm, beam, cha],
        shares: { [arm]: 2, [beam]: 3, [cha]: 1 },
      },
      {
        id: "e3",
        amountMinor: 30000,
        paidByMemberId: cha,
        splitMode: "equal",
        participants: [arm, beam, cha],
      },
      {
        id: "e4",
        amountMinor: 25000,
        paidByMemberId: arm,
        splitMode: "equal",
        participants: [cha],
      },
      {
        id: "e5",
        amountMinor: 10000,
        paidByMemberId: beam,
        splitMode: "equal",
        participants: [arm, beam, cha],
      },
    ],
  };
  const plan = ctx.AomMoney.recompute(session);
  assert(plan.ok, "balances sum 0");
  assert(plan.transfers.length === 2, "2 transfers");
  assert(plan.transfers.every((t) => t.from === cha), "cha pays both");
}

console.log("3) Store create/get/upsert/recompute");
{
  const ctx = makeCtx("/Aom-Split/index.html");
  const s = ctx.AomStore.createSession("ทดสอบ", ["เอ", "บี", "ซี"]);
  assert(!!s.id, "session id");
  assert(s.members.length === 3, "3 members");
  const loaded = ctx.AomStore.getSession(s.id);
  assert(!!loaded, "getSession works");
  const a = loaded.members[0].id;
  const b = loaded.members[1].id;
  loaded.expenses.push({
    id: "e1",
    title: "เบียร์",
    amountMinor: 30000,
    paidByMemberId: a,
    splitMode: "equal",
    participants: [a, b, loaded.members[2].id],
  });
  ctx.AomStore.upsertSession(loaded);
  const again = ctx.AomStore.getSession(s.id);
  const plan = ctx.AomMoney.recompute(again);
  assert(plan.ok, "plan ok");
  assert(plan.transfers.length === 2, "two people pay a");
  assert((plan.balances[a] || 0) > 0, "payer is creditor");
}

console.log("4) Bad expense does not throw");
{
  const ctx = makeCtx("/Aom-Split/");
  const s = {
    members: [{ id: "a", displayName: "A" }],
    expenses: [
      {
        id: "bad",
        amountMinor: 1000,
        paidByMemberId: "a",
        splitMode: "equal",
        participants: [],
      },
    ],
  };
  let threw = false;
  try {
    ctx.AomMoney.recompute(s);
  } catch (e) {
    threw = true;
  }
  assert(!threw, "recompute no throw on empty participants");
}

console.log("5) go() assigns under /Aom-Split/");
{
  const ctx = makeCtx("/Aom-Split/");
  ctx.AomUI.go("session.html", { id: "abc", tab: "summary" });
  assert(
    String(ctx.location._assigned || "").includes("/Aom-Split/session.html"),
    "assign path " + ctx.location._assigned
  );
  assert(String(ctx.location._assigned || "").includes("id=abc"), "assign id");
  assert(String(ctx.location._assigned || "").includes("tab=summary"), "assign tab");
}

console.log("\n==== RESULT ====");
console.log(`passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
console.log("ALL PASS");
