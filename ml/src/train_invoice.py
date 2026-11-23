"""Train and evaluate invoice payment-delay models (M8.4).

Run from the project root:  ml/.venv/Scripts/python ml/src/train_invoice.py
Limitation: selection uses TEST metrics; no hyperparameter search;
results are associative, not causal.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from prepare_invoice import CATEGORICAL, NUMERIC, load_and_prepare

SEED = 42
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CSV_PATH = os.path.join(ROOT, "ml", "data", "dataset_project.csv")
MODEL_DIR = os.path.join(ROOT, "ml", "models")
CARD_PATH = os.path.join(MODEL_DIR, "invoice_model_card.json")
REG_PATH = os.path.join(MODEL_DIR, "invoice_delay_regressor.joblib")
CLF_PATH = os.path.join(MODEL_DIR, "invoice_late_classifier.joblib")
LIMITATION = "selection on test; no hyperparameter search; associative not causal"


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_pipe(estimator):
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
        ("num", SimpleImputer(strategy="median"), NUMERIC),
    ])
    return Pipeline([("pre", pre), ("model", estimator)])


def reg_metrics(y_true, y_pred):
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
    }


def cls_metrics(pipe, X_te, yc_te, constant=False):
    pred = pipe.predict(X_te)
    m = {
        "precision": float(precision_score(yc_te, pred, zero_division=0)),
        "recall": float(recall_score(yc_te, pred, zero_division=0)),
        "f1": float(f1_score(yc_te, pred, zero_division=0)),
    }
    if constant:
        m["roc_auc"] = 0.5
        m["roc_auc_note"] = "constant predictor; ROC-AUC is 0.5 by definition"
    else:
        m["roc_auc"] = float(roc_auc_score(yc_te, pipe.predict_proba(X_te)[:, 1]))
    m["confusion_matrix"] = confusion_matrix(yc_te, pred, labels=[0, 1]).tolist()
    m["confusion_matrix_note"] = "rows = actual [not late, late]; cols = predicted"
    return m


def print_table(title, results, cols):
    print(f"\n{title}")
    header = f"{'model':<30}" + "".join(f"{c:>12}" for c in cols)
    print(header)
    print("-" * len(header))
    for name, m in results.items():
        print(f"{name:<30}" + "".join(f"{m[c]:>12.4f}" for c in cols))


def main():
    X, y, labelled, doc_date, prep = load_and_prepare(CSV_PATH)
    print("Preparation report:")
    for k, v in prep.items():
        print(f"  {k}: {v}")

    # Chronological split on labelled rows only.
    dl = doc_date[labelled]
    order = dl.sort_values(kind="mergesort").index
    n_train = int(round(0.8 * len(order)))
    tr, te = order[:n_train], order[n_train:]
    X_tr, X_te = X.loc[tr], X.loc[te]
    y_tr, y_te = y.loc[tr], y.loc[te]
    train_min, train_max = str(doc_date.loc[tr].min().date()), str(doc_date.loc[tr].max().date())
    test_min, test_max = str(doc_date.loc[te].min().date()), str(doc_date.loc[te].max().date())
    print(f"\nSplit by document_create_date: cut date = {train_max}")
    print(f"  train: {len(tr)} rows ({train_min} .. {train_max})")
    print(f"  test : {len(te)} rows ({test_min} .. {test_max})")

    # Regression.
    reg_specs = {
        "baseline_median_dummy": DummyRegressor(strategy="median"),
        "random_forest": RandomForestRegressor(
            n_estimators=200, min_samples_leaf=20, random_state=SEED, n_jobs=-1),
        "gradient_boosting": GradientBoostingRegressor(random_state=SEED),
    }
    reg_fitted, reg_res = {}, {}
    for name, est in reg_specs.items():
        pipe = make_pipe(est).fit(X_tr, y_tr)
        reg_fitted[name] = pipe
        reg_res[name] = reg_metrics(y_te, pipe.predict(X_te))

    # Classification (late = delay > 0).
    c_tr = (y_tr > 0).astype(int)
    c_te = (y_te > 0).astype(int)
    base_tr, base_te = float(c_tr.mean()), float(c_te.mean())
    clf_specs = {
        "baseline_most_frequent_dummy": DummyClassifier(strategy="most_frequent"),
        "random_forest": RandomForestClassifier(
            n_estimators=200, min_samples_leaf=20, class_weight="balanced",
            random_state=SEED, n_jobs=-1),
        "gradient_boosting": GradientBoostingClassifier(random_state=SEED),
    }
    clf_fitted, clf_res = {}, {}
    for name, est in clf_specs.items():
        pipe = make_pipe(est).fit(X_tr, c_tr)
        clf_fitted[name] = pipe
        clf_res[name] = cls_metrics(pipe, X_te, c_te, constant=name.startswith("baseline"))

    # Selection on TEST (documented limitation).
    reg_cands = [n for n in reg_specs if not n.startswith("baseline")]
    clf_cands = [n for n in clf_specs if not n.startswith("baseline")]
    best_reg_name = min(reg_cands, key=lambda n: reg_res[n]["mae"])
    best_clf_name = max(clf_cands, key=lambda n: clf_res[n]["f1"])
    best_reg = reg_fitted[best_reg_name]
    best_clf = clf_fitted[best_clf_name]

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(best_reg, REG_PATH)
    joblib.dump(best_clf, CLF_PATH)

    # Permutation importance on raw input columns (associative, not causal).
    n_s = min(5000, len(X_te))
    idx = X_te.sample(n=n_s, random_state=SEED).index
    pi = permutation_importance(
        best_reg, X_te.loc[idx], y_te.loc[idx], n_repeats=5, random_state=SEED,
        scoring="neg_mean_absolute_error")
    top = np.argsort(pi.importances_mean)[::-1][:10]
    top10 = [{
        "feature": str(X.columns[i]),
        "importance_mean": float(pi.importances_mean[i]),
        "importance_std": float(pi.importances_std[i]),
    } for i in top]

    card = {
        "dataset_path": "ml/data/dataset_project.csv",
        "dataset_sha256": sha256_of(CSV_PATH),
        "row_counts": {**prep, "train_rows": int(len(tr)), "test_rows": int(len(te))},
        "features": {
            "categorical": CATEGORICAL,
            "numeric": NUMERIC,
            "excluded": ["area_business", "posting_id", "doc_id", "invoice_id",
                         "cust_number", "name_customer", "clear_date", "isOpen"],
        },
        "targets": {
            "regression": "payment_delay_days = clear_date - due_in_date (days), labelled rows only",
            "classification": "late = payment_delay_days > 0",
        },
        "split": {
            "method": "chronological by document_create_date; first 80% train, last 20% test",
            "cut_date": train_max,
            "train_date_range": [train_min, train_max],
            "test_date_range": [test_min, test_max],
        },
        "test_metrics": {
            "regression": reg_res,
            "classification": clf_res,
            "classification_base_rate": {"train_late_share": base_tr, "test_late_share": base_te},
        },
        "selected_models": {
            "regressor": best_reg_name,
            "classifier": best_clf_name,
            "selection_basis": "test MAE (regressor); test F1 (classifier)",
        },
        "model_classes": {
            "regressor": best_reg.named_steps["model"].__class__.__name__,
            "classifier": best_clf.named_steps["model"].__class__.__name__,
        },
        "permutation_importance": {
            "sample_rows": int(n_s),
            "scoring": "neg_mean_absolute_error",
            "n_repeats": 5,
            "top10": top10,
            "note": "associative, not causal",
        },
        "versions": {
            "python": sys.version.split()[0],
            "sklearn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "seed": SEED,
        "limitation": LIMITATION,
    }
    with open(CARD_PATH, "w", encoding="utf-8") as f:
        json.dump(card, f, indent=2)

    print_table("TEST regression metrics", reg_res, ["mae", "rmse"])
    print_table("TEST classification metrics (positive = late)", clf_res,
                ["precision", "recall", "f1", "roc_auc"])
    print(f"\nLate base rate: train {base_tr:.4f}, test {base_te:.4f}")
    print(f"Selected regressor: {best_reg_name} (by test MAE)")
    print(f"Selected classifier: {best_clf_name} (by test F1)")
    print("Top-10 permutation importance (regressor, associative not causal):")
    for t in top10:
        print(f"  {t['feature']:<28} {t['importance_mean']:.4f} +/- {t['importance_std']:.4f}")
    print(f"\nLIMITATION: {LIMITATION}.")
    print(f"Wrote {REG_PATH}\nWrote {CLF_PATH}\nWrote {CARD_PATH}")


if __name__ == "__main__":
    main()
