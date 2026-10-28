/** Clips recorded by `?record`, in order. Instructions are shown to the person on screen. */
export interface ClipSpec {
  id: string;
  instruction: string;
  seconds: number;
}

export const RECORD_SCRIPT: readonly ClipSpec[] = [
  {
    id: 'walk-in-out',
    instruction: 'เดินเข้ามายืนกลางจอ ยืนนิ่ง 3 วินาที แล้วเดินออกไปจนพ้นกล้อง',
    seconds: 10,
  },
  { id: 'idle-stand', instruction: 'ยืนนิ่ง ๆ ปล่อยมือข้างลำตัว', seconds: 6 },
  {
    id: 'idle-fidget',
    instruction: 'ยืนตามสบาย ขยับตัว เกาหัว จับหน้า กอดอก (ห้ามยกมือชี้)',
    seconds: 8,
  },
  {
    id: 'point-right-sweep',
    instruction: 'ยกมือขวาชี้ไปที่จอ แล้วลากไปทั่วจอช้า ๆ (บน ล่าง ซ้าย ขวา)',
    seconds: 8,
  },
  {
    id: 'point-left-sweep',
    instruction: 'ยกมือซ้ายชี้ไปที่จอ แล้วลากไปทั่วจอช้า ๆ',
    seconds: 8,
  },
  {
    id: 'point-hold',
    instruction: 'ชี้มือขวาไปจุดหนึ่ง ค้างนิ่ง 3 วินาที แล้วลดมือ — ทำ 2 รอบ',
    seconds: 10,
  },
  {
    id: 'raise-right',
    instruction: 'ยกมือขวาจากระดับเอวขึ้นจนสุดแขน แล้วลดลง ช้า ๆ 3 รอบ',
    seconds: 10,
  },
  { id: 'raise-both', instruction: 'ชูสองมือเหนือหัว แล้วลดลง — 2 รอบ', seconds: 8 },
  { id: 'throw', instruction: 'ทำท่าขว้างลูกบอลไปที่จอ 3 ครั้ง', seconds: 8 },
  { id: 'slap', instruction: 'ตบอากาศข้างหน้าเร็ว ๆ สลับมือซ้ายขวา 4 ครั้ง', seconds: 8 },
  {
    id: 'draw',
    instruction: 'ยกมือขวาเหนือไหล่ ลากเส้นช้า ๆ จากซ้ายไปขวา แล้วลดมือ — 2 รอบ',
    seconds: 10,
  },
  { id: 'swipe', instruction: 'ปัดมือขวาไปทางซ้ายแล้วทางขวา 3 ครั้ง', seconds: 8 },
  {
    id: 'free-play',
    instruction: 'เล่นตามปกติเหมือนตอนกดปุ่มใน playground — ชี้ไปมา ชี้ค้าง สลับมือ',
    seconds: 30,
  },
];
