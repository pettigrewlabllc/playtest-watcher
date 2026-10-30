"""Event rows -> feature matrix. Pure. game, session and type are deliberately not features, so the model transfers across games."""
import numpy as np
import pandas as pd

LABELS = ["confused", "stuck", "bored", "frustrated", "focused", "engaged", "delighted", "none"]
KINDS = ["attempt", "success", "fail", "progress", "explore", "text_shown", "text_closed",
         "help", "new_thing", "first_touch", "idle", "quit", "other"]
NUMERIC = ["fail_streak", "s_since_success", "s_since_progress", "attempts_30s", "new_thing_10s",
           "text_chars_on_screen", "s_in_session", "explore_so_far", "help_so_far"]
FEATURE_NAMES = NUMERIC + [f"kind_{k}" for k in KINDS]


def feature_matrix(df: pd.DataFrame) -> np.ndarray:
    """One row per input row, columns in FEATURE_NAMES order. Unknown kinds count as 'other'."""
    num = df[NUMERIC].apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(dtype=float)
    kind = df["kind"].astype(str).where(df["kind"].astype(str).isin(KINDS), "other")
    onehot = np.stack([(kind == k).to_numpy(dtype=float) for k in KINDS], axis=1)
    return np.hstack([num, onehot])
