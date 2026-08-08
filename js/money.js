/**
 * Aom Split — money + split + settle (satang integer)
 * balance(m) = paid - owed ; sum(balances) === 0
 */
(function (global) {
  function satang(n) {
    return Math.round(Number(n) || 0);
  }

  function bahtToMinor(baht) {
    return satang(Math.round(Number(baht) * 100));
  }

  function minorToBahtNumber(minor) {
    return satang(minor) / 100;
  }

  const thbFmt = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  });

  function formatMoney(minor) {
    return thbFmt.format(minorToBahtNumber(minor));
  }

  function formatSigned(minor) {
    const m = satang(minor);
    if (m > 0) return "+" + formatMoney(m);
    if (m < 0) return "−" + formatMoney(-m);
    return formatMoney(0);
  }

  /** Largest remainder: distribute amountMinor by weights (numbers). */
  function splitByWeights(amountMinor, weightMap) {
    // weightMap: { memberId: weight }
    const amount = satang(amountMinor);
    const entries = Object.keys(weightMap)
      .map(function (id) {
        return { id: id, w: Number(weightMap[id]) || 0 };
      })
      .filter(function (e) {
        return e.w > 0;
      });

    if (!entries.length) {
      throw new Error("ไม่มีผู้ร่วมหาร (weights ว่าง)");
    }
    const totalW = entries.reduce(function (s, e) {
      return s + e.w;
    }, 0);
    if (totalW <= 0) throw new Error("ผลรวมสัดส่วนต้อง > 0");

    const raw = entries.map(function (e) {
      const exact = (amount * e.w) / totalW;
      const floor = Math.floor(exact);
      return { id: e.id, floor: floor, frac: exact - floor };
    });
    let sumFloor = raw.reduce(function (s, r) {
      return s + r.floor;
    }, 0);
    let remain = amount - sumFloor;
    raw.sort(function (a, b) {
      return b.frac - a.frac || a.id.localeCompare(b.id);
    });
    const out = {};
    raw.forEach(function (r, i) {
      out[r.id] = r.floor + (i < remain ? 1 : 0);
    });
    return out; // { memberId: amountMinor }
  }

  /**
   * Resolve expense → { memberId: owedMinor }
   * expense: {
   *   amountMinor, paidByMemberId, splitMode: equal|shares|exact|percent|treat,
   *   participants: string[],
   *   shares?: { [memberId]: number },
   *   exactMinor?: { [memberId]: number },
   *   percents?: { [memberId]: number }
   * }
   */
  function resolveSplits(expense) {
    const amount = satang(expense.amountMinor);
    const mode = expense.splitMode || "equal";
    let participants = (expense.participants || []).slice();

    if (mode === "treat") {
      // host absorbs 100%; if paidBy is host, net 0 for this line overall for others
      const host = expense.paidByMemberId;
      const o = {};
      o[host] = amount;
      return o;
    }

    if (mode === "equal") {
      if (!participants.length) throw new Error("equal ต้องมี participants");
      const w = {};
      participants.forEach(function (id) {
        w[id] = 1;
      });
      return splitByWeights(amount, w);
    }

    if (mode === "shares") {
      const shares = expense.shares || {};
      const w = {};
      participants.forEach(function (id) {
        if ((shares[id] || 0) > 0) w[id] = shares[id];
      });
      // if participants empty, use all keys in shares
      if (!Object.keys(w).length) {
        Object.keys(shares).forEach(function (id) {
          if (shares[id] > 0) w[id] = shares[id];
        });
      }
      return splitByWeights(amount, w);
    }

    if (mode === "exact") {
      const exact = expense.exactMinor || {};
      const o = {};
      let sum = 0;
      Object.keys(exact).forEach(function (id) {
        const v = satang(exact[id]);
        if (v > 0) {
          o[id] = v;
          sum += v;
        }
      });
      if (sum !== amount) {
        throw new Error(
          "exact ต้องรวมเท่ากับยอดรายการ (ได้ " + sum + " ต้องการ " + amount + ")"
        );
      }
      return o;
    }

    if (mode === "percent") {
      const percents = expense.percents || {};
      // treat percent points as weights; must sum ~100
      const w = {};
      Object.keys(percents).forEach(function (id) {
        if (percents[id] > 0) w[id] = percents[id];
      });
      return splitByWeights(amount, w);
    }

    throw new Error("splitMode ไม่รู้จัก: " + mode);
  }

  /**
   * @returns {{
   *   balances: { [memberId]: number },
   *   paid: { [memberId]: number },
   *   owed: { [memberId]: number },
   *   transfers: { from: string, to: string, amountMinor: number }[],
   *   ok: boolean
   * }}
   */
  function recompute(session) {
    const members = session.members || [];
    const expenses = session.expenses || [];
    const paid = {};
    const owed = {};
    members.forEach(function (m) {
      paid[m.id] = 0;
      owed[m.id] = 0;
    });

    expenses.forEach(function (e) {
      if (e.deleted) return;
      const amount = satang(e.amountMinor);
      if (!paid.hasOwnProperty(e.paidByMemberId)) paid[e.paidByMemberId] = 0;
      paid[e.paidByMemberId] += amount;

      const parts = resolveSplits(e);
      Object.keys(parts).forEach(function (id) {
        if (!owed.hasOwnProperty(id)) owed[id] = 0;
        owed[id] += satang(parts[id]);
      });
    });

    const balances = {};
    const allIds = {};
    Object.keys(paid).forEach(function (id) {
      allIds[id] = true;
    });
    Object.keys(owed).forEach(function (id) {
      allIds[id] = true;
    });
    members.forEach(function (m) {
      allIds[m.id] = true;
    });

    let sum = 0;
    Object.keys(allIds).forEach(function (id) {
      const b = satang(paid[id] || 0) - satang(owed[id] || 0);
      balances[id] = b;
      sum += b;
    });

    const transfers = minimizeTransfers(balances);
    return {
      balances: balances,
      paid: paid,
      owed: owed,
      transfers: transfers,
      ok: sum === 0,
      sumCheck: sum,
    };
  }

  function minimizeTransfers(balances) {
    const debtors = [];
    const creditors = [];
    Object.keys(balances).forEach(function (id) {
      const b = satang(balances[id]);
      if (b < 0) debtors.push({ id: id, amount: -b }); // amount they still owe
      if (b > 0) creditors.push({ id: id, amount: b });
    });
    debtors.sort(function (a, b) {
      return b.amount - a.amount;
    });
    creditors.sort(function (a, b) {
      return b.amount - a.amount;
    });

    const transfers = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amount, creditors[j].amount);
      if (pay > 0) {
        transfers.push({
          from: debtors[i].id,
          to: creditors[j].id,
          amountMinor: pay,
        });
      }
      debtors[i].amount -= pay;
      creditors[j].amount -= pay;
      if (debtors[i].amount === 0) i++;
      if (creditors[j].amount === 0) j++;
    }
    return transfers;
  }

  /** Demo session from plan §1 (อาร์ม บีม ชา) */
  function demoSession() {
    const arm = "m_arm";
    const beam = "m_beam";
    const cha = "m_cha";
    return {
      id: "demo_arm_beam_cha",
      title: "คืนนี้สุขุมวิท (ตัวอย่าง)",
      date: new Date().toISOString().slice(0, 10),
      currency: "THB",
      status: "open",
      members: [
        { id: arm, displayName: "อาร์ม", color: "#c9a227" },
        { id: beam, displayName: "บีม", color: "#3498db" },
        { id: cha, displayName: "ชา", color: "#e67e22" },
      ],
      expenses: [
        {
          id: "e1",
          title: "เบียร์ถัง",
          amountMinor: 90000,
          paidByMemberId: arm,
          splitMode: "equal",
          participants: [arm, beam, cha],
        },
        {
          id: "e2",
          title: "วิสกี้ช็อต ×6",
          amountMinor: 120000,
          paidByMemberId: beam,
          splitMode: "shares",
          participants: [arm, beam, cha],
          shares: { [arm]: 2, [beam]: 3, [cha]: 1 },
        },
        {
          id: "e3",
          title: "ไก่ทอด",
          amountMinor: 30000,
          paidByMemberId: cha,
          splitMode: "equal",
          participants: [arm, beam, cha],
        },
        {
          id: "e4",
          title: "ค็อกเทล",
          amountMinor: 25000,
          paidByMemberId: arm,
          splitMode: "equal",
          participants: [cha],
        },
        {
          id: "e5",
          title: "ทิป / ค่าบริการ",
          amountMinor: 10000,
          paidByMemberId: beam,
          splitMode: "equal",
          participants: [arm, beam, cha],
        },
      ],
      transferMarks: {},
      createdAt: Date.now(),
    };
  }

  // Self-check demo
  function selfCheck() {
    const s = demoSession();
    const r = recompute(s);
    const issues = [];
    if (!r.ok) issues.push("sum balances != 0: " + r.sumCheck);
    const totalPaid = Object.keys(r.paid).reduce(function (a, k) {
      return a + r.paid[k];
    }, 0);
    if (totalPaid !== 275000) issues.push("total paid expected 275000 got " + totalPaid);
    return { ok: issues.length === 0, issues: issues, result: r };
  }

  global.AomMoney = {
    satang: satang,
    bahtToMinor: bahtToMinor,
    minorToBahtNumber: minorToBahtNumber,
    formatMoney: formatMoney,
    formatSigned: formatSigned,
    splitByWeights: splitByWeights,
    resolveSplits: resolveSplits,
    recompute: recompute,
    minimizeTransfers: minimizeTransfers,
    demoSession: demoSession,
    selfCheck: selfCheck,
  };
})(typeof window !== "undefined" ? window : globalThis);
