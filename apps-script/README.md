# ตั้งค่า Google Sheet เป็น DB (แชร์กับเพื่อน)

กลุ่มเพื่อนใช้ **Sheet ชุดเดียวกัน + token เดียวกัน** — ใครเพิ่มรายการจ่าย เพื่อนเห็นหลังซิงก์

## ขั้นตอน (คนที่สร้างครั้งเดียว)

### 1. สร้าง Sheet + วางสคริปต์

1. เปิด [Google Sheets](https://sheets.google.com) → สร้างสเปรดชีตใหม่ (เช่น `Aom Split DB`)
2. เมนู **Extensions → Apps Script**
3. ลบโค้ดเดิม แล้ววางทั้งไฟล์ [`Code.gs`](./Code.gs)
4. บันทึกโปรเจกต์ (ชื่อเช่น `Aom Split API`)

### 2. รัน setup + ได้ token

1. ใน Apps Script เลือกฟังก์ชัน **`setupOnce`** → กด **Run**
2. อนุญาตสิทธิ์บัญชี Google ของคุณ
3. เปิด **Execution log** / **View → Logs** จะเห็น **Token**  
   (มีในชีต `Config` คอลัมน์ B แถว token ด้วย)
4. คัดลอก token เก็บไว้ (เช่น `aom_xxxxxxxxxxxx`)

### 3. Deploy เป็น Web App

1. **Deploy → New deployment**
2. ไอคอนเฟือง → ชนิด **Web app**
3. ตั้งค่า:
   - **Execute as:** Me
   - **Who has access:** **Anyone**
4. **Deploy** → คัดลอก **Web app URL**  
   (ลงท้ายประมาณ `/macros/s/…/exec`)

> แก้ `Code.gs` ทีหลัง ต้อง **Deploy → Manage deployments → ✏️ → Version: New version** แล้ว Deploy อีกครั้ง

### 4. ใส่ในแอป Aom Split

1. เปิดแอป (GitHub Pages หรือ `index.html`)
2. การ์ด **Google Sheet (แชร์กับเพื่อน)**
3. วาง **Web App URL** + **Token**
4. เปิดสวิตช์ **ใช้ Sheet เป็น DB**
5. กด **ทดสอบการเชื่อมต่อ** แล้ว **ซิงก์ตอนนี้**

### 5. ส่งให้เพื่อน

ส่งสองอย่างนี้ให้เพื่อนในกลุ่ม (แชทส่วนตัว):

```text
Aom Split — เชื่อม Sheet
แอป: https://tanapoomterbtoo.github.io/Aom-Split/
Web App URL: https://script.google.com/macros/s/XXXX/exec
Token: aom_xxxxxxxx
```

เพื่อนเปิดแอป → ใส่ URL + token ชุดเดียวกัน → ซิงก์ → เห็นทริปชุดเดียวกัน

---

## โครงสร้างชีต

| ชีต | หน้าที่ |
|-----|---------|
| **Sessions** | แต่ละแถว = 1 ทริป (`id`, `updatedAt`, `deleted`, `payload` JSON) |
| **Config** | เก็บ token (สำรอง) |

ลบทริปในแอป = soft-delete (`deleted = true`) บนชีต

---

## ความปลอดภัย (กลุ่มเพื่อน)

- **Anyone** หมายถึง “ใครก็เรียก URL ได้” — กันด้วย **token**
- อย่าโพสต์ URL+token สาธารณะ
- ถ้าหลุด: รัน `setupOnce` ใหม่หรือเปลี่ยน token ใน Script Properties / Config แล้วแจก token ใหม่
- ข้อมูลบิลกลุ่มเพื่อน — ไม่เหมาะกับข้อมูลลับมาก

## ข้อจำกัด

- แก้พร้อมกันหลายคน: **ใครบันทึกล่าสุดชนะ** (`updatedAt`)
- ช้ากว่า local เล็กน้อย (รอบ Apps Script ~1–3 วินาที)
- เครื่องยังเก็บ cache ใน `localStorage` — ออฟไลน์ยังดู/แก้ได้ แล้วค่อยซิงก์เมื่อมีเน็ต

## API ย่อ (POST JSON, Content-Type: text/plain)

| action | body | ผล |
|--------|------|-----|
| `ping` | `{}` | เช็กว่า deploy แล้ว (ไม่บังคับ token) |
| `list` | `{ token }` | รายการทริปทั้งหมด |
| `get` | `{ token, id }` | ทริปเดียว |
| `upsert` | `{ token, session }` | บันทึกทริป |
| `delete` | `{ token, id }` | soft-delete |
| `replace_all` | `{ token, sessions: [] }` | แทนทั้งชุด |
