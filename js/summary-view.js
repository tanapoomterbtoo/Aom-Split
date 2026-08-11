/**
 * Aom Split — สรุปโอน (ใช้งานง่าย)
 * Build: 20260811s5
 *
 * หลัก: เลือก "ฉันคือใคร" → เห็นเฉพาะงานของฉันก่อน
 * รายการโอน = การ์ดสั้น 1 ปุ่มหลัก · ยอดใหญ่ · โอนแล้วพับเก็บ
 */
(function (global) {
  var BUILD = "20260811s5";
  var ME_PREFIX = "aom_split_me_";

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

  function isDone(session, t) {
    if (AomStore.isTransferMarked) return !!AomStore.isTransferMarked(session, t);
    var tKey = AomStore.transferKey(t);
    return !!(session.transferMarks && session.transferMarks[tKey] && session.transferMarks[tKey].done);
  }

  function hasPromptPay(m) {
    return !!(
      m &&
      global.AomPromptPay &&
      AomPromptPay.memberHasPromptPay &&
      AomPromptPay.memberHasPromptPay(m)
    );
  }

  function getMeId(sessionId) {
    try {
      return sessionStorage.getItem(ME_PREFIX + sessionId) || "";
    } catch (e) {
      return "";
    }
  }

  function setMeId(sessionId, memberId) {
    try {
      if (memberId) sessionStorage.setItem(ME_PREFIX + sessionId, memberId);
      else sessionStorage.removeItem(ME_PREFIX + sessionId);
    } catch (e) {
      /* ignore */
    }
  }

  function sectionTitle(text, extra) {
    var row = el("div", { className: "settle-section-h" });
    row.appendChild(el("h3", { text: text }));
    if (extra) row.appendChild(extra);
    return row;
  }

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root - full summary root (preferred)
   * @param {object} opts.session
   * @param {function} opts.onToggleDone
   * @param {function} opts.onCopyOne
   * @param {function} [opts.onPromptPay]
   * @param {function} [opts.onSetupPromptPay]
   * @param {function} [opts.onShareAll]
   * @param {function} [opts.onCopyTransfers]
   * @param {function} [opts.onMeChange]
   * legacy: membersBox, transfersBox, badgeEl, versionEl still accepted
   */
  function render(opts) {
    var session = opts.session;
    var root =
      opts.root ||
      document.getElementById("summary-root") ||
      null;

    // legacy fallbacks
    var membersBox = opts.membersBox;
    var transfersBox = opts.transfersBox;
    var badgeEl = opts.badgeEl;
    var versionEl = opts.versionEl;
    if (versionEl) versionEl.textContent = "build " + BUILD;

    if (!session) return null;

    var plan;
    try {
      plan = AomMoney.recompute(session);
    } catch (err) {
      var errMsg = "คำนวณไม่สำเร็จ: " + ((err && err.message) || err);
      if (root) {
        clear(root);
        root.appendChild(el("div", { className: "card empty", text: errMsg }));
      }
      return null;
    }

    var members = session.members || [];
    var transfers = plan.transfers || [];
    var meId = getMeId(session.id);
    // drop stale me if member removed
    if (meId && !findMember(session, meId)) {
      meId = "";
      setMeId(session.id, "");
    }

    var pending = [];
    var doneList = [];
    transfers.forEach(function (t, idx) {
      var item = { t: t, idx: idx, done: isDone(session, t) };
      if (item.done) doneList.push(item);
      else pending.push(item);
    });

    var myPay = [];
    var myGet = [];
    var otherPay = [];
    if (meId) {
      pending.forEach(function (item) {
        if (item.t.from === meId) myPay.push(item);
        else if (item.t.to === meId) myGet.push(item);
        else otherPay.push(item);
      });
    }

    var myPayTotal = myPay.reduce(function (s, i) {
      return s + (i.t.amountMinor || 0);
    }, 0);
    var myGetTotal = myGet.reduce(function (s, i) {
      return s + (i.t.amountMinor || 0);
    }, 0);
    var pendingTotal = pending.reduce(function (s, i) {
      return s + (i.t.amountMinor || 0);
    }, 0);

    // ── Build into root if available ──
    if (root) {
      clear(root);
      root.appendChild(buildMePicker(session, meId, opts));
      root.appendChild(buildHero(session, plan, meId, pending, doneList, myPay, myGet, myPayTotal, myGetTotal, pendingTotal));
      root.appendChild(buildActionsBar(opts, pending.length));

      if (!transfers.length) {
        root.appendChild(buildAllSettled(opts));
      } else if (meId) {
        // personal view
        root.appendChild(sectionTitle("ฉันต้องโอน" + (myPay.length ? " · " + myPay.length + " รายการ" : "")));
        if (!myPay.length) {
          root.appendChild(
            el("div", {
              className: "settle-empty-soft",
              text: "คุณไม่ต้องโอนใครในตอนนี้",
            })
          );
        } else {
          myPay.forEach(function (item) {
            root.appendChild(buildTransferCard(session, item, opts, { perspective: "pay", meId: meId }));
          });
        }

        if (myGet.length) {
          root.appendChild(sectionTitle("รอรับ · " + AomMoney.formatMoney(myGetTotal)));
          myGet.forEach(function (item) {
            root.appendChild(buildTransferCard(session, item, opts, { perspective: "get", meId: meId }));
          });
        }

        if (otherPay.length) {
          var othersWrap = el("details", { className: "settle-details" });
          othersWrap.appendChild(
            el("summary", {
              text: "รายการอื่นในกลุ่ม · " + otherPay.length + " รายการ",
            })
          );
          var othersBody = el("div", { className: "settle-details-body" });
          otherPay.forEach(function (item) {
            othersBody.appendChild(buildTransferCard(session, item, opts, { perspective: "all", meId: meId }));
          });
          othersWrap.appendChild(othersBody);
          root.appendChild(othersWrap);
        }
      } else {
        // all-group view — still action-first
        root.appendChild(sectionTitle("ต้องโอน · " + pending.length + " รายการ"));
        if (!pending.length) {
          root.appendChild(
            el("div", {
              className: "settle-empty-soft",
              text: "รายการค้างโอนหมดแล้ว",
            })
          );
        } else {
          pending.forEach(function (item) {
            root.appendChild(buildTransferCard(session, item, opts, { perspective: "all", meId: "" }));
          });
        }
      }

      if (doneList.length) {
        var doneWrap = el("details", { className: "settle-details" });
        doneWrap.appendChild(
          el("summary", { text: "โอนแล้ว · " + doneList.length + " รายการ" })
        );
        var doneBody = el("div", { className: "settle-details-body" });
        doneList.forEach(function (item) {
          doneBody.appendChild(buildTransferCard(session, item, opts, { perspective: "all", meId: meId, done: true }));
        });
        doneWrap.appendChild(doneBody);
        root.appendChild(doneWrap);
      }

      root.appendChild(buildBalances(session, plan, meId));
      root.appendChild(buildShareFooter(opts));
    } else {
      // legacy partial render
      if (badgeEl) {
        clear(badgeEl);
        badgeEl.appendChild(
          el("span", {
            className: "badge " + (plan.ok ? "ok" : "warn"),
            text: plan.ok ? "พร้อม" : "เช็กยอด",
          })
        );
      }
      if (membersBox) {
        clear(membersBox);
        membersBox.appendChild(buildBalancesInner(session, plan, meId));
      }
      if (transfersBox) {
        clear(transfersBox);
        if (!transfers.length) {
          transfersBox.appendChild(buildAllSettled(opts));
        } else {
          pending.forEach(function (item) {
            transfersBox.appendChild(buildTransferCard(session, item, opts, { perspective: "all", meId: meId }));
          });
        }
      }
    }

    if (typeof opts.onAfterRender === "function") {
      opts.onAfterRender({
        plan: plan,
        meId: meId,
        pendingCount: pending.length,
        doneCount: doneList.length,
        myPayCount: myPay.length,
        pendingTotal: pendingTotal,
      });
    }

    return plan;
  }

  function buildMePicker(session, meId, opts) {
    var card = el("div", { className: "card settle-me-card" });
    card.appendChild(
      el("div", {
        className: "settle-me-label",
        text: "ฉันคือใคร? (ดูเฉพาะงานของฉัน)",
      })
    );
    var row = el("div", { className: "settle-me-row", role: "listbox", "aria-label": "เลือกชื่อของคุณ" });

    // All view chip
    row.appendChild(
      makeMeChip(session, null, !meId, "ทั้งหมด", function () {
        setMeId(session.id, "");
        if (typeof opts.onMeChange === "function") opts.onMeChange("");
        else render(opts);
      })
    );

    (session.members || []).forEach(function (m) {
      row.appendChild(
        makeMeChip(session, m, meId === m.id, m.displayName, function () {
          setMeId(session.id, m.id);
          if (typeof opts.onMeChange === "function") opts.onMeChange(m.id);
          else render(opts);
        })
      );
    });

    card.appendChild(row);
    if (!meId) {
      card.appendChild(
        el("p", {
          className: "settle-me-hint",
          text: "แตะชื่อของคุณ → จะเห็นเฉพาะรายการที่ต้องโอน",
        })
      );
    }
    return card;
  }

  function makeMeChip(session, member, on, label, onClick) {
    var btn = el("button", {
      type: "button",
      className: "settle-me-chip" + (on ? " on" : ""),
      role: "option",
      "aria-selected": on ? "true" : "false",
      onClick: onClick,
    });
    if (member) {
      btn.appendChild(avatarNode(session, member.id, 22));
    } else {
      btn.appendChild(el("span", { className: "settle-me-all-ico", text: "◎" }));
    }
    btn.appendChild(el("span", { text: label || "" }));
    return btn;
  }

  function buildHero(session, plan, meId, pending, doneList, myPay, myGet, myPayTotal, myGetTotal, pendingTotal) {
    var card = el("div", { className: "card settle-hero" });
    var total = pending.length + doneList.length;

    if (!plan.transfers || !plan.transfers.length) {
      card.classList.add("is-done");
      card.appendChild(el("div", { className: "settle-hero-kicker", text: "สถานะทริป" }));
      card.appendChild(el("div", { className: "settle-hero-title", text: "ลงตัวแล้ว" }));
      card.appendChild(el("div", { className: "settle-hero-sub", text: "ไม่ต้องโอนเพิ่ม" }));
      return card;
    }

    if (meId) {
      var me = findMember(session, meId);
      var name = (me && me.displayName) || "คุณ";
      card.appendChild(
        el("div", { className: "settle-hero-kicker", text: "สรุปของ " + name })
      );
      if (myPay.length) {
        card.appendChild(
          el("div", {
            className: "settle-hero-title money",
            text: AomMoney.formatMoney(myPayTotal),
          })
        );
        card.appendChild(
          el("div", {
            className: "settle-hero-sub",
            text: "ต้องโอน " + myPay.length + " รายการ",
          })
        );
      } else if (myGet.length) {
        card.classList.add("is-recv");
        card.appendChild(
          el("div", {
            className: "settle-hero-title money pos",
            text: AomMoney.formatMoney(myGetTotal),
          })
        );
        card.appendChild(
          el("div", {
            className: "settle-hero-sub",
            text: "รอรับจากเพื่อน " + myGet.length + " รายการ",
          })
        );
      } else {
        card.classList.add("is-done");
        card.appendChild(el("div", { className: "settle-hero-title", text: "คุณลงตัว" }));
        card.appendChild(
          el("div", {
            className: "settle-hero-sub",
            text: doneList.length ? "งานของคุณเคลียร์แล้ว" : "ไม่มีรายการโอนที่เกี่ยวกับคุณ",
          })
        );
      }
    } else {
      card.appendChild(el("div", { className: "settle-hero-kicker", text: "ทั้งกลุ่ม" }));
      card.appendChild(
        el("div", {
          className: "settle-hero-title money",
          text: AomMoney.formatMoney(pendingTotal),
        })
      );
      card.appendChild(
        el("div", {
          className: "settle-hero-sub",
          text:
            "ค้างโอน " +
            pending.length +
            "/" +
            total +
            " รายการ" +
            (doneList.length ? " · โอนแล้ว " + doneList.length : ""),
        })
      );
    }

    // progress
    if (total > 0) {
      var pct = Math.round((doneList.length / total) * 100);
      var prog = el("div", { className: "settle-progress" });
      prog.appendChild(
        el("div", {
          className: "progress-label",
          html:
            "<span>ความคืบหน้า</span><span>" +
            doneList.length +
            "/" +
            total +
            "</span>",
        })
      );
      var bar = el("div", { className: "progress-bar", "aria-hidden": "true" });
      bar.appendChild(el("i", { style: { width: pct + "%" } }));
      prog.appendChild(bar);
      card.appendChild(prog);
    }

    return card;
  }

  function buildActionsBar(opts, pendingCount) {
    var bar = el("div", { className: "settle-quick-actions" });
    if (!pendingCount) {
      bar.style.display = "none";
      return bar;
    }
    bar.appendChild(
      el("button", {
        type: "button",
        className: "btn btn-block",
        text: "คัดลอกรายการโอน (สั้น)",
        onClick: function () {
          if (typeof opts.onCopyTransfers === "function") opts.onCopyTransfers();
        },
      })
    );
    return bar;
  }

  function buildAllSettled(opts) {
    var card = el("div", { className: "card empty settle-done-card" });
    card.appendChild(el("div", { className: "settle-done-ico", text: "✓" }));
    card.appendChild(el("div", { className: "empty-title", text: "ลงตัวแล้ว" }));
    card.appendChild(
      el("p", { className: "muted", text: "ไม่ต้องโอนเพิ่ม — แชร์สรุปให้กลุ่มได้" })
    );
    card.appendChild(
      el("button", {
        type: "button",
        className: "btn btn-primary",
        style: { marginTop: "0.75rem" },
        text: "คัดลอกสรุปไปแชท",
        onClick: function () {
          if (typeof opts.onShareAll === "function") opts.onShareAll();
        },
      })
    );
    return card;
  }

  /**
   * Transfer card — one primary action
   * perspective: pay | get | all
   */
  function buildTransferCard(session, item, opts, ctx) {
    var t = item.t;
    var idx = item.idx;
    var doneFlag = !!item.done || !!ctx.done;
    var fromName = AomUI.memberName(session, t.from);
    var toName = AomUI.memberName(session, t.to);
    var toMember = findMember(session, t.to);
    var fromMember = findMember(session, t.from);
    var amtStr = AomMoney.formatMoney(t.amountMinor);
    var tKey = AomStore.transferKey(t);
    var pp = hasPromptPay(toMember);
    var perspective = ctx.perspective || "all";

    var card = el("div", {
      className:
        "card settle-xfer" +
        (doneFlag ? " is-done" : "") +
        (perspective === "pay" ? " is-mine" : "") +
        (perspective === "get" ? " is-recv" : ""),
    });

    // headline
    var head = el("div", { className: "settle-xfer-head" });
    if (perspective === "pay") {
      head.appendChild(el("div", { className: "settle-xfer-verb", text: "โอนให้" }));
      var toLine = el("div", { className: "settle-xfer-who" });
      toLine.appendChild(avatarNode(session, t.to, 36));
      toLine.appendChild(el("strong", { text: toName }));
      head.appendChild(toLine);
    } else if (perspective === "get") {
      head.appendChild(el("div", { className: "settle-xfer-verb", text: "รอรับจาก" }));
      var fromLine = el("div", { className: "settle-xfer-who" });
      fromLine.appendChild(avatarNode(session, t.from, 36));
      fromLine.appendChild(el("strong", { text: fromName }));
      head.appendChild(fromLine);
    } else {
      var both = el("div", { className: "settle-xfer-who settle-xfer-both" });
      both.appendChild(avatarNode(session, t.from, 32));
      both.appendChild(el("strong", { text: fromName }));
      both.appendChild(el("span", { className: "settle-arrow", text: "→" }));
      both.appendChild(avatarNode(session, t.to, 32));
      both.appendChild(el("strong", { text: toName }));
      head.appendChild(both);
    }
    if (doneFlag) {
      head.appendChild(el("span", { className: "badge ok", text: "โอนแล้ว" }));
    }
    card.appendChild(head);

    // amount
    card.appendChild(el("div", { className: "settle-xfer-amt money", text: amtStr }));

    // meta line for promptpay / tip
    if (!doneFlag && perspective !== "get") {
      if (pp) {
        card.appendChild(
          el("div", {
            className: "settle-xfer-meta",
            text:
              "พร้อมเพย์ " +
              AomPromptPay.maskId(AomPromptPay.memberPromptPay(toMember)) +
              " · ยอดใส่ใน QR แล้ว",
          })
        );
      } else {
        card.appendChild(
          el("div", {
            className: "settle-xfer-meta warn",
            text: toName + " ยังไม่ตั้งพร้อมเพย์",
          })
        );
      }
    }

    // actions
    var actions = el("div", { className: "settle-xfer-actions" });

    if (doneFlag) {
      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-ghost btn-block",
          text: "ยกเลิก · ยังไม่โอน",
          onClick: function () {
            if (typeof opts.onToggleDone === "function") opts.onToggleDone(tKey, false);
          },
        })
      );
    } else if (perspective === "get") {
      // receiver: mark received + optional share reminder
      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-primary btn-lg btn-block",
          text: "✓ ได้รับแล้ว",
          onClick: function () {
            if (typeof opts.onToggleDone === "function") opts.onToggleDone(tKey, true);
          },
        })
      );
      actions.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-block",
          text: "คัดลอกเตือน " + fromName,
          onClick: function () {
            var text =
              fromName +
              " โอนให้ " +
              toName +
              " " +
              amtStr +
              " นะ";
            if (pp) {
              text +=
                " (พร้อมเพย์ " +
                AomPromptPay.maskId(AomPromptPay.memberPromptPay(toMember)) +
                ")";
            }
            AomUI.copyText(text);
          },
        })
      );
    } else {
      // payer view (or all): primary = pay
      if (pp) {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-primary btn-lg btn-block",
            text: "สแกนพร้อมเพย์",
            onClick: function () {
              if (typeof opts.onPromptPay === "function") opts.onPromptPay(t, toMember);
            },
          })
        );
      } else {
        actions.appendChild(
          el("button", {
            type: "button",
            className: "btn btn-primary btn-lg btn-block",
            text: "ตั้งพร้อมเพย์ผู้รับ",
            onClick: function () {
              if (typeof opts.onSetupPromptPay === "function") opts.onSetupPromptPay(t.to);
            },
          })
        );
      }

      var row = el("div", { className: "settle-xfer-secondary" });
      row.appendChild(
        el("button", {
          type: "button",
          className: "btn",
          text: "คัดลอก",
          onClick: function () {
            if (typeof opts.onCopyOne === "function") opts.onCopyOne(idx);
          },
        })
      );
      row.appendChild(
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "✓ โอนแล้ว",
          onClick: function () {
            if (typeof opts.onToggleDone === "function") opts.onToggleDone(tKey, true);
          },
        })
      );
      actions.appendChild(row);
    }

    card.appendChild(actions);
    return card;
  }

  function buildBalances(session, plan, meId) {
    var wrap = el("details", { className: "settle-details settle-balances" });
    wrap.appendChild(el("summary", { text: "ดูยอดต่อคน (ใช้ / จ่าย / สุทธิ)" }));
    var body = el("div", { className: "settle-details-body" });
    body.appendChild(buildBalancesInner(session, plan, meId));
    wrap.appendChild(body);
    return wrap;
  }

  function buildBalancesInner(session, plan, meId) {
    var box = el("div", { className: "settle-bal-list" });
    var members = (session.members || []).slice().sort(function (a, b) {
      return (plan.balances[a.id] || 0) - (plan.balances[b.id] || 0);
    });

    if (!members.length) {
      box.appendChild(el("div", { className: "muted", text: "ยังไม่มีสมาชิก" }));
      return box;
    }

    members.forEach(function (m) {
      var bal = plan.balances[m.id] || 0;
      var owed = plan.owed[m.id] || 0;
      var paid = plan.paid[m.id] || 0;
      var row = el("div", {
        className: "settle-bal-row" + (meId === m.id ? " is-me" : ""),
      });
      var left = el("div", { className: "settle-bal-left" });
      left.appendChild(avatarNode(session, m.id, 30));
      var nameCol = el("div");
      nameCol.appendChild(
        el("div", {
          className: "settle-bal-name",
          text: m.displayName + (meId === m.id ? " (ฉัน)" : ""),
        })
      );
      nameCol.appendChild(
        el("div", {
          className: "settle-bal-sub",
          text: "ใช้ " + AomMoney.formatMoney(owed) + " · จ่าย " + AomMoney.formatMoney(paid),
        })
      );
      left.appendChild(nameCol);
      row.appendChild(left);

      var right = el("div", { className: "settle-bal-right" });
      var cls = "money";
      var label = "ลงตัว";
      if (bal > 0) {
        cls = "money pos";
        label = "ได้คืน";
      } else if (bal < 0) {
        cls = "money neg";
        label = "ต้องโอน";
      }
      right.appendChild(el("div", { className: cls, text: AomMoney.formatSigned(bal) }));
      right.appendChild(el("div", { className: "settle-bal-tag", text: label }));
      row.appendChild(right);
      box.appendChild(row);
    });
    return box;
  }

  function buildShareFooter(opts) {
    var foot = el("div", { className: "summary-sticky-actions" });
    foot.appendChild(
      el("button", {
        type: "button",
        className: "btn btn-primary btn-lg btn-block",
        text: "คัดลอกสรุปไปวางในแชท",
        onClick: function () {
          if (typeof opts.onShareAll === "function") opts.onShareAll();
        },
      })
    );
    return foot;
  }

  global.AomSummaryView = {
    BUILD: BUILD,
    render: render,
    getMeId: getMeId,
    setMeId: setMeId,
  };
})(typeof window !== "undefined" ? window : globalThis);
