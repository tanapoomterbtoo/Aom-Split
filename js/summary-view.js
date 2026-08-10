/**
 * Aom Split — summary / transfers view (DOM-only)
 * Build: 20260810f
 * Payment verify: pending → claimed (payer) → confirmed (receiver) | rejected
 */
(function (global) {
  var BUILD = "20260810f";

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

  function formatWhen(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch (e) {
      return "";
    }
  }

  function statusBadge(status) {
    if (status === "confirmed") {
      return el("span", { className: "badge ok", text: "✓ ยืนยันแล้ว" });
    }
    if (status === "claimed") {
      return el("span", { className: "badge warn", text: "รอผู้รับตรวจ" });
    }
    if (status === "rejected") {
      return el("span", {
        className: "badge",
        style: {
          color: "var(--bad)",
          borderColor: "rgba(255,107,107,0.4)",
        },
        text: "✗ ยังไม่ผ่าน",
      });
    }
    return el("span", { className: "badge", text: "รอโอน" });
  }

  /**
   * @param {object} opts
   * @param {function} [opts.onClaim] (transfer, mark)
   * @param {function} [opts.onConfirm] (transfer, mark)
   * @param {function} [opts.onReject] (transfer, mark)
   * @param {function} [opts.onClear] (transfer, mark)
   * @param {function} [opts.onViewSlip] (transfer, mark)
   * @param {function} [opts.onPromptPay]
   * @param {function} [opts.onSetupPromptPay]
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

    // Members balances
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

    // Transfers + payment verify
    clear(transfersBox);
    if (!plan.transfers || !plan.transfers.length) {
      var empty = el("div", { className: "card empty" });
      empty.appendChild(el("div", { style: { fontSize: "2rem", marginBottom: "0.35rem" }, text: "🎉" }));
      empty.appendChild(
        el("div", { style: { fontWeight: "700", color: "var(--good)" }, text: "ลงตัวแล้ว" })
      );
      empty.appendChild(el("div", { className: "muted", text: "ไม่ต้องโอนเพิ่ม" }));
      transfersBox.appendChild(empty);
      return plan;
    }

    // legend
    transfersBox.appendChild(
      el("div", {
        className: "muted",
        style: { fontSize: "0.8rem", marginBottom: "0.65rem", lineHeight: "1.4" },
        text:
          "สถานะโอน: ผู้จ่ายแจ้งโอน → ผู้รับกดยืนยันเมื่อเงินเข้าจริง (แอปไม่เชื่อมธนาคารโดยตรง)",
      })
    );

    plan.transfers.forEach(function (t, idx) {
      var fromName = AomUI.memberName(session, t.from);
      var toName = AomUI.memberName(session, t.to);
      var toMember = findMember(session, t.to);
      var amtStr = AomMoney.formatMoney(t.amountMinor);
      var tKey = AomStore.transferKey(t);
      var mark = AomStore.getTransferMark
        ? AomStore.getTransferMark(session, t)
        : { status: "pending", done: false };
      var status = mark.status || "pending";
      var isDone = status === "confirmed";

      var hasPP =
        toMember && global.AomPromptPay && AomPromptPay.memberHasPromptPay
          ? AomPromptPay.memberHasPromptPay(toMember)
          : false;

      var card = el("div", {
        className:
          "card transfer-card" +
          (isDone ? " done" : "") +
          (status === "claimed" ? " transfer-claimed" : "") +
          (status === "rejected" ? " transfer-rejected" : ""),
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
      top.appendChild(statusBadge(status));
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

      if (!isDone && hasPP) {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: "📱 พร้อมเพย์",
            onClick: function () {
              if (typeof opts.onPromptPay === "function") opts.onPromptPay(t, toMember);
            },
          })
        );
      } else if (!isDone && !hasPP) {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-ghost",
            text: "⚙️ ตั้งพร้อมเพย์ผู้รับ",
            onClick: function () {
              if (typeof opts.onSetupPromptPay === "function") opts.onSetupPromptPay(t.to);
            },
          })
        );
      }

      if (status === "pending" || status === "rejected") {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: status === "rejected" ? "แจ้งโอนอีกครั้ง" : "แจ้งว่าโอนแล้ว",
            onClick: function () {
              if (typeof opts.onClaim === "function") opts.onClaim(t, mark);
            },
          })
        );
      }

      if (status === "claimed") {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: "✓ ผู้รับยืนยัน",
            onClick: function () {
              if (typeof opts.onConfirm === "function") opts.onConfirm(t, mark);
            },
          })
        );
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-ghost",
            style: { color: "var(--bad)" },
            text: "ยังไม่ได้รับ",
            onClick: function () {
              if (typeof opts.onReject === "function") opts.onReject(t, mark);
            },
          })
        );
      }

      if (mark.slipDataUrl) {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm",
            text: "🖼 สลิป",
            onClick: function () {
              if (typeof opts.onViewSlip === "function") opts.onViewSlip(t, mark);
            },
          })
        );
      }

      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          text: "📋 คัดลอก",
          onClick: function () {
            if (typeof opts.onCopyOne === "function") opts.onCopyOne(idx);
          },
        })
      );

      if (status !== "pending") {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-ghost",
            text: "รีเซ็ต",
            onClick: function () {
              if (typeof opts.onClear === "function") opts.onClear(t, mark);
            },
          })
        );
      }

      bottom.appendChild(actions);
      card.appendChild(bottom);

      // detail line
      var detailParts = [];
      if (mark.ref) detailParts.push("รหัสอ้างอิง " + mark.ref);
      if (status === "claimed" && mark.claimedAt) {
        detailParts.push("แจ้งโอน " + formatWhen(mark.claimedAt));
      }
      if (status === "confirmed" && mark.confirmedAt) {
        detailParts.push("ยืนยัน " + formatWhen(mark.confirmedAt));
      }
      if (status === "rejected" && mark.rejectNote) {
        detailParts.push("เหตุผล: " + mark.rejectNote);
      }
      if (mark.note) detailParts.push(mark.note);
      if (detailParts.length) {
        card.appendChild(
          el("div", {
            className: "muted",
            style: { fontSize: "0.78rem", marginTop: "0.45rem", lineHeight: "1.4" },
            text: detailParts.join(" · "),
          })
        );
      } else if (hasPP && !isDone) {
        card.appendChild(
          el("div", {
            className: "muted",
            style: { fontSize: "0.78rem", marginTop: "0.45rem" },
            text:
              "สแกนพร้อมเพย์จ่ายให้ " +
              toName +
              " แล้วกด «แจ้งว่าโอนแล้ว» ให้ผู้รับตรวจ",
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
