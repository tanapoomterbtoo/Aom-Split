/**
 * Aom Split — summary / transfers view (DOM-only)
 * Build: 20260811ux — settle UX: amount-first, big PromptPay CTA
 */
(function (global) {
  var BUILD = "20260811ux";

  function el(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null) return;
      if (k === "className") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "style" && typeof v === "object") {
        Object.keys(v).forEach(function (sk) {
          node.style[sk] = v[sk];
        });
      } else if (k.slice(0, 2) === "on" && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset" && typeof v === "object") {
        Object.keys(v).forEach(function (dk) {
          node.dataset[dk] = String(v[dk]);
        });
      } else {
        node.setAttribute(k, String(v));
      }
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function avatarNode(session, id, size) {
    size = size || 28;
    var wrap = document.createElement("span");
    wrap.innerHTML = AomUI.avatar(session, id, size);
    return wrap.firstChild || wrap;
  }

  function findMember(session, id) {
    return (session.members || []).find(function (m) {
      return m.id === id;
    });
  }

  /**
   * @param {object} opts
   * @param {function} opts.onToggleDone function(key, nextDone)
   * @param {function} opts.onCopyOne function(idx)
   * @param {function} [opts.onPromptPay] function(transfer, toMember)
   * @param {function} [opts.onSetupPromptPay] function(memberId)
   */
  function render(opts) {
    var session = opts.session;
    var membersBox = opts.membersBox;
    var transfersBox = opts.transfersBox;
    var badgeEl = opts.badgeEl;
    var versionEl = opts.versionEl;

    if (versionEl) {
      versionEl.textContent = "build " + BUILD;
    }

    if (!session || !membersBox || !transfersBox) return null;

    var plan;
    try {
      plan = AomMoney.recompute(session);
    } catch (err) {
      clear(membersBox);
      clear(transfersBox);
      membersBox.appendChild(
        el("div", { className: "muted", text: "คำนวณไม่สำเร็จ: " + ((err && err.message) || err) })
      );
      return null;
    }

    if (badgeEl) {
      clear(badgeEl);
      var ok = !!plan.ok;
      badgeEl.appendChild(
        el("span", {
          className: "badge " + (ok ? "ok" : "warn"),
          text: ok ? "ยอดสมดุล" : "ไม่สมดุล",
        })
      );
    }

    clear(membersBox);
    var members = session.members || [];
    if (!members.length) {
      membersBox.appendChild(el("div", { className: "empty", text: "ยังไม่มีสมาชิก" }));
    } else {
      // Sort: must transfer first, then get refund, then even
      var sorted = members.slice().sort(function (a, b) {
        var ba = plan.balances[a.id] || 0;
        var bb = plan.balances[b.id] || 0;
        return ba - bb;
      });

      sorted.forEach(function (m) {
        var owed = plan.owed[m.id] || 0;
        var paid = plan.paid[m.id] || 0;
        var bal = plan.balances[m.id] || 0;
        var balClass = "money";
        var statusText = "ลงตัว";
        var statusClass = "badge";
        if (bal > 0) {
          balClass = "money pos";
          statusText = "ได้คืน";
          statusClass = "badge ok";
        } else if (bal < 0) {
          balClass = "money neg";
          statusText = "ต้องโอน";
          statusClass = "badge warn";
        }

        var hasPP =
          global.AomPromptPay && AomPromptPay.memberHasPromptPay
            ? AomPromptPay.memberHasPromptPay(m)
            : false;

        var row = el("div", {
          style: {
            padding: "0.8rem 0",
            borderBottom: "1px solid var(--border)",
          },
        });

        var head = el("div", {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.45rem",
            gap: "0.5rem",
            flexWrap: "wrap",
          },
        });
        var left = el("div", {
          style: { display: "flex", alignItems: "center", gap: "0.55rem" },
        });
        left.appendChild(avatarNode(session, m.id, 34));
        var nameCol = el("div");
        nameCol.appendChild(el("strong", { text: m.displayName || m.id, style: { fontSize: "1rem" } }));
        if (hasPP) {
          nameCol.appendChild(
            el("div", {
              className: "muted",
              style: { fontSize: "0.78rem", marginTop: "0.1rem" },
              text:
                "พร้อมเพย์ " +
                AomPromptPay.maskId(AomPromptPay.memberPromptPay(m)),
            })
          );
        } else if (bal > 0) {
          nameCol.appendChild(
            el("div", {
              className: "muted",
              style: { fontSize: "0.78rem", marginTop: "0.1rem" },
              text: "ยังไม่ตั้งพร้อมเพย์",
            })
          );
        }
        left.appendChild(nameCol);
        head.appendChild(left);
        head.appendChild(el("span", { className: statusClass, text: statusText }));
        row.appendChild(head);

        var stats = el("div", { className: "stat-row" });
        [
          ["ใช้", AomMoney.formatMoney(owed), "money"],
          ["จ่าย", AomMoney.formatMoney(paid), "money"],
          ["สุทธิ", AomMoney.formatSigned(bal), balClass],
        ].forEach(function (triple) {
          var s = el("div", { className: "s" });
          s.appendChild(el("div", { className: "l", text: triple[0] }));
          s.appendChild(el("div", { className: "v " + triple[2], text: triple[1] }));
          stats.appendChild(s);
        });
        row.appendChild(stats);
        membersBox.appendChild(row);
      });
    }

    clear(transfersBox);
    if (!plan.transfers || !plan.transfers.length) {
      var empty = el("div", { className: "card empty" });
      empty.appendChild(el("div", { style: { fontSize: "2rem", marginBottom: "0.35rem" }, text: "✓" }));
      empty.appendChild(
        el("div", { style: { fontWeight: "700", color: "var(--good)", fontSize: "1.15rem" }, text: "ลงตัวแล้ว" })
      );
      empty.appendChild(el("div", { className: "muted", text: "ไม่ต้องโอนเพิ่ม — แชร์สรุปให้กลุ่มได้" }));
      transfersBox.appendChild(empty);
      return plan;
    }

    // Pending first, then done
    var indexed = plan.transfers.map(function (t, idx) {
      return { t: t, idx: idx };
    });
    indexed.sort(function (a, b) {
      var aDone = isDone(session, a.t) ? 1 : 0;
      var bDone = isDone(session, b.t) ? 1 : 0;
      return aDone - bDone;
    });

    indexed.forEach(function (item) {
      var t = item.t;
      var idx = item.idx;
      var fromName = AomUI.memberName(session, t.from);
      var toName = AomUI.memberName(session, t.to);
      var toMember = findMember(session, t.to);
      var amtStr = AomMoney.formatMoney(t.amountMinor);
      var tKey = AomStore.transferKey(t);
      var doneFlag = isDone(session, t);

      var hasPP =
        toMember && global.AomPromptPay && AomPromptPay.memberHasPromptPay
          ? AomPromptPay.memberHasPromptPay(toMember)
          : false;

      var card = el("div", {
        className: "card transfer-card" + (doneFlag ? " done" : ""),
        style: { marginBottom: "0.7rem" },
      });

      var top = el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          flexWrap: "wrap",
        },
      });
      var who = el("div", { className: "xfer-who" });
      who.appendChild(avatarNode(session, t.from, 30));
      who.appendChild(el("span", { text: fromName }));
      who.appendChild(el("span", { style: { color: "var(--muted)", fontWeight: "600" }, text: "→" }));
      who.appendChild(avatarNode(session, t.to, 30));
      who.appendChild(el("span", { text: toName }));
      top.appendChild(who);
      if (doneFlag) {
        top.appendChild(el("span", { className: "badge ok", text: "โอนแล้ว" }));
      }
      card.appendChild(top);

      card.appendChild(el("div", { className: "xfer-amount", text: amtStr }));

      var actions = el("div", { className: "xfer-actions" });

      if (!doneFlag) {
        if (hasPP) {
          actions.appendChild(
            el("button", {
              type: "button",
              className: "btn btn-primary btn-lg btn-block",
              text: "สแกนพร้อมเพย์ · " + amtStr,
              onClick: function () {
                if (typeof opts.onPromptPay === "function") opts.onPromptPay(t, toMember);
              },
            })
          );
        } else {
          actions.appendChild(
            el("button", {
              type: "button",
              className: "btn btn-primary btn-block",
              text: "ตั้งพร้อมเพย์ผู้รับ",
              onClick: function () {
                if (typeof opts.onSetupPromptPay === "function") opts.onSetupPromptPay(t.to);
              },
            })
          );
        }
      }

      var secondary = el("div", { className: "btn-row" });
      secondary.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          text: "คัดลอกยอด",
          onClick: function () {
            if (typeof opts.onCopyOne === "function") opts.onCopyOne(idx);
          },
        })
      );
      secondary.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-sm " + (doneFlag ? "btn-ghost" : ""),
          text: doneFlag ? "ยกเลิกเครื่องหมาย" : "✓ โอนแล้ว",
          onClick: function () {
            if (typeof opts.onToggleDone === "function") opts.onToggleDone(tKey, !doneFlag);
          },
        })
      );
      actions.appendChild(secondary);
      card.appendChild(actions);

      if (hasPP && !doneFlag) {
        card.appendChild(
          el("div", {
            className: "muted",
            style: { fontSize: "0.8rem", marginTop: "0.55rem", lineHeight: "1.4" },
            text:
              "เปิดแอปธนาคาร → สแกน QR ให้ " +
              toName +
              " · ยอดถูกใส่ใน QR แล้ว",
          })
        );
      }

      transfersBox.appendChild(card);
    });

    return plan;
  }

  function isDone(session, t) {
    if (AomStore.isTransferMarked) return !!AomStore.isTransferMarked(session, t);
    var tKey = AomStore.transferKey(t);
    return !!(session.transferMarks && session.transferMarks[tKey] && session.transferMarks[tKey].done);
  }

  global.AomSummaryView = {
    BUILD: BUILD,
    render: render,
  };
})(typeof window !== "undefined" ? window : globalThis);
