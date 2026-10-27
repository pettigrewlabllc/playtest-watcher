import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from features import FEATURE_NAMES, NUMERIC, KINDS, feature_matrix  # noqa: E402


def frame(kinds):
    rows = [{c: 0 for c in NUMERIC} | {"kind": k, "game": "g", "session": "s", "type": "t"} for k in kinds]
    return pd.DataFrame(rows)


def test_shape_and_names():
    X = feature_matrix(frame(["attempt", "fail"]))
    assert X.shape == (2, len(FEATURE_NAMES))
    assert len(FEATURE_NAMES) == len(NUMERIC) + len(KINDS)


def test_one_hot_kind_and_unknown_is_other():
    df = frame(["fail", "weird"])
    X = feature_matrix(df)
    assert X[0, FEATURE_NAMES.index("kind_fail")] == 1
    assert X[1, FEATURE_NAMES.index("kind_other")] == 1
    assert X[:, len(NUMERIC):].sum(axis=1).tolist() == [1, 1]


def test_game_session_type_are_not_features():
    assert not any(n in FEATURE_NAMES for n in ("game", "session", "type"))


def test_numeric_passthrough_and_missing_become_zero():
    df = frame(["attempt"])
    df.loc[0, "fail_streak"] = 5
    df.loc[0, "attempts_30s"] = None
    X = feature_matrix(df)
    assert X[0, FEATURE_NAMES.index("fail_streak")] == 5
    assert X[0, FEATURE_NAMES.index("attempts_30s")] == 0
