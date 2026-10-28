# Contributing

## Branching model

```
main ────●──────────────────●──────────────● ← v0.1.0, v0.2.0 … (production, tag เท่านั้น)
          \                / \            /
release    \     release/v0.2.0  …       /
            \            /              /
develop ─────●───●───●──●───●───●──●───●     ← integration branch
              \ /   \ /        \ /
feature/*      ●     ●          ●            ← งานย่อย 1 branch = 1 PR
```

| Branch | มาจาก | merge เข้า | ใช้ทำ |
|---|---|---|---|
| `main` | – | – | โค้ดที่พร้อมใช้หน้างาน, ทุก commit มี tag |
| `develop` | `main` | – | รวมงานที่เสร็จแล้ว |
| `feature/<scope>-<desc>` | `develop` | `develop` | ฟีเจอร์ใหม่ |
| `fix/<scope>-<desc>` | `develop` | `develop` | แก้บั๊ก |
| `chore/<desc>` | `develop` | `develop` | งาน config/tooling |
| `docs/<desc>` | `develop` | `develop` | เอกสาร |
| `test/<desc>` | `develop` | `develop` | เพิ่ม test / fixture |
| `ci/<desc>` | `develop` | `develop` | CI/CD |
| `content/<desc>` | `develop` | `develop` | บทพูด/ข้อมูล/เสียง |
| `release/vX.Y.Z` | `develop` | `main` + `develop` | เตรียม release (bump version, changelog) |
| `hotfix/<desc>` | `main` | `main` + `develop` | แก้ด่วนหน้างาน |

**ตั้งชื่อ:** ตัวพิมพ์เล็ก, คั่นด้วย `-`, สั้นและบอกความหมาย
✅ `feature/gesture-cursor-dwell` ❌ `feature/NewStuff`, `kittipoom-test`

## Commit messages — Conventional Commits

```
<type>(<scope>): <subject>

[body — อธิบาย "ทำไม" ไม่ใช่ "ทำอะไร"]

[footer — Refs #12, BREAKING CHANGE: …]
```

**type:** `feat` `fix` `perf` `refactor` `test` `docs` `style` `chore` `ci` `build` `content`

**scope:** `perception` `gesture` `input` `core` `narrative` `scoring` `render` `hud` `audio` `storage` `debug` `scene-<id>` `data` `infra` `docs`

ตัวอย่าง
```
feat(gesture): add dwell detector with hysteresis
fix(perception): prevent player switch while locked
perf(render): reuse particle buffers to avoid GC spikes
content(story): draft coffee-pricing chapter lines
```

- Subject เป็นภาษาอังกฤษ, ขึ้นต้นด้วย verb รูปปัจจุบัน, ไม่เกิน 72 ตัวอักษร, ไม่มีจุดท้าย
- 1 commit = 1 เรื่อง

## Pull requests

- PR เข้า `develop` ด้วย **Squash merge** (ประวัติ `develop` สะอาด 1 PR = 1 commit)
- `release/*` → `main` ด้วย **Merge commit** (เก็บขอบเขต release)
- ชื่อ PR ใช้รูปแบบ Conventional Commit เหมือน commit
- ต้องผ่าน CI ทั้งหมด (lint, typecheck, test, build)
- งานที่กระทบ performance ต้องแนบตัวเลข fps/latency จากเครื่องเป้าหมาย
- งานที่กระทบภาพ ต้องแนบภาพหน้าจอหรือวิดีโอสั้น

## Branch protection

| Branch | กฎ |
|---|---|
| `main` | ห้าม push ตรง, ต้องผ่าน PR + CI, ห้าม force push |
| `develop` | ห้าม push ตรง, ต้องผ่าน PR + CI, ห้าม force push |

## Versioning — SemVer

- `0.x.y` ระหว่างพัฒนา, `1.0.0` = พร้อมใช้งานจริง
- minor (`0.x.0`) = จบ milestone / เพิ่มฉาก, patch (`0.x.y`) = แก้บั๊ก
- ทุก release มี tag `vX.Y.Z` + GitHub Release + `CHANGELOG.md`

## Code standards

- TypeScript `strict`, ห้าม `any` (ใช้ `unknown` แล้ว narrow)
- Hot path (ทุกเฟรม) ห้าม allocate object ใหม่
- ค่า threshold/magic number ทั้งหมดอยู่ใน `app/src/config/`
- ข้อความที่แสดงบนจออยู่ใน `content/` เท่านั้น ห้าม hardcode ในโค้ด
- โค้ด, ชื่อตัวแปร, commit เป็นภาษาอังกฤษ — เอกสารและบทพูดเป็นภาษาไทยได้
