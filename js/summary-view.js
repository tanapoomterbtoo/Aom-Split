/**
 * Aom Split — summary / transfers view (DOM-only, no brittle HTML strings)
 * Build: 20260810h
 */
(function (global) {
  var BUILD = "20260810h";

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
          text: ok ? "✓ ยอดสมดุล" : "⚠️ ไม่สมดุล (" + AomMoney.formatSigned(plan.sumCheck) + ")",
        })
      );
    }

    clear(membersBox);
    var members = session.members || [];
    if (!members.length) {
      membersBox.appendChild(el("div", { className: "empty", text: "ยังไม่มีสมาชิก" }));
    } else {
      members.forEach(function (m) {
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
            padding: "0.75rem 0",
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
        left.appendChild(avatarNode(session, m.id, 32));
        var nameCol = el("div");
        nameCol.appendChild(el("strong", { text: m.displayName || m.id }));
        if (hasPP) {
          nameCol.appendChild(
            el("div", {
              className: "muted",
              style: { fontSize: "0.78rem", marginTop: "0.1rem" },
              text:
                "พร้อมเพย์ " +
                AomPromptPay.maskId(AomPromptPay.memberPromptPay(m)) +
                " · " +
                AomPromptPay.kindLabel(AomPromptPay.detectKind(AomPromptPay.memberPromptPay(m))),
            })
          );
        } else if (bal > 0) {
          nameCol.appendChild(
            el("div", {
              className: "muted",
              style: { fontSize: "0.78rem", marginTop: "0.1rem" },
              text: "ยังไม่มีพร้อมเพย์ — ตั้งในแท็บสมาชิก",
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
        el("div", { style: { fontWeight: "700", color: "var(--good)" }, text: "ลงตัวแล้ว" })
      );
      empty.appendChild(el("div", { className: "muted", text: "ไม่ต้องโอนเพิ่ม" }));
      transfersBox.appendChild(empty);
      return plan;
    }

    plan.transfers.forEach(function (t, idx) {
      var fromName = AomUI.memberName(session, t.from);
      var toName = AomUI.memberName(session, t.to);
      var toMember = findMember(session, t.to);
      var amtStr = AomMoney.formatMoney(t.amountMinor);
      var tKey = AomStore.transferKey(t);
      var isDone = AomStore.isTransferMarked
        ? AomStore.isTransferMarked(session, t)
        : !!(session.transferMarks && session.transferMarks[tKey] && session.transferMarks[tKey].done);

      var hasPP =
        toMember && global.AomPromptPay && AomPromptPay.memberHasPromptPay
          ? AomPromptPay.memberHasPromptPay(toMember)
          : false;

      var card = el("div", {
        className: "card transfer-card" + (isDone ? " done" : ""),
        style: { marginBottom: "0.65rem" },
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
      var who = el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          fontWeight: "700",
          flexWrap: "wrap",
        },
      });
      who.appendChild(avatarNode(session, t.from, 28));
      who.appendChild(el("span", { text: fromName }));
      who.appendChild(el("span", { style: { color: "var(--muted)" }, text: "→" }));
      who.appendChild(avatarNode(session, t.to, 28));
      who.appendChild(el("span", { text: toName }));
      top.appendChild(who);
      if (isDone) {
        top.appendChild(el("span", { className: "badge ok", text: "โอนแล้ว" }));
      }
      card.appendChild(top);

      var bottom = el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginTop: "0.65rem",
          flexWrap: "wrap",
        },
      });
      bottom.appendChild(el("div", { className: "money big", text: amtStr }));

      var actions = el("div", { className: "btn-row" });

      if (hasPP) {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: "พร้อมเพย์",
            onClick: function () {
              if (typeof opts.onPromptPay === "function") opts.onPromptPay(t, toMember);
            },
          })
        );
      } else {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-ghost",
            text: "ตั้งพร้อมเพย์ผู้รับ",
            onClick: function () {
              if (typeof opts.onSetupPromptPay === "function") opts.onSetupPromptPay(t.to);
            },
          })
        );
      }

      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          text: "คัดลอก",
          onClick: function () {
            if (typeof opts.onCopyOne === "function") opts.onCopyOne(idx);
          },
        })
      );
      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-sm " + (isDone ? "btn-ghost" : "btn-primary"),
          text: isDone ? "ยกเลิก" : "✓ โอนแล้ว",
          onClick: function () {
            if (typeof opts.onToggleDone === "function") opts.onToggleDone(tKey, !isDone);
          },
        })
      );
      bottom.appendChild(actions);
      card.appendChild(bottom);

      if (hasPP && !isDone) {
        card.appendChild(
          el("div", {
            className: "muted",
            style: { fontSize: "0.78rem", marginTop: "0.45rem" },
            text:
              "สแกนพร้อมเพย์จ่ายให้ " +
              toName +
              " (" +
              AomPromptPay.maskId(AomPromptPay.memberPromptPay(toMember)) +
              ") ยอดตามด้านบน",
          })
        );
      }

      transfersBox.appendChild(card);
    });

    return plan;
  }

  global.AomSummaryView = {
    BUILD: BUILD,
    render: render,
  };
})(typeof window !== "undefined" ? window : globalThis);
