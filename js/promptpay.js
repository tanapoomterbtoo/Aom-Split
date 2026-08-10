/**
 * Aom Split — PromptPay EMVCo payload (Credit Transfer / Tag 29)
 * Build: 20260810e
 *
 * มาตรฐานเดียวกับ saladpuk/PromptPay (C#) และ dtinth/promptpay-qr (JS)
 * รองรับ: เบอร์มือถือ / เลขบัตรประชาชน (+ ยอดเงิน)
 * อ้างอิง: https://github.com/saladpuk/PromptPay
 *          https://github.com/dtinth/promptpay-qr
 */
(function (global) {
  var ID_PAYLOAD_FORMAT = "00";
  var ID_POI_METHOD = "01";
  var ID_MERCHANT_INFORMATION_BOT = "29";
  var ID_TRANSACTION_CURRENCY = "53";
  var ID_TRANSACTION_AMOUNT = "54";
  var ID_COUNTRY_CODE = "58";
  var ID_CRC = "63";

  var PAYLOAD_FORMAT = "01";
  var POI_STATIC = "11";
  var POI_DYNAMIC = "12";
  var MERCHANT_GUID_TAG = "00";
  var BOT_PHONE = "01";
  var BOT_TAX_OR_NID = "02";
  var BOT_EWALLET = "03";
  var GUID_PROMPTPAY = "A000000677010111";
  var CURRENCY_THB = "764";
  var COUNTRY_TH = "TH";

  function onlyDigits(s) {
    return String(s || "").replace(/[^0-9]/g, "");
  }

  /** CRC-16/XMODEM seed 0xFFFF (ตรง promptpay-qr) */
  function crc16xmodem(str) {
    var crc = 0xffff;
    for (var i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) & 0xff) << 8;
      for (var j = 0; j < 8; j++) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
        else crc = (crc << 1) & 0xffff;
      }
    }
    return crc;
  }

  function tlv(id, value) {
    value = String(value);
    var len = ("00" + value.length).slice(-2);
    return id + len + value;
  }

  function joinTlv(parts) {
    return parts.filter(Boolean).join("");
  }

  /**
   * จัดรูปแบบเป้าหมายตาม BOT
   * เบอร์ 0xxxxxxxxx → 0066xxxxxxxxx (13 หลัก)
   * บัตร 13 หลัก / e-wallet 15+ ใช้ตามเดิม
   */
  function formatTarget(digits) {
    digits = onlyDigits(digits);
    if (digits.length >= 13) return digits;
    // ตัด 0 นำหน้าแล้วใส่ 66 แล้ว pad ซ้ายเป็น 13 หลัก
    var withCountry = digits.replace(/^0/, "66");
    return ("0000000000000" + withCountry).slice(-13);
  }

  function targetType(digits) {
    digits = onlyDigits(digits);
    if (digits.length >= 15) return BOT_EWALLET;
    if (digits.length >= 13) return BOT_TAX_OR_NID;
    return BOT_PHONE;
  }

  function formatAmountBaht(baht) {
    var n = Number(baht);
    if (!isFinite(n) || n < 0) n = 0;
    return n.toFixed(2);
  }

  function formatCrc(n) {
    return ("0000" + n.toString(16).toUpperCase()).slice(-4);
  }

  /**
   * @param {string} target เบอร์ / บัตร ปชช. / e-wallet
   * @param {{ amountBaht?: number|null, amountMinor?: number|null }} [opts]
   * @returns {string} EMVCo payload
   */
  function generatePayload(target, opts) {
    opts = opts || {};
    var digits = onlyDigits(target);
    if (!digits) throw new Error("ไม่มีหมายเลขพร้อมเพย์");

    var amountBaht = null;
    if (opts.amountMinor != null && opts.amountMinor !== "") {
      amountBaht = (Number(opts.amountMinor) || 0) / 100;
    } else if (opts.amountBaht != null && opts.amountBaht !== "") {
      amountBaht = Number(opts.amountBaht);
    }

    var hasAmount = amountBaht != null && isFinite(amountBaht) && amountBaht > 0;
    var type = targetType(digits);
    var formatted = formatTarget(digits);

    var merchantInfo = joinTlv([
      tlv(MERCHANT_GUID_TAG, GUID_PROMPTPAY),
      tlv(type, formatted),
    ]);

    var data = [
      tlv(ID_PAYLOAD_FORMAT, PAYLOAD_FORMAT),
      tlv(ID_POI_METHOD, hasAmount ? POI_DYNAMIC : POI_STATIC),
      tlv(ID_MERCHANT_INFORMATION_BOT, merchantInfo),
      tlv(ID_COUNTRY_CODE, COUNTRY_TH),
      tlv(ID_TRANSACTION_CURRENCY, CURRENCY_THB),
    ];
    if (hasAmount) {
      data.push(tlv(ID_TRANSACTION_AMOUNT, formatAmountBaht(amountBaht)));
    }

    var dataToCrc = joinTlv(data) + ID_CRC + "04";
    data.push(tlv(ID_CRC, formatCrc(crc16xmodem(dataToCrc))));
    return joinTlv(data);
  }

  /**
   * ตรวจเบอร์ / บัตร ก่อนบันทึก
   * @returns {{ ok: boolean, digits: string, kind: string, message?: string }}
   */
  function validateId(raw) {
    var digits = onlyDigits(raw);
    if (!digits) {
      return { ok: false, digits: "", kind: "", message: "กรอกเบอร์มือถือหรือเลขบัตรประชาชน" };
    }
    // phone: 9–10 digits (0xxxxxxxxx or 9 digits without 0)
    if (digits.length === 9 || digits.length === 10) {
      if (digits.length === 10 && digits.charAt(0) !== "0") {
        return { ok: false, digits: digits, kind: "phone", message: "เบอร์มือถือควรขึ้นต้นด้วย 0" };
      }
      if (digits.length === 9) digits = "0" + digits;
      return { ok: true, digits: digits, kind: "phone" };
    }
    if (digits.length === 13) {
      return { ok: true, digits: digits, kind: "nationalId" };
    }
    if (digits.length === 15) {
      return { ok: true, digits: digits, kind: "ewallet" };
    }
    return {
      ok: false,
      digits: digits,
      kind: "",
      message: "ใช้เบอร์ 10 หลัก หรือบัตรประชาชน 13 หลัก",
    };
  }

  function maskId(raw) {
    var d = onlyDigits(raw);
    if (!d) return "—";
    if (d.length <= 4) return d;
    return "••••" + d.slice(-4);
  }

  function kindLabel(kind) {
    if (kind === "phone") return "เบอร์มือถือ";
    if (kind === "nationalId") return "บัตรประชาชน";
    if (kind === "ewallet") return "e-Wallet";
    var d = onlyDigits(kind);
    if (d.length >= 13 && d.length < 15) return "บัตรประชาชน";
    if (d.length >= 15) return "e-Wallet";
    if (d.length >= 9) return "เบอร์มือถือ";
    return "พร้อมเพย์";
  }

  function detectKind(raw) {
    return validateId(raw).kind || "";
  }

  /** ดึง promptpay จากสมาชิก (รองรับ field เก่า) */
  function memberPromptPay(member) {
    if (!member) return "";
    return onlyDigits(member.promptpay || member.promptPayId || member.pp || "");
  }

  function memberHasPromptPay(member) {
    var v = validateId(memberPromptPay(member));
    return v.ok;
  }

  /**
   * payload สำหรับโอนให้สมาชิก + ยอดสตางค์
   */
  function payloadForMember(member, amountMinor) {
    var id = memberPromptPay(member);
    var v = validateId(id);
    if (!v.ok) throw new Error(v.message || "ผู้รับยังไม่ได้ตั้งพร้อมเพย์");
    return generatePayload(v.digits, { amountMinor: amountMinor });
  }

  global.AomPromptPay = {
    onlyDigits: onlyDigits,
    generatePayload: generatePayload,
    validateId: validateId,
    maskId: maskId,
    kindLabel: kindLabel,
    detectKind: detectKind,
    formatTarget: formatTarget,
    memberPromptPay: memberPromptPay,
    memberHasPromptPay: memberHasPromptPay,
    payloadForMember: payloadForMember,
  };
})(typeof window !== "undefined" ? window : globalThis);
