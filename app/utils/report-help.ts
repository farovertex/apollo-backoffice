/**
 * FEAT-069 — T2c: the Thai help text behind every "i" info hint of `/reports/performance` (`rf`) and
 * `/reports/dashboard` (`rd`), keyed by the owner's own test id (`ReportsInfoHint` reads this map, never the
 * other way around). Human request (2026-10-27): explain where each number comes from and how it is computed —
 * never the filter/workspace mechanics, so there is no entry for the range picker, the workspace select, the
 * refresh button, the tabs or any name/account/workspace/link column.
 *
 * `\n` is a line break inside the popover (`whitespace-pre-line`); nothing here is shortened for layout — the
 * popover scrolls instead.
 */
/**
 * FEAT-103 — the two limits every "ในช่วง" figure shares (spec "UI behaviour"): the date is the day the kpi round
 * saw the change, and history goes back only as far as the system has recorded it.
 */
const RANGE_LIMITS = 'วันที่ที่ใช้นับ = วันที่รอบ kpi เห็นการเปลี่ยนแปลง ไม่ใช่วันที่ TikTok เปลี่ยนจริง\nประวัติย้อนหลังได้เท่าที่ระบบบันทึกไว้ — ช่วงก่อนระบบเริ่มบันทึกจะไม่มีตัวเลข'

/** FEAT-103 — limits of `rf-range-accounts`: counted from the system's own row dates, not from a kpi round */
const RANGE_LIMITS_LIFECYCLE = 'วันที่ที่ใช้นับ = วันที่ระบบสร้างแถว account / advertiser และวันที่ระบบบันทึกว่าลบ (account) หรือไม่เห็นใน Business Center อีก (advertiser) ไม่ใช่วันที่เปิด/ปิดบัญชีที่ TikTok จริง\nประวัติย้อนหลังได้เท่าที่ระบบบันทึกไว้ — ช่วงก่อนระบบเริ่มบันทึกจะไม่มีตัวเลข'

/** FEAT-103 — limits of the launching figures: the flag is turned on by a publish and off by a kpi round / a ban */
const RANGE_LIMITS_LAUNCHING = 'วันที่เปิดธง = เวลาที่ระบบบันทึกตอนเผยแพร่ build · วันที่ปิดธง = วันที่รอบ kpi เห็นว่าไม่มีโฆษณา หรือวันที่ระบบบันทึกว่า advertiser ถูกระงับ — ไม่ใช่วันที่ TikTok เปลี่ยนจริง\nประวัติย้อนหลังได้เท่าที่ระบบบันทึกไว้ — ช่วงก่อนระบบเริ่มบันทึกจะไม่มีตัวเลข'

