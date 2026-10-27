# Session day checklist

One kid, one game, 10 minutes. Run through this every time.

## Once, before the first session

1. Run the camera test: `npm start` in this folder, open http://localhost:3058/spike.html in Chrome, 1 minute then 10. It should say PASS. If Chrome never asks for the camera, check System Settings > Privacy & Security > Camera and Microphone, and allow Chrome.
2. Each kid answers the questions once: http://localhost:3058/questions.html (or the laptop's LAN address on the iPad). Pick their letter, 12 taps, done.

## Camera setup (from the first sessions)

- **Stand the iPad up** on a stand or case, tilted toward the kid, so they look forward instead of down at the desk.
- **Face camera (Anker) just above or behind the iPad, at the kid's eye level**, framing head and shoulders. Mounted high on the desk it mostly sees the top of their head, and expressions are half of what the model reads.
- **Hands camera: MacBook Pro Desk View.** It sees the iPad and fingers from above.

## Every session

1. **Start the watcher:** `npm start` in `playtest-watcher` (port 3058).
2. **Start the games:** `./scripts/serve-games.sh` in `playtest-watcher`. It prints each game's address. Leave it running.
3. **iPad:** plug it into the Mac. QuickTime > File > New Movie Recording > click the arrow next to record > pick the iPad as the camera. Leave that window open.
4. **Recorder:** open http://localhost:3058/record.html in Chrome. Pick kid, game, round (learn, check, or reference for your own playthrough) and device. Check the face camera is the MacBook, hands is the Anker, mic is the Anker. Click **Get ready**, and share the QuickTime window (iPad) or the game window (laptop).
5. **Open the game:** on the iPad, scan the QR code on the recorder page. Current Cut runs on the iPad too (a web build); its laptop command is a fallback. The status line should switch to "Game events received: N" within a few seconds of the first tap. If it stays on "Waiting", check the iPad is on the same Wi-Fi.
6. Tap how they're **coming in** (tired, normal, wound up). **Start**, then the kid plays. Remind them to say what they're thinking. At 10:00 it beeps and keeps recording. Stop when they reach a natural break.
7. **Debrief, still recording:** click **I'm asking now**, ask the three questions on screen out loud, let them answer. Then **Stop**. Check the summary: about 10 minutes, every track has megabytes, events are in the hundreds, no upload errors.

## Round-robin

| | Factor Slicer | Bond Swap | Hoard Keeper | Current Cut |
|---|---|---|---|---|
| Kid A | learn | learn | learn | **check** |
| Kid B | learn | learn | **check** | learn |
| Kid C | learn | **check** | learn | learn |
| Kid D | **check** | learn | learn | learn |

Check sessions happen only after the predictions are frozen (Mon Nov 2). Before that, record one **reference** playthrough of each game yourself.

**Replay round:** two kids replay one of their learning games on a later day (round `replay`, 10 minutes). It measures how consistent a kid is with themselves, which is the ceiling a prediction is scored against.

## Notes

- Bond Swap's prototype shows test ads. If one interrupts a kid, that's fine. It shows up in the log and we'll ignore that stretch.
- Recordings stay in `recordings/`, which is never committed.
