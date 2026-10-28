# Pose fixtures

Recorded pose sessions (`*.pose.json.gz`) replayed through the real pipeline
(`PoseTracker` → gestures) in `tests/replay/`. They contain **landmark coordinates only — no images**.
Record only people who agreed to it (minors need a guardian's consent).

## Recording a session

1. `cd app && pnpm dev`, open **Chrome** with a single STAT_TEC tab
2. Go to `http://localhost:5173/?record` (or `?record=draw,swipe` for some clips)
3. Stand ~2 m from the camera so it sees you down to the hips, and follow the on-screen instructions
4. Click **Download** at the end and move the file here, named:

   `<YYYY-MM-DD>-<who>-<distance>-<light>.pose.json.gz` — e.g. `2026-10-28-adult1-2m-indoor.pose.json.gz`

5. Add a row below.

Clips and instructions live in `src/debug/record-script.ts`.

## Sessions

| File | Person | Distance | Light | Camera | Notes |
| ---- | ------ | -------- | ----- | ------ | ----- |
