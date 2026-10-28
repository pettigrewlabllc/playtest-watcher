"""Pooled reaction model, two variants, scored leave-one-game-out against two baselines.

traits: situation features + the kid's trait values (game-adjusted, shrunk) + traits x fail_streak and x s_since_success.
kid:    situation features + kid one-hot + kid x the same two situation features.
Both are L2 multinomial logistic regressions on standardized features. Holding out a game holds out every kid's rows
for it, and the traits used in that fold are recomputed without that game."""
import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import cohen_kappa_score, f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).parent))
from common import dump  # noqa: E402
from features import KINDS, NUMERIC  # noqa: E402
from situation import LABELS, load_session  # noqa: E402
import traits as traits_mod  # noqa: E402

SITUATION = NUMERIC + ["rapid_retry", "attempts_no_success", "s_since_moment"]
TRAIT_FEATURES = ["frustration_tolerance", "recovery", "persistence", "exploration_drive", "reading", "pace",
                  "challenge_appetite", "confusion_resolves", "expressiveness"]
INTERACT = ["fail_streak", "s_since_success"]
VARIANTS = ["traits", "kid"]
BASELINES = ["base_rate", "markov"]
C = 1.0
MIN_CLASS = 5        # a label seen in fewer distinct training moments is not modelled in that fold (probability 0)
SMOOTH = 10          # pseudo-rows pulling a baseline's per-bin mix toward the overall mix


def moment_units(df):
    """The independent unit behind each row: labelled rows share their moment; with weak labels (no moment id) a run of
    one label within a session is one unit; every none row is its own."""
    labels = df["label"].astype(str).to_numpy()
    ids = df["moment"].astype(str).to_numpy() if "moment" in df else np.repeat("", len(df))
    sessions = df["session"].astype(str).to_numpy() if "session" in df else np.repeat("", len(df))
    out, run, prev = [], 0, None
    for i, (l, m, s) in enumerate(zip(labels, ids, sessions)):
        if l == "none":
            out.append(f"row:{i}")
            prev = None
        elif m not in ("", "nan", "None"):
            out.append(f"moment:{s}:{m}")
            prev = None
        else:
            if prev != (s, l):
                run += 1
                prev = (s, l)
            out.append(f"run:{run}")
    return np.array(out, dtype=object)


def row_weights(df):
    """1 / (rows in the row's moment), so a long moment counts once, not once per event in it."""
    u = moment_units(df)
    counts = pd.Series(u).value_counts()
    return 1.0 / counts.reindex(u).to_numpy(float)


def situation_matrix(df):
    num = df.reindex(columns=SITUATION).apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(float)
    kind = df["kind"].astype(str).where(df["kind"].astype(str).isin(KINDS), "other")
    prev = df["prev_label"].astype(str) if "prev_label" in df else pd.Series("none", index=df.index)
    return np.hstack([num, np.stack([(kind == k).to_numpy(float) for k in KINDS], 1),
                      np.stack([(prev == l).to_numpy(float) for l in LABELS], 1)])


def trait_table(traits_json):
    """kid -> vector of top-level trait values (differences from the group; missing = 0, the group)."""
    out = {}
    for kid, k in (traits_json.get("kids") or {}).items():
        out[kid] = np.array([(k["traits"].get(n) or {}).get("value") or 0.0 for n in TRAIT_FEATURES], float)
    return out


def design(df, variant, kids, table):
    S = situation_matrix(df)
    inter = df.reindex(columns=INTERACT).apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(float)
    kid = df["kid"].astype(str).to_numpy()
    if variant == "traits":
        Z = np.stack([table.get(k, np.zeros(len(TRAIT_FEATURES))) for k in kid]) if len(kid) else np.zeros((0, len(TRAIT_FEATURES)))
    else:
        Z = np.stack([(kid == k).astype(float) for k in kids], 1) if kids else np.zeros((len(df), 0))
    return np.hstack([S, Z] + [Z * inter[:, [j]] for j in range(inter.shape[1])])


class Model:
    """A multinomial logistic regression over the labels with enough training rows; full label-order probabilities."""

    def __init__(self, variant, kids, table):
        self.variant, self.kids, self.table = variant, list(kids), table

    def fit(self, df):
        y = df["label"].astype(str).to_numpy()
        units, w = moment_units(df), row_weights(df)
        moments = {l: len(set(units[y == l])) for l in LABELS}
        self.classes = [l for l in LABELS if moments[l] >= MIN_CLASS]
        keep = np.isin(y, self.classes)
        mass = np.array([w[y == l].sum() for l in LABELS])
        self.prior = mass / max(mass.sum(), 1e-12)
        self.model = None
        if len(self.classes) >= 2:
            self.model = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000))
            self.model.fit(design(df[keep], self.variant, self.kids, self.table), y[keep],
                           logisticregression__sample_weight=w[keep])
        return self

    def proba(self, df):
        P = np.zeros((len(df), len(LABELS)))
        if self.model is None:
            P[:] = self.prior
            return P
        p = self.model.predict_proba(design(df, self.variant, self.kids, self.table))
        for j, c in enumerate(self.model.classes_):
            P[:, LABELS.index(c)] = p[:, j]
        return P


