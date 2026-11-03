# Mapping an analytics export to persona numbers

You don't need a mapping file for the three standard exports. Pass the file with no map and the kit works out which export it is from the columns:

| Export | Recognised by | Measured with no map |
|---|---|---|
| Google Analytics 4 / Firebase (BigQuery `events_*`) | `event_name`, `event_timestamp`, `user_pseudo_id` | fail streak (`level_end` with `success` 0, in a row) |
| GameAnalytics raw export | `category`, `event_id`, `client_ts` (top level or under `data`) | fail streak (`progression` `Fail:*`, reset on `Complete:*`) |
| Unity Analytics raw export | `EVENT_NAME`, `EVENT_TIMESTAMP`, `USER_ID` (or `eventName`, …) | fail streak (`level_fail`, reset on `level_complete`) |

If the export holds more than one player, say which one with `player: <id>`. The error lists the players with the most events.

## Why one number, and how to get the rest

None of these exports have a standard event for a tap or an answer. Those are the game's own events, so first tap, pace and error rate stay on published norms until you name them. When that happens the build says so, and the note lists the export's most common event names next to the exact lines to add.

To add them, write a short map that extends the preset:

```yaml
extends: unity                      # or ga4, gameanalytics
measures:
  first_tap_s:  { median_gap: [gameStarted, buttonTap] }   # a new screen, then the first tap on it
  action_gap_s: { median_gap: [buttonTap, buttonTap] }     # tap to tap
  error_rate:   { ratio: [answer_wrong, answer*] }         # wrong answers out of all answers
```

Then pass that file as the map. The preset still reads the columns, the player and the session. Your lines are added to its measures, and replace one where the name is the same.

## Rules an agent mapping a new export should know

- **Event names** are matched exactly. `*` is a wildcard, and a list means any of them: `[level_fail, round_lost]`.
- **What the event name is:**
  - GA4 events are `event_name`. `level_end` gets its success flag added, so it reads `level_end:1` or `level_end:0`.
  - GameAnalytics events are `category:event_id`, for example `design:ui:hint_button` or `progression:Fail:World1:Level1`.
  - Unity events are `EVENT_NAME`.
- **Measures:**
  - `median_gap: [a, b]` is the middle time from an `a` to the next `b`, within a session.
  - `ratio: [a, b]` is the count of `a` over the count of `b`.
  - `rate_per_min: a` is how many `a` per minute of session.
  - `longest_streak_of: a, reset_on: b` is the middle longest run of `a`. Only a `b` breaks the run.
- **Limits** you can measure: `first_tap_s`, `action_gap_s`, `error_rate`, `idle_per_min`, `sour_after_fails`. Reading speed needs the recorder.
- **Time stamps** have to be finer than a second for first tap and pace. GameAnalytics only stamps whole seconds, so for that export those two can't be measured.
- **A different export** gets a full map of its own: `time`, `time_unit` (`s`, `ms`, `us`, `iso`, `auto`), `event` (a column, or a template like `"{category}:{event_id}"`), `session`, `player` and `measures`. Columns can be lists, and the first one present wins. See `examples/data/events.map.yaml`.
- **Every number** built this way is marked `measured` on the card, with the measure it came from.
