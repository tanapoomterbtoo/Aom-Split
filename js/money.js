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
    const paidBy = expense.paidByMemberId;

    if (mode === "treat") {
      const host = paidBy;
      const o = {};
      if (host) o[host] = amount;
      return o;
    }

    if (mode === "equal") {
      if (!participants.length && paidBy) participants = [paidBy];
      if (!participants.length) return {};
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
      if (!Object.keys(w).length) {
        Object.keys(shares).forEach(function (id) {
          if (shares[id] > 0) w[id] = shares[id];
        });
      }
      if (!Object.keys(w).length) {
        if (!participants.length && paidBy) participants = [paidBy];
        participants.forEach(function (id) {
          w[id] = 1;
        });
      }
      if (!Object.keys(w).length) return {};
      return splitByWeights(amount, w);
    }

    if (mode === "exact") {
      const exact = expense.exactMinor || {};
      const o = {};
      let sum = 0;
      Object.keys(exact).forEach(function (id) {
        const v = satang(exact[id]);
        if (v !== 0) {
          o[id] = v;
          sum += v;
        }
      });
      // ถ้า exact ไม่ครบยอด — กระจายส่วนต่างให้ paidBy (กันหน้าสรุปพัง)
      if (sum !== amount && paidBy) {
        o[paidBy] = satang((o[paidBy] || 0) + (amount - sum));
      }
      return o;
    }

    if (mode === "percent") {
      const percents = expense.percents || {};
      const w = {};
      Object.keys(percents).forEach(function (id) {
        if (percents[id] > 0) w[id] = percents[id];
      });
      if (!Object.keys(w).length) {
        if (!participants.length && paidBy) participants = [paidBy];
        participants.forEach(function (id) {
          w[id] = 1;
        });
      }
      if (!Object.keys(w).length) return {};
      return splitByWeights(amount, w);
    }

    // unknown mode → โยนให้คนจ่าย (ไม่ throw)
    if (paidBy) {
      const o = {};
      o[paidBy] = amount;
      return o;
    }
    return {};
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
      try {
        const amount = satang(e.amountMinor);
        if (e.paidByMemberId) {
          if (!paid.hasOwnProperty(e.paidByMemberId)) paid[e.paidByMemberId] = 0;
          paid[e.paidByMemberId] += amount;
        }

        const parts = resolveSplits(e);
        Object.keys(parts).forEach(function (id) {
          if (!owed.hasOwnProperty(id)) owed[id] = 0;
          owed[id] += satang(parts[id]);
        });
      } catch (err) {
        console.warn("skip expense", e && e.id, err);
      }
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
  };
})(typeof window !== "undefined" ? window : globalThis);