export const REPORT_HELP: Record<string, string> = {
  // ── Performance `rf` ──────────────────────────────────────────────────────────────────────────────────────────────
  'rf-tile-spend': 'ค่าโฆษณารวมของ advertiser ทุกตัวในช่วงที่เลือก\nมาจากยอดรวมรายวันที่ job kpi ดึงจาก TikTok Ads (แถวรวมของ advertiser ต่อวัน)\nเป็น THB: บัญชีสกุลอื่นแปลงด้วยอัตรา mid-market ของวันนั้น (fastforex) · ยอดที่แปลงไม่ได้แสดงแยกเป็น +n ? · วันตัดตามโซน Asia/Bangkok\nเทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน',
  'rf-spend-chart': 'แท่งละหนึ่งวัน = spend ของวันนั้น\nเลือกวันเดียว = โชว์ 7 วันล่าสุดถึงวันนั้นแทน',
  'rf-tile-used': 'จำนวน advertiser ที่มี spend > 0 ในช่วง\nบัญชี = TikTok account ที่ advertiser เหล่านั้นสังกัด (นับไม่ซ้ำ)',
  'rf-tile-registers': 'ผลรวมคนสมัคร (total_register) จากระบบ UTM\nนับเฉพาะ UTM ที่ workspace นี้ใช้ใน ad template / order ที่เคยยิง\nวันตัดตามเวลาไทย · UTM ที่หลาย workspace ใช้ร่วมนับเต็มให้ทุก workspace (ยอดรวมนับครั้งเดียว)',
  'rf-tile-depositors': 'ผลรวมคนฝากครั้งแรก (register_deposit_user) จากระบบ UTM\nกติกาเดียวกับคนสมัคร',
  'rf-tile-deposit': 'ผลรวมยอดฝาก (register_deposit_amount) จากระบบ UTM\nกติกาเดียวกับคนสมัคร',
  'rf-tile-costReg': 'Cost per Register = Spend ÷ คนสมัคร\nยิ่งต่ำยิ่งดี · "—" เมื่อไม่มีคนสมัคร',
  'rf-tile-costDep': 'Cost per Deposit = Spend ÷ คนฝาก\nยิ่งต่ำยิ่งดี · "—" เมื่อไม่มีคนฝาก',
  'rf-tile-avgDep': 'Average Deposit = ยอดฝาก ÷ คนฝาก\n"—" เมื่อไม่มีคนฝาก',
  'rf-tile-depReg': 'Dep / Reg = คนฝาก ÷ คนสมัคร × 100\nเทียบช่วงก่อนเป็นจุดเปอร์เซ็นต์ (pt)',
  'rf-tile-depBudget': 'Dep / Budget = ยอดฝาก ÷ Spend × 100 (%)\nมากกว่า 100% = ยอดฝากมากกว่าค่าโฆษณา\nเทียบช่วงก่อนเป็นจุดเปอร์เซ็นต์ (pt)',
  'rf-now-accounts': 'TikTok account ทั้งหมดใน workspace ที่เลือก\nadvertiser = บัญชีโฆษณาที่ยังเห็นใน Business Center (ไม่นับที่หายไปแล้ว)\nตัวเลขใหญ่ = ในช่วงวันที่เลือก (ดูไอคอนข้างตัวเลข) · บรรทัด "ตอนนี้" ใต้ตัวเลข = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน',
  'rf-now-banned': 'advertiser ที่รอบ kpi ล่าสุดอ่านได้ว่า TikTok ระงับ (account status 8) และยังไม่ถูกปลด\nตัวเลขใหญ่ = ในช่วงวันที่เลือก (ดูไอคอนข้างตัวเลข) · บรรทัด "ตอนนี้" ใต้ตัวเลข = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน',
  'rf-now-launching': 'advertiser ที่ธง "กำลังยิงโฆษณา" เปิดอยู่ (มี build เผยแพร่แล้วและรอบ kpi ยังเห็นโฆษณา)\n"ไม่ส่ง" = ธงเปิดแต่รอบ kpi ล่าสุดเห็นว่าโฆษณาทุกตัวไม่ส่ง (เช่น เงินหมด)\nตัวเลขใหญ่ = ในช่วงวันที่เลือก (ดูไอคอนข้างตัวเลข) · บรรทัด "ตอนนี้" ใต้ตัวเลข = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน',
  'rf-range-accounts': ['จำนวน TikTok account และ advertiser ที่มีอยู่ในช่วงที่เลือก: สร้างก่อนสิ้นสุดช่วง และยังไม่ถูกลบ/หายไปก่อนเริ่มช่วง (ที่ถูกลบในหรือหลังช่วงยังนับ · ช่วง "ทั้งหมด" นับทุกตัวรวมที่ลบแล้ว)', RANGE_LIMITS_LIFECYCLE].join('\n'),
  'rf-range-banned': ['ระงับ = จำนวน advertiser (นับ advertiser ละหนึ่งครั้ง ถูกระงับซ้ำในช่วงเดียวกันนับครั้งเดียว) ที่ระบบบันทึกว่าถูก TikTok ระงับในช่วง · ปลด = advertiser ที่ถูกปลดระงับในช่วง', 'ต่างจากตัวเลข "ระงับ" ในตารางรายวันที่นับจำนวนครั้ง', RANGE_LIMITS].join('\n'),
  'rf-range-launching': ['advertiser ที่ธง "กำลังยิงโฆษณา" เปิดอยู่ ณ เวลาใดเวลาหนึ่งในช่วง: เปิดธงในช่วง หรือเปิดไว้ก่อนช่วงและยังไม่ถูกปิด/ระงับจนถึงเริ่มช่วง (นับ advertiser ละหนึ่งครั้ง)', RANGE_LIMITS_LAUNCHING].join('\n'),
  'rf-watch': 'รายการที่ต้องมีคนดู ณ ตอนนี้: advertiser ถูกระงับ · บัญชีที่ login ค้างต้องมีคน (OTP/ยืนยันตัวตน) · บัญชีที่หลุด login · advertiser ที่ยิงอยู่แต่โฆษณาไม่ส่ง (พร้อมเหตุผลดิบจาก TikTok)',
  'rf-table-day-col-spend': 'spend ของวันนั้น (กติกาเดียวกับการ์ด Spend)',
  'rf-table-day-col-used': 'advertiser ที่มี spend > 0 ในวันนั้น',
  'rf-table-day-col-bans': 'จำนวนครั้งที่ระบบบันทึกว่า advertiser ถูกระงับในวันนั้น (audit log advertiser.banned)\nวันที่ = วันที่รอบ kpi เห็น ไม่ใช่วันที่ TikTok ระงับจริง',
  'rf-table-day-col-lifted': 'จำนวนครั้งที่ระบบบันทึกว่า advertiser ถูกปลดระงับในวันนั้น (audit log advertiser.ban.lifted)',
  'rf-table-day-col-runs': 'build (ใบสั่งยิงโฆษณาต่อ advertiser) ที่สั่งในวันนั้น นับตามเวลาที่สั่ง',
  'rf-table-day-col-done': 'build ที่ตอนนี้เผยแพร่แล้ว (published) หรือสร้างเป็นฉบับร่างเสร็จ (ready)',
  'rf-table-day-col-failed': 'build ที่ตอนนี้ล้ม (failed)',
  'rf-table-day-col-stopped': 'build ที่ถูกยกเลิก (cancelled)',
  'rf-table-day-col-running': 'build ที่ยังอยู่ในคิวหรือกำลังสร้าง (queued / running)',
  'rf-table-workspace-col-spend': 'spend ของ advertiser ใน workspace นี้ในช่วง',
  'rf-table-workspace-col-used': 'advertiser ของ workspace นี้ที่มี spend > 0',
  'rf-table-workspace-col-registers': 'คนสมัครของ UTM ที่ workspace นี้ใช้ (นับเต็ม แม้ workspace อื่นใช้ร่วม)',
  'rf-table-workspace-col-depositors': 'คนฝากของ UTM ที่ workspace นี้ใช้',
  'rf-table-workspace-col-depositAmount': 'ยอดฝากของ UTM ที่ workspace นี้ใช้',
  'rf-table-workspace-col-costReg': 'Spend ÷ คนสมัคร',
  'rf-table-workspace-col-costDep': 'Spend ÷ คนฝาก',
  'rf-table-workspace-col-avgDep': 'ยอดฝาก ÷ คนฝาก',
  'rf-table-workspace-col-depReg': 'คนฝาก ÷ คนสมัคร × 100',
  'rf-table-workspace-col-depBudget': 'ยอดฝาก ÷ Spend × 100 (%)',
  'rf-table-workspace-col-bans': 'advertiser ของ workspace นี้ที่ถูกระงับในช่วง (audit log)',
  'rf-table-workspace-col-runs': 'build ของ workspace นี้ที่สั่งในช่วง',
  'rf-table-workspace-col-accounts': 'TikTok account ของ workspace นี้ตอนนี้',
  'rf-table-workspace-col-banned': 'advertiser ของ workspace นี้ที่ถูกระงับอยู่ตอนนี้',
  'rf-table-workspace-col-launching': 'advertiser ของ workspace นี้ที่กำลังยิงโฆษณาตอนนี้',
  'rf-table-utm-col-owner': 'เจ้าของ UTM key ชุดนี้ (หนึ่ง key = หนึ่งคน) — ยอดสมัคร/ฝากของ key นี้ถูกคิดให้คนนี้\nย้ายเจ้าของได้ที่ Settings → UTM keys · "—" = key ที่ยังไม่มีเจ้าของ',
  'rf-table-utm-col-advertisers': 'จำนวน advertiser ที่มีโฆษณาถือ UTM ชุดนี้ (ทุก workspace)',
  'rf-table-utm-col-spend': 'ค่าโฆษณาของโฆษณาทุกตัวที่ถือ UTM ชุดนี้ ทุก workspace ในช่วง\n"—" = ยังไม่มีโฆษณาจากระบบที่ถือ UTM นี้',
  'rf-table-utm-col-registers': 'คนสมัครของ UTM ชุดนี้จากระบบ UTM ในช่วง',
  'rf-table-utm-col-depositors': 'คนฝากของ UTM ชุดนี้',
  'rf-table-utm-col-depositAmount': 'ยอดฝากของ UTM ชุดนี้',
  'rf-table-utm-col-costReg': 'Spend ของ UTM ÷ คนสมัคร',
  'rf-table-utm-col-costDep': 'Spend ของ UTM ÷ คนฝาก',
  'rf-table-utm-col-avgDep': 'ยอดฝาก ÷ คนฝาก',
  'rf-table-utm-col-depReg': 'คนฝาก ÷ คนสมัคร × 100',
  'rf-table-utm-col-depBudget': 'ยอดฝาก ÷ Spend ของ UTM × 100 (%)',
  'rf-table-account-col-spend': 'spend ของ advertiser นี้ในช่วง (แถวรวมรายวันของ TikTok)',
  'rf-table-account-col-state': 'สถานะตอนนี้ เรียงตามความสำคัญ: ถูกระงับ → ต้องมีคน (login ค้าง OTP/ยืนยันตัวตน) → หลุด login → ไม่ส่ง (ยิงอยู่แต่โฆษณาไม่ส่ง) → กำลังยิง → ปกติ',

  // ── Dashboard `rd` ────────────────────────────────────────────────────────────────────────────────────────────────
  'rd-hero': 'Dep / Budget = ยอดฝาก ÷ Spend × 100 (%)\nมากกว่า 100% = ยอดฝากมากกว่าค่าโฆษณา\nยอดฝากจากระบบ UTM ของ UTM ที่ workspace ใช้ · Spend จากยอดรวมรายวันของ TikTok\nเทียบกับช่วงก่อนหน้าที่ยาวเท่ากันเป็นจุดเปอร์เซ็นต์ (pt)',
  'rd-tile-depBudget': 'Dep / Budget = ยอดฝาก ÷ Spend × 100 (%)\nมากกว่า 100% = ยอดฝากมากกว่าค่าโฆษณา\nยอดฝากจากระบบ UTM ของ UTM ที่ workspace ใช้ · Spend จากยอดรวมรายวันของ TikTok\nเทียบกับช่วงก่อนหน้าที่ยาวเท่ากันเป็นจุดเปอร์เซ็นต์ (pt)',
  'rd-tile-spend': 'ค่าโฆษณารวมในช่วง จากยอดรวมรายวันที่ job kpi ดึงจาก TikTok Ads\nเป็น THB: บัญชีสกุลอื่นแปลงด้วยอัตรา mid-market ของวันนั้น (fastforex) · ยอดที่แปลงไม่ได้แสดงแยกเป็น +n ?',
  'rd-tile-impressions': 'จำนวนครั้งที่โฆษณาถูกแสดง (impressions ของ TikTok) รวมทุก advertiser ในช่วง\nCPM = Spend ÷ impressions × 1,000 (คิดใหม่จากผลรวม ไม่ใช่ค่าเฉลี่ยของแต่ละบัญชี)',
  'rd-tile-clicks': 'จำนวนคลิก (clicks ของ TikTok) รวมในช่วง\nCTR = clicks ÷ impressions × 100 · CPC = Spend ÷ clicks (คิดใหม่จากผลรวม)',
  'rd-tile-conversions': 'conversions ตามที่ TikTok นับ (pixel/event ของ ad account) รวมในช่วง\nCost/Conv = Spend ÷ conversions · Conv rate = conversions ÷ clicks × 100\nคนละตัวกับคนสมัคร/คนฝากของระบบ UTM',
  'rd-tile-registers': 'คนสมัคร (total_register) จากระบบ UTM ของ UTM ที่ workspace ใช้ ตัดวันตามเวลาไทย\nCost/Reg = Spend ÷ คนสมัคร',
  'rd-tile-depositors': 'คนฝากครั้งแรก (register_deposit_user) จากระบบ UTM\nCost/Dep = Spend ÷ คนฝาก · FTD = คนฝาก ÷ คนสมัคร × 100',
  'rd-tile-deposit': 'ยอดฝาก (register_deposit_amount) จากระบบ UTM\nAvg deposit = ยอดฝาก ÷ คนฝาก',
  'rd-tile-winLose': 'Win-Lose = ยอดฝาก − ยอดถอน (register_withdraw_amount) จากระบบ UTM ในช่วง',
  'rd-funnel': 'แต่ละขั้นเทียบเป็น % ของขั้นก่อนหน้า (clicks ÷ impressions, conversions ÷ clicks, สมัคร ÷ conversions, ฝาก ÷ สมัคร)\nสามขั้นแรกมาจาก TikTok สองขั้นท้ายมาจากระบบ UTM จึงเป็นคนละแหล่งนับ\nความยาวแถบใช้สเกล log',
  'rd-chart': 'รายวัน = ผลรวมต่อวันของ Spend (TikTok) กับ ยอดฝาก / คนสมัคร / คนฝาก (ระบบ UTM)\nวันนี้รายชั่วโมง = ยอดสะสมตั้งแต่ต้นวันถึงแต่ละชั่วโมง จากจุดรายชั่วโมงที่ job kpi เก็บ (ของแต่ละ advertiser ใช้ค่าล่าสุดที่มีถึงชั่วโมงนั้น แล้วรวมกัน) มีเฉพาะเมื่อช่วงรวมวันนี้',
  'rd-delivery': 'ตัวเลขใหญ่ในแต่ละการ์ดเปลี่ยนตามช่วงวันที่เลือก\nส่วน "ตอนนี้" = สถานะล่าสุดจากรอบ kpi ไม่ขึ้นกับช่วงวัน',
  'rd-range-launching': ['advertiser ที่ธง "กำลังยิงโฆษณา" เปิดอยู่ ณ เวลาใดเวลาหนึ่งในช่วง: เปิดธงในช่วง หรือเปิดไว้ก่อนช่วงและยังไม่ถูกปิด/ระงับจนถึงเริ่มช่วง (นับ advertiser ละหนึ่งครั้ง)', RANGE_LIMITS_LAUNCHING].join('\n'),
  'rd-range-stopped': ['จำนวน advertiser ที่ระบบบันทึกว่าเปลี่ยนจาก "ส่ง" เป็น "ไม่ส่ง" ในช่วง (นับ advertiser ละหนึ่งครั้ง หยุดซ้ำนับครั้งเดียว)', RANGE_LIMITS].join('\n'),
  'rd-range-resumed': ['จำนวน advertiser ที่ระบบบันทึกว่ากลับมาส่งโฆษณาได้อีกครั้งในช่วง (นับ advertiser ละหนึ่งครั้ง)', RANGE_LIMITS].join('\n'),
  'rd-range-reasons': ['เหตุผลดิบจาก TikTok ของ advertiser ที่หยุดส่งในช่วง นับจำนวน advertiser ต่อเหตุผล (advertiser เดียวหยุดซ้ำด้วยเหตุผลเดิมนับครั้งเดียว) เรียงมากไปน้อย สูงสุด 10 รายการ · วางเมาส์เหนือแถวเพื่อดูค่าดิบ', RANGE_LIMITS].join('\n'),
  'rd-delivery-launching': 'advertiser ที่ธง "กำลังยิงโฆษณา" เปิดอยู่ (มี build เผยแพร่และรอบ kpi ยังเห็นโฆษณา)',
  'rd-delivery-delivering': 'จากกลุ่มที่ยิงอยู่: รอบ kpi ล่าสุดเห็นโฆษณาอย่างน้อยหนึ่งตัวส่งอยู่',
  'rd-delivery-notDelivering': 'จากกลุ่มที่ยิงอยู่: รอบ kpi ล่าสุดเห็นว่าโฆษณาทุกตัวไม่ส่ง (เช่น เงินหมด งบหมด ไม่ผ่านตรวจ) · เหตุผลคือค่าดิบที่ TikTok ส่งมา',
  'rd-delivery-unknown': 'จากกลุ่มที่ยิงอยู่: ยังไม่เคยประเมินการส่ง (ยังไม่มีรอบ kpi ที่ครบ)',
  'rd-delivery-reasons': 'เหตุผลดิบจาก TikTok ของ advertiser ที่ไม่ส่ง นับจำนวน advertiser ต่อเหตุผล',
  'rd-ads-states': 'โฆษณาทุกตัวที่ยังเห็นบน TikTok แยกตามสถานะที่รอบ kpi ล่าสุดอ่านได้: กำลังส่ง · รอตรวจ · ไม่ผ่านตรวจ · จบแล้ว · ไม่รู้\nบรรทัด "ตอนนี้" = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน ส่วนตัวเลขใหญ่ = ในช่วงวันที่เลือก',
  'rd-range-ads': ['โฆษณาที่มีข้อมูลรายโฆษณาในช่วงที่เลือก นับโฆษณาละหนึ่งครั้ง แยกตามสถานะของวันล่าสุดในช่วงที่รอบ kpi อ่านได้ภายในช่วงนั้น (รวมโฆษณาที่ตอนนี้หายไปแล้ว) · ยอดรวมรวม "ไม่รู้" ด้วย', RANGE_LIMITS].join('\n'),
  'rd-pending': 'สวิตช์เปิด/ปิดหรือการลบแคมเปญที่สั่งไปแล้วยังรอ job ทำ หรือครั้งล่าสุดทำไม่สำเร็จ',
  'rd-banned': 'advertiser ที่รอบ kpi ล่าสุดอ่านได้ว่า TikTok ระงับ (account status 8) และยังไม่ถูกปลด\nบรรทัด "ตอนนี้" = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน ส่วนตัวเลขใหญ่ = ในช่วงวันที่เลือก',
  'rd-range-banned': ['ระงับ = จำนวน advertiser (นับ advertiser ละหนึ่งครั้ง) ที่ระบบบันทึกว่าถูก TikTok ระงับในช่วง · ปลด = advertiser ที่ถูกปลดระงับในช่วง', RANGE_LIMITS].join('\n'),
  'rd-rejected': 'โฆษณาที่สถานะล่าสุด = ไม่ผ่านตรวจ พร้อมเหตุผลจาก TikTok ใหม่สุดก่อน (ไม่เกิน 50)',
  'rd-not-delivering': 'advertiser ที่ยิงอยู่แต่โฆษณาไม่ส่ง พร้อมเหตุผลดิบและเวลาที่เริ่มไม่ส่ง',
  'rd-table-workspace-col-spend': 'spend ของ workspace นี้ในช่วง',
  'rd-table-workspace-col-impressions': 'impressions รวมของ workspace นี้',
  'rd-table-workspace-col-clicks': 'clicks รวมของ workspace นี้',
  'rd-table-workspace-col-conversions': 'conversions (TikTok) รวมของ workspace นี้',
  'rd-table-workspace-col-registers': 'คนสมัครของ UTM ที่ workspace นี้ใช้',
  'rd-table-workspace-col-depositors': 'คนฝากของ UTM ที่ workspace นี้ใช้',
  'rd-table-workspace-col-depositAmount': 'ยอดฝากของ UTM ที่ workspace นี้ใช้',
  'rd-table-workspace-col-depBudget': 'ยอดฝาก ÷ Spend ของ workspace นี้ × 100 (%)',
  'rd-table-workspace-col-accounts': 'TikTok account ของ workspace นี้ตอนนี้',
  'rd-table-workspace-col-launching': 'advertiser ที่กำลังยิงโฆษณาตอนนี้',
  'rd-table-workspace-col-banned': 'advertiser ที่ถูกระงับอยู่ตอนนี้',
  'rd-table-account-col-spend': 'spend ของ advertiser นี้ในช่วง',
  'rd-table-account-col-impressions': 'impressions ของ advertiser นี้',
  'rd-table-account-col-clicks': 'clicks ของ advertiser นี้',
  'rd-table-account-col-conversions': 'conversions (TikTok) ของ advertiser นี้',
  'rd-table-account-col-registers': 'คนสมัครของ UTM ที่ advertiser นี้ใช้ (UTM ชุดเดียวกันที่ advertiser อื่นใช้ด้วยจะนับเต็มให้ทุกตัว — มีป้าย "UTM ร่วม")',
  'rd-table-account-col-depositors': 'คนฝากของ UTM ที่ advertiser นี้ใช้',
  'rd-table-account-col-depositAmount': 'ยอดฝากของ UTM ที่ advertiser นี้ใช้',
  'rd-table-account-col-depBudget': 'ยอดฝาก ÷ Spend ของ advertiser นี้ × 100 (%)',
  'rd-table-account-col-state': 'สถานะตอนนี้ เรียงตามความสำคัญ: ถูกระงับ → ต้องมีคน → หลุด login → ไม่ส่ง → กำลังยิง → ปกติ',

  // ── Post performance `rp` (FEAT-089) ─────────────────────────────────────────────────────────────────────────────
  'rp-sum-builds': 'จำนวน build (เผยแพร่แล้ว) ในช่วงที่เลือก นับตามวันที่เผยแพร่ ไม่ใช่วันที่สั่ง\nโพสต์ = จำนวนคีย์โพสต์ที่ต่างกัน (เสมอนับแบบ post ไม่ว่าเลนส์ไหน) · บัญชี = TikTok account ที่ต่างกัน',
  'rp-sum-approved': 'สัดส่วน build ที่ TikTok ตรวจผ่าน (ผ่าน ÷ (ผ่าน + ปฏิเสธ))\nรอ = เผยแพร่มาไม่ถึง 7 วันและยังไม่เห็นผล · ไม่รวมในสัดส่วน · แบนก่อนตรวจ = บัญชีโดนแบนก่อนที่โฆษณาจะได้ผ่านตรวจ (ไม่รวมในสัดส่วนเหมือนกัน)\nbuild = การยิงหนึ่งครั้งบนหนึ่ง advertiser · ad = สำเนาโฆษณาแต่ละตัวที่ TikTok ตรวจแยกกัน',
  'rp-sum-review': 'เวลาตรวจ = เวลาตั้งแต่เผยแพร่ถึงสัญญาณแรกที่โฆษณาได้ส่ง (impression แรก / สถานะ delivering แรก) เฉพาะ build ที่ผ่านตรวจ\nmedian / P90 (ช้าสุด 10%) · ภายใน 24 ชม. = สัดส่วนที่ผ่านตรวจเร็วกว่า 1 วัน',
  'rp-sum-survival': 'สัดส่วน build ที่ผ่านตรวจแล้วและยังอยู่ (ไม่ถูกแบน/หาย/ลบ) ถึงวันที่ 7 หลังผ่านตรวจ\nนับเฉพาะ build ที่ครบ 7 วันแล้วหรือจบไปแล้วก่อนครบ (decided)',
  'rp-sum-survival-advertiser-banned': 'นับทุก build ที่ advertiser โดนแบนหลังเผยแพร่ ไม่ว่าจะทันผ่านตรวจหรือไม่ — แถว "แบน" ด้านบนนับเฉพาะ build ที่ผ่านตรวจแล้ว',
  'rp-sum-money': 'Dep/Budget ของทั้ง cohort = ยอดฝาก ÷ Spend (ค่าโฆษณาทุกวันตั้งแต่เผยแพร่ถึงวันนี้ ไม่ตัดตามช่วงที่เลือก)\nSpend เป็น THB (แปลงด้วยอัตรารายวัน) · ยอดฝากจาก UTM key ของ build ในกลุ่ม\nUTM key หนึ่งอันมักใช้ร่วมกับหลายโพสต์/หลาย prefix — ยอดฝากที่เห็นเป็นของทั้ง key ไม่ใช่ของ cohort นี้อย่างเดียว (ดูป้าย "แชร์ key")',
  'rp-table-col-builds': 'จำนวน build ทั้งหมดของแถวนี้ในช่วง · บัญชี = TikTok account ที่ต่างกัน\nbuild = การยิงหนึ่งครั้งบนหนึ่ง advertiser · ad = สำเนาโฆษณาแต่ละตัวที่ TikTok ตรวจแยกกัน',
  'rp-table-col-approved': 'build ที่ผ่านตรวจ ÷ (ผ่าน + ปฏิเสธ) ของแถวนี้ · บรรทัดล่าง ad = สำเนาโฆษณาที่ผ่านตรวจแยกต่อตัว\nbuild = การยิงหนึ่งครั้งบนหนึ่ง advertiser · ad = สำเนาโฆษณาแต่ละตัวที่ TikTok ตรวจแยกกัน',
  'rp-table-col-review': 'เวลาตรวจ = เวลาตั้งแต่เผยแพร่ถึงสัญญาณแรกที่โฆษณาได้ส่ง (impression แรก / สถานะ delivering แรก)\nmedian = เวลาตรวจเฉลี่ย · P90 = ช้าสุด 10% ของ build ที่ผ่านตรวจในแถวนี้',
  'rp-table-col-rejected': 'จำนวน build ที่ถูกปฏิเสธ + เหตุผลที่เจอบ่อยที่สุด (จากข้อความของ TikTok)',
  'rp-table-col-survival': 'อายุเฉลี่ย (median วัน) ของ build ที่จบแล้ว (แบน/หาย/ลบ) + จำนวนที่ถูกแบน (survival)\n"บัญชีโดนแบน" (เมื่อมากกว่าจำนวนแบน) = นับทุก build ที่ advertiser โดนแบนหลังเผยแพร่ ไม่ว่าจะทันผ่านตรวจหรือไม่',
  'rp-table-col-spend': 'ค่าโฆษณารวมของ build ในแถวนี้ ทุกวันตั้งแต่เผยแพร่ถึงวันนี้ เป็น THB',
  'rp-table-col-deposit': 'ยอดฝากของ UTM key ที่ build ในแถวนี้ถือ ตั้งแต่วันที่เผยแพร่แรกถึงวันนี้\nUTM เดียวกันที่แถวอื่นถือร่วมจะนับเต็มให้ทั้งสองแถว — ป้าย "แชร์ key" = key นี้มีรายการอื่นถือร่วมในช่วงนี้ด้วย ยอดฝากจึงไม่ใช่ของแถวนี้อย่างเดียว',
  'rp-table-col-depBudget': 'Dep/Budget = ยอดฝาก ÷ Spend ของแถวนี้ (ไม่ใช่ %)',
  'rp-table-col-costDep': 'Cost/Dep = Spend ÷ จำนวนคนฝากของ UTM key ที่แถวนี้ถือ',
  'rp-table-col-enough': `ข้อมูลพอให้จัดอันดับเมื่อ build ที่ผ่านตรวจ ≥ เกณฑ์ขั้นต่ำ และ spend ≥ เกณฑ์ขั้นต่ำ (ตั้งค่าใน env ฝั่ง API)\nแถวที่ยังไม่พอจะถูกซ่อนเมื่อเปิดสวิตช์ "เฉพาะแถวที่ข้อมูลพอ"`,
  'rp-card-review': 'ผ่านตรวจ = ผ่าน ÷ (ผ่าน + ปฏิเสธ) · median/P90 = เวลาตรวจของ build ที่ผ่าน (เวลาตั้งแต่เผยแพร่ถึงสัญญาณแรกที่โฆษณาได้ส่ง — impression แรก / สถานะ delivering แรก) · ภายใน 24 ชม. = สัดส่วนที่ผ่านเร็วกว่า 1 วัน\nแบนก่อนตรวจ = บัญชีโดนแบนก่อนที่โฆษณาจะได้ผ่านตรวจ\nยื่นอุทธรณ์ = มีการส่งอุทธรณ์จริง (ไม่ใช่ dry run) · อุทธรณ์ผ่าน = อุทธรณ์ที่ TikTok อนุมัติ',
  'rp-card-survival': 'อายุเฉลี่ย (median) ของ build ที่จบแล้ว (แบน/หาย/ลบ) จากวันที่ผ่านตรวจ\nรอดถึง D3/D7 = สัดส่วนที่ยังอยู่ถึงวันนั้น จาก build ที่ครบกำหนดหรือจบไปแล้ว (decided)\nปิดเอง = ปิดสวิตช์ด้วยมือ ยังนับเป็น "ยังส่งอยู่" เพราะเปิดกลับได้ · ลบ = ทุกโฆษณาของ build ถูกลบ',
  'rp-card-survival-advertiser-banned': 'นับทุก build ที่ advertiser โดนแบนหลังเผยแพร่ ไม่ว่าจะทันผ่านตรวจหรือไม่ — แถว "แบน" ด้านบนนับเฉพาะ build ที่ผ่านตรวจแล้ว',
  'rp-card-money': 'Dep/Budget = ยอดฝาก ÷ Spend ของทุก build ในแถวนี้ ตั้งแต่เผยแพร่ถึงวันนี้\nSpend/build และ Deposit/build หารด้วยจำนวน build ที่ผ่านตรวจ\nUTM key หนึ่งอันมักใช้ร่วมกับหลายโพสต์/หลาย prefix — ป้าย "แชร์ key" บอกว่ายอดฝากที่เห็นเป็นของทั้ง key ไม่ใช่ของรายการนี้อย่างเดียว',
  'rp-funnel': 'ชะตาของ build ทั้งหมดของรายการนี้: เผยแพร่ → ผ่านตรวจ (TikTok) → มี spend > 0 → มี deposit ของ UTM key ตัวเอง > 0 → รอดถึง D7 → ยังส่งอยู่ตอนนี้\n"บัญชีโดนแบน" ที่ท้ายกราฟ นับทุก build ที่ advertiser โดนแบนหลังเผยแพร่ ไม่ว่าจะทันผ่านตรวจหรือไม่ (มากกว่าตัวเลข "แบนก่อนตรวจ"/"แบน" ในกราฟได้)',
  'rp-byday': 'Spend เฉลี่ยและ deposit เฉลี่ยต่อ build ของวันที่ k หลังผ่านตรวจ (เฉลี่ยจาก build ที่ยังอยู่ถึงวันนั้นเท่านั้น)\nไม่มีข้อมูล = ยังไม่มี build ที่ถึงวันนั้น หรือ build ทุกตัวจบไปแล้วก่อนวันนั้น',
  'rp-reasons': 'เหตุผลที่ TikTok ปฏิเสธ build ของรายการนี้ เรียงจากพบมากสุด พร้อม template ที่เจอ (สูงสุด 5 ชื่อ)',
  'rp-setups': 'ผลลัพธ์ของรายการนี้ แยกตาม "ค่าตั้ง" อีกชั้น (เลนส์โพสต์ → แยกตาม ad group template · เลนส์อื่น → แยกตามโพสต์)\nคอลัมน์และเกณฑ์ข้อมูลพอเหมือนตารางหลัก',

  // ── Challenge `rc` (FEAT-094) ─────────────────────────────────────────────────────────────────────────────────────
  'rc-card-hero': 'ค่าที่ใช้จัดอันดับ: "คุ้ม" = ได้ยอด ÷ ยิงไป × 100 (จุดร้อยละ) · "ได้ยอดมากสุด" = ยอดฝาก (THB) ของช่วงที่เลือก\nสลับได้จากปุ่ม "จัดอันดับตาม" ด้านบน · คนที่ยิงไป = 0 จะไม่มีอันดับตอนจัดด้วย "คุ้ม"',
  'rc-card-spend': 'ยิงไป = ค่าโฆษณารวม (spend) ของ advertiser ทุกตัวในทุก workspace ที่คนนี้เป็นเจ้าของ ในช่วงที่เลือก\nเป็น THB: บัญชีสกุลอื่นแปลงด้วยอัตรา mid-market ของวันนั้น (fastforex) · ยอดที่แปลงไม่ได้แสดงแยกเป็น +n ?',
  'rc-card-deposit': 'ได้ยอด = ยอดฝาก (deposit) จากระบบ UTM ของ key ที่คนนี้เป็นเจ้าของ ในช่วงที่เลือก\nkey ที่หลาย workspace ใช้ร่วมกันนับเต็มให้เจ้าของ key (ไม่ใช่ตามคนที่ยิง)',
  'rc-card-launching': 'จำนวน advertiser ที่กำลังยิงอยู่ตอนนี้ (ไม่ขึ้นกับช่วงที่เลือก) แยกตามสถานะส่งโฆษณา\nจุดเขียว = ส่งอยู่ (delivering) · จุดเหลือง = ไม่ส่ง (notDelivering) · จุดเทา = ไม่ทราบ (unknown)',
  'rc-card-ads': 'โฆษณา 3 ตัวที่ conversions (TikTok) สูงสุดของคนนี้ในช่วงที่เลือก\nยอดฝากแยกต่อโฆษณาไม่ได้ (UTM ผูกกับ build ไม่ใช่โฆษณาเดี่ยว) จึงจัดอันดับด้วย conversions แทน'
}