class BinRate:
    """Label mix per bin (minute of session, or previous moment label), smoothed toward the overall mix."""

    def __init__(self, key):
        self.key = key

    def fit(self, df):
        y = df["label"].astype(str).to_numpy()
        w = row_weights(df)
        self.overall = np.array([w[y == l].sum() for l in LABELS]) / max(w.sum(), 1e-12)
        self.bins = {}
        keys = self.key(df)
        for b in pd.unique(keys):
            at = keys == b
            counts = np.array([w[at & (y == l)].sum() for l in LABELS])
            self.bins[b] = (counts + SMOOTH * self.overall) / (w[at].sum() + SMOOTH)
        return self

    def proba(self, df):
        return np.stack([self.bins.get(b, self.overall) for b in self.key(df)]) if len(df) else np.zeros((0, len(LABELS)))


def minute(df):
    return (pd.to_numeric(df["s_in_session"], errors="coerce").fillna(0) // 60).astype(int).to_numpy()


def prev(df):
    return df["prev_label"].astype(str).to_numpy() if "prev_label" in df else np.repeat("none", len(df))


def make(name, kids, table):
    if name == "base_rate":
        return BinRate(minute)
    if name == "markov":
        return BinRate(prev)
    return Model(name, kids, table)


def metrics(y, P):
    y = np.asarray(y).astype(str)
    if not len(y):
        return {"n": 0, "macro_f1": None, "kappa": None, "auc": {}, "mix_tvd": None}
    pred = np.array(LABELS)[P.argmax(1)]
    present = [l for l in LABELS if (y == l).any()]
    auc = {}
    for l in present:
        t = (y == l).astype(int)
        if 0 < t.sum() < len(t):
            auc[l] = float(roc_auc_score(t, P[:, LABELS.index(l)]))
    real = np.array([(y == l).mean() for l in LABELS])
    kappa = cohen_kappa_score(y, pred) if len(set(y) | set(pred)) > 1 else None
    return {"n": int(len(y)), "macro_f1": float(f1_score(y, pred, labels=present, average="macro", zero_division=0)),
            "kappa": None if kappa is None or not np.isfinite(kappa) else float(kappa),
            "auc": auc, "mix_tvd": float(0.5 * np.abs(P.mean(0) - real).sum()),
            "real_mix": dict(zip(LABELS, real.tolist())), "predicted_mix": dict(zip(LABELS, P.mean(0).tolist()))}


def logo_splits(df):
    for g in sorted(df["game"].astype(str).unique()):
        test = (df["game"].astype(str) == g).to_numpy()
        if (~test).any():
            yield g, np.flatnonzero(~test), np.flatnonzero(test)


def run(rows, session_dirs, kids_file, logo=True, trait_dirs=None):
    """trait_dirs: sessions the final model's trait table comes from (default session_dirs). The unseen-kid transfer
    fold passes every other kid's sessions plus the kid's own other games, while the rows hold no row of that kid."""
    df = rows.reset_index(drop=True)
    sessions = {Path(d).name: d for d in session_dirs}
    game_of = {sid: load_session(d)["game"] for sid, d in sessions.items()}
    kids = sorted(df["kid"].astype(str).unique())
    names = VARIANTS + BASELINES
    folds, pooled_y, pooled_P = [], [], {n: [] for n in names}
    for game, tr, te in (logo_splits(df) if logo else []):
        dirs = [d for sid, d in sessions.items() if game_of[sid] != game]
        table = trait_table(traits_mod.compute(dirs, kids_file, None, boot=0)) if dirs else {}
        train, test = df.iloc[tr], df.iloc[te]
        fold = {"held_out_game": game, "train_games": sorted(train["game"].astype(str).unique()),
                "n_train": int(len(train)), "n_test": int(len(test)), "scores": {}}
        for n in names:
            P = make(n, kids, table).fit(train).proba(test)
            fold["scores"][n] = metrics(test["label"], P)
            pooled_P[n].append(P)
        pooled_y.append(test["label"].astype(str).to_numpy())
        folds.append(fold)
    pooled = {}
    if folds:
        y = np.concatenate(pooled_y)
        pooled = {n: metrics(y, np.vstack(pooled_P[n])) for n in names}

    table = trait_table(traits_mod.compute(list(trait_dirs or sessions.values()), kids_file, None, boot=0))
    final = {v: Model(v, kids, table).fit(df) for v in VARIANTS}
    report = {"variants": VARIANTS, "baselines": BASELINES, "C": C, "min_class": MIN_CLASS,
              "trait_features": TRAIT_FEATURES, "interactions": INTERACT, "kids": kids,
              "weak_labels": bool(df.get("weak_labels", pd.Series([0])).astype(int).any()),
              "label_counts": {l: int((df["label"].astype(str) == l).sum()) for l in LABELS},
              "label_moments": {l: len(set(moment_units(df)[(df["label"].astype(str) == l).to_numpy()])) for l in LABELS},
              "folds": folds, "pooled": pooled,
              "trait_values": {k: dict(zip(TRAIT_FEATURES, v.tolist())) for k, v in table.items()}}
    return report, final


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--sessions", nargs="+", required=True)
    ap.add_argument("--kids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--final-only", action="store_true", help="fit the two variants on everything; skip leave-one-game-out")
    ap.add_argument("--trait-sessions", nargs="+", help="sessions the trait table comes from (default: --sessions)")
    args = ap.parse_args(argv)
    rows = pd.read_csv(args.rows)
    if rows.empty:
        sys.exit("reaction.py: no rows")
    import reaction  # so the saved models unpickle as reaction.Model, not __main__.Model
    report, final = reaction.run(rows, args.sessions, args.kids, logo=not args.final_only, trait_dirs=args.trait_sessions)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dump(report, out / "reaction.json")
    joblib.dump(final, out / "models.joblib")


if __name__ == "__main__":
    main()
