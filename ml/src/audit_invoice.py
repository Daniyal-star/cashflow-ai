"""Audit of Dataset A before integration (M8 audit).

Chronological 60/20/20 split; selection on VALIDATION only; TEST scored once.
Seed 42. Run from project root: ml/.venv/Scripts/python ml/src/audit_invoice.py
Associative, not causal. Writes ml/reports/audit_invoice.json. Saves no models.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (GradientBoostingClassifier, GradientBoostingRegressor,
                              RandomForestClassifier, RandomForestRegressor)
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             mean_absolute_error, mean_squared_error, median_absolute_error,
                             precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from prepare_invoice import CATEGORICAL, NUMERIC, load_and_prepare

SEED = 42
PERM_ROWS = 5000
QUANTILES = [5, 25, 50, 75, 95]
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CSV_PATH = os.path.join(ROOT, "ml", "data", "dataset_project.csv")
REPORT_PATH = os.path.join(ROOT, "ml", "reports", "audit_invoice.json")
R = {"seed": SEED}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_pipe(estimator, feats):
    parts = []
    cat = [c for c in feats if c in CATEGORICAL]
    num = [c for c in feats if c in NUMERIC]
    if cat:
        parts.append(("cat", OneHotEncoder(handle_unknown="ignore"), cat))
    if num:
        parts.append(("num", SimpleImputer(strategy="median"), num))
    return Pipeline([("pre", ColumnTransformer(parts)), ("model", estimator)])


def build(estimator, feats):
    # Feature set C (empty): bare estimator fed a constant column.
    return make_pipe(estimator, feats) if feats else estimator


def inp(df, feats):
    return df[feats] if feats else np.zeros((len(df), 1))


def reg_est(name):
    if name == "median_dummy":
        return DummyRegressor(strategy="median")
    if name == "random_forest":
        return RandomForestRegressor(n_estimators=200, min_samples_leaf=20, random_state=SEED, n_jobs=-1)
    return GradientBoostingRegressor(random_state=SEED)


def clf_est(name):
    if name == "most_frequent_dummy":
        return DummyClassifier(strategy="most_frequent")
    if name == "random_forest":
        return RandomForestClassifier(n_estimators=200, min_samples_leaf=20,
                                      class_weight="balanced", random_state=SEED, n_jobs=-1)
    return GradientBoostingClassifier(random_state=SEED)


def reg_metrics(y, p):
    return {"mae": float(mean_absolute_error(y, p)),
            "rmse": float(np.sqrt(mean_squared_error(y, p))),
            "median_ae": float(median_absolute_error(y, p))}


def clf_metrics(model, Xin, yc):
    pred = model.predict(Xin)
    score = model.predict_proba(Xin)[:, 1]
    return {"precision": float(precision_score(yc, pred, zero_division=0)),
            "recall": float(recall_score(yc, pred, zero_division=0)),
            "f1": float(f1_score(yc, pred, zero_division=0)),
            "roc_auc": float(roc_auc_score(yc, score)),
            "average_precision": float(average_precision_score(yc, score)),
            "confusion_matrix": confusion_matrix(yc, pred, labels=[0, 1]).tolist()}


def quantiles(a):
    return {str(q): float(np.percentile(a, q)) for q in QUANTILES}


def key(m, f):
    return f"{m}|{f}"


def main():
    X, y, labelled, doc_date, prep = load_and_prepare(CSV_PATH)
    print("Preparation report:")
    for k, v in prep.items():
        print(f"  {k}: {v}")
    R["preparation"] = prep
    R["dataset_sha256"] = sha256_of(CSV_PATH)

    # 1. Chronological split on labelled rows (stable sort by document date).
    X, y, dates = X.loc[labelled], y.loc[labelled], doc_date.loc[labelled]
    order = dates.sort_values(kind="mergesort").index
    n = len(order)
    n_tr, n_va = n * 60 // 100, n * 20 // 100
    parts = {"train": order[:n_tr], "validation": order[n_tr:n_tr + n_va],
             "test": order[n_tr + n_va:]}
    R["split"] = {}
    print(f"\nChronological split of {n} labelled rows (stable sort by document_create_date):")
    for name, idx in parts.items():
        d = dates.loc[idx]
        s = {"rows": int(len(idx)), "doc_date_min": str(d.min().date()),
             "doc_date_max": str(d.max().date())}
        R["split"][name] = s
        print(f"  {name:<11}: {s['rows']} rows, doc_date {s['doc_date_min']} .. {s['doc_date_max']}")
    tr, va, te = parts["train"], parts["validation"], parts["test"]
    Xtr, Xva, Xte = X.loc[tr], X.loc[va], X.loc[te]
    ytr, yva, yte = y.loc[tr], y.loc[va], y.loc[te]

    # 2. Feature sets (names as returned by load_and_prepare).
    feats_a = list(X.columns)
    feats_b = [c for c in feats_a if c != "cust_payment_terms"]
    if len(feats_b) == len(feats_a):
        print("cust_payment_terms not present; B = A")
    FS = {"A": feats_a, "B": feats_b, "C": []}
    R["feature_sets"] = FS
    print("Feature sets:")
    for k, v in FS.items():
        print(f"  {k}: {v if v else '(none: median baseline)'}")

    # 3. Regression on VALIDATION.
    print("\nREGRESSION (payment_delay_days) - VALIDATION")
    reg_combos = [("median_dummy", "C")] + [
        (m, f) for m in ("random_forest", "gradient_boosting") for f in ("A", "B")]
    reg_val = {}
    for m, f in reg_combos:
        model = build(reg_est(m), FS[f]).fit(inp(Xtr, FS[f]), ytr)
        r = reg_val[key(m, f)] = reg_metrics(yva, model.predict(inp(Xva, FS[f])))
        print(f"  {key(m, f):<30} MAE {r['mae']:.4f}  RMSE {r['rmse']:.4f}  MedAE {r['median_ae']:.4f}")
    R["regression_validation"] = reg_val
    rm, rf = min([c for c in reg_combos if c[0] != "median_dummy"],
                 key=lambda c: reg_val[key(*c)]["mae"])
    print(f"Selected regressor (min validation MAE): {rm} | feature set {rf}")

    # Refit on TRAIN, score TEST once.
    reg_model = build(reg_est(rm), FS[rf]).fit(inp(Xtr, FS[rf]), ytr)
    base_model = build(reg_est("median_dummy"), []).fit(inp(Xtr, []), ytr)
    pred_te = reg_model.predict(inp(Xte, FS[rf]))
    reg_test = reg_metrics(yte, pred_te)
    base_test = reg_metrics(yte, base_model.predict(inp(Xte, [])))
    actual = yte.to_numpy()
    abs_err = np.abs(actual - pred_te)
    qs = {"actual": quantiles(actual), "predicted": quantiles(pred_te),
          "abs_error": quantiles(abs_err)}
    R["regression_test"] = {"model": rm, "feature_set": rf, **reg_test,
                            "median_baseline_mae": base_test["mae"],
                            "median_baseline_rmse": base_test["rmse"]}
    R["regression_test_quantiles"] = qs
    print("TEST regression (scored once):")
    print(f"  {rm} | {rf}: MAE {reg_test['mae']:.4f}  RMSE {reg_test['rmse']:.4f}  MedAE {reg_test['median_ae']:.4f}")
    print(f"  median baseline: MAE {base_test['mae']:.4f}  RMSE {base_test['rmse']:.4f}")
    for lab, d in qs.items():
        print(f"  quantiles {lab}: " + ", ".join(f"p{q}={v:.4f}" for q, v in d.items()))

    # 4. Classification (late = delay > 0) on VALIDATION.
    ytr_c, yva_c, yte_c = (ytr > 0).astype(int), (yva > 0).astype(int), (yte > 0).astype(int)
    print(f"\nLate prevalence: train {ytr_c.mean():.4f}, validation {yva_c.mean():.4f}, test {yte_c.mean():.4f}")
    print("CLASSIFICATION (late = payment_delay_days > 0) - VALIDATION")
    clf_combos = [("most_frequent_dummy", "C")] + [
        (m, f) for m in ("random_forest", "gradient_boosting") for f in ("A", "B")]
    clf_val = {}
    for m, f in clf_combos:
        model = build(clf_est(m), FS[f]).fit(inp(Xtr, FS[f]), ytr_c)
        c = clf_val[key(m, f)] = clf_metrics(model, inp(Xva, FS[f]), yva_c)
        print(f"  {key(m, f):<30} P {c['precision']:.4f}  R {c['recall']:.4f}  F1 {c['f1']:.4f}  "
              f"ROC-AUC {c['roc_auc']:.4f}  AP {c['average_precision']:.4f}")
    R["classification_validation"] = clf_val
    cm_, cf = max([c for c in clf_combos if c[0] != "most_frequent_dummy"],
                  key=lambda c: (clf_val[key(*c)]["f1"], clf_val[key(*c)]["roc_auc"]))
    print(f"Selected classifier (max validation F1, ROC-AUC tie-break): {cm_} | feature set {cf}")

    # Refit on TRAIN, score TEST once.
    clf_model = build(clf_est(cm_), FS[cf]).fit(inp(Xtr, FS[cf]), ytr_c)
    clf_test = clf_metrics(clf_model, inp(Xte, FS[cf]), yte_c)
    clf_test["prevalence"] = float(yte_c.mean())
    ones = np.ones(len(yte_c), dtype=int)
    always = {"precision": float(precision_score(yte_c, ones, zero_division=0)),
              "recall": float(recall_score(yte_c, ones, zero_division=0)),
              "f1": float(f1_score(yte_c, ones, zero_division=0)),
              "average_precision": float(average_precision_score(yte_c, ones))}
    R["classification_test"] = {"model": cm_, "feature_set": cf, **clf_test}
    R["always_late_test"] = always
    print("TEST classification (scored once):")
    print(f"  {cm_} | {cf}: P {clf_test['precision']:.4f}  R {clf_test['recall']:.4f}  "
          f"F1 {clf_test['f1']:.4f}  ROC-AUC {clf_test['roc_auc']:.4f}  AP {clf_test['average_precision']:.4f}")
    print(f"  confusion matrix (rows actual [not late, late]; cols predicted): {clf_test['confusion_matrix']}")
    print(f"  prevalence: {clf_test['prevalence']:.4f}")
    print(f"  always-late: P {always['precision']:.4f}  R {always['recall']:.4f}  "
          f"F1 {always['f1']:.4f}  AP {always['average_precision']:.4f} (AP equals prevalence)")

    # 5. Ablation (chosen model type, VALIDATION; C = dummy).
    abl_c = {fs: clf_val["most_frequent_dummy|C"]["f1"] if fs == "C" else clf_val[key(cm_, fs)]["f1"]
             for fs in ("A", "B", "C")}
    abl_r = {fs: reg_val["median_dummy|C"]["mae"] if fs == "C" else reg_val[key(rm, fs)]["mae"]
             for fs in ("A", "B", "C")}
    R["ablation"] = {"classifier_type": cm_, "validation_f1_by_feature_set": abl_c,
                     "regressor_type": rm, "validation_mae_by_feature_set": abl_r}
    print(f"\nAblation, classifier {cm_} (VALIDATION F1):")
    print("  " + "  ".join(f"{fs}: {v:.4f}" for fs, v in abl_c.items()))
    print(f"Ablation, regressor {rm} (VALIDATION MAE):")
    print("  " + "  ".join(f"{fs}: {v:.4f}" for fs, v in abl_r.items()))

    # 6. Permutation importance on first 5,000 VALIDATION rows, all features.
    Xp = Xva.iloc[:PERM_ROWS]
    perm = {}
    specs = [
        ("regressor", reg_model, FS[rf], yva.iloc[:PERM_ROWS], "neg_mean_absolute_error"),
        ("classifier", clf_model, FS[cf], yva_c.iloc[:PERM_ROWS], "f1"),
    ]
    for label, model, feats, yp, scoring in specs:
        res = permutation_importance(model, Xp[feats], yp, n_repeats=5,
                                     random_state=SEED, scoring=scoring)
        rows = sorted(zip(feats, res.importances_mean, res.importances_std), key=lambda t: -t[1])
        perm[label] = [{"feature": f, "importance_mean": float(m), "importance_std": float(s)}
                       for f, m, s in rows]
        print(f"\nPermutation importance, {label} (scoring={scoring}, {len(Xp)} VALIDATION rows):")
        for f, m, s in rows:
            print(f"  {f:<28} {m:.6f} +/- {s:.6f}")
    R["permutation_importance"] = perm

    # Chosen configuration, versions, report.
    R["selected"] = {
        "regressor": {"model": rm, "feature_set": rf, "selection": "min validation MAE"},
        "classifier": {"model": cm_, "feature_set": cf,
                       "selection": "max validation F1, ROC-AUC tie-break"},
    }
    R["versions"] = {"python": sys.version.split()[0], "sklearn": sklearn.__version__,
                     "pandas": pd.__version__, "numpy": np.__version__}
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(R, f, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"\nWrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
