"""M8 payment-terms investigation. Read-only; prints plain-text numbers to stdout. Seed 42.

Date parsing and the duplicate-drop rule are copied from ml/src/prepare_invoice.py.
Associations reported here are observed associations, not definitions.
"""
import os

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import OneHotEncoder

SEED = 42
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "dataset_project.csv")
CLEAR_FMT = "%Y-%m-%d %H:%M:%S"  # clear_date
DOC_FMT = "%Y%m%d"               # document_create_date, due_in_date
POST_FMT = "%Y-%m-%d"            # posting_date
MISSING = "missing"


def to_date(series, fmt):
    """Parse a date string column; strip float suffix such as '20200210.0'."""
    cleaned = series.str.strip().str.replace(r"\.0$", "", regex=True)
    return pd.to_datetime(cleaned, format=fmt, errors="coerce")


def blank(series):
    return series.isna() | series.astype(str).str.strip().eq("")


def quantiles(s):
    q = s.quantile([0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]).tolist()
    return " ".join(f"{v:.2f}" for v in q)


def fit_model(train, with_code):
    parts = []
    if with_code:
        parts.append(("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["code"]))
    parts.append(("num", "passthrough", ["ptd", "amt", "month"]))
    ct = ColumnTransformer(parts)
    rf = RandomForestRegressor(n_estimators=100, min_samples_leaf=20, random_state=SEED)
    rf.fit(ct.fit_transform(train[["code", "ptd", "amt", "month"]]), train["delay"])
    return ct, rf


def main():
    np.random.seed(SEED)
    raw = pd.read_csv(DATA, dtype=str)
    cols = list(raw.columns)

    print("== A. Provenance ==")
    print(f"header position of cust_payment_terms (1-based): {cols.index('cust_payment_terms') + 1} of {len(cols)}")
    pt_blank = blank(raw["cust_payment_terms"])
    cl_blank = blank(raw["clear_date"])
    print(f"blank count cust_payment_terms (raw rows): {int(pt_blank.sum())}")
    for a in (True, False):
        for b in (True, False):
            n = int(((pt_blank == a) & (cl_blank == b)).sum())
            print(f"crosstab pt_blank={a} clear_blank={b}: {n}")

    # Cleaning exactly as prepare_invoice.py
    df = raw.drop_duplicates(keep="first").reset_index(drop=True)
    doc = to_date(df["document_create_date"], DOC_FMT)
    due = to_date(df["due_in_date"], DOC_FMT)
    clear = to_date(df["clear_date"], CLEAR_FMT)
    posting = to_date(df["posting_date"], POST_FMT)
    work = df.assign(_doc=doc, _due=due, _clear=clear, _post=posting)
    work = work[work["_doc"].notna() & work["_due"].notna()].reset_index(drop=True)

    lab = work[work["_clear"].notna()].copy()
    lab["ptd"] = (lab["_due"] - lab["_doc"]).dt.days.astype(float)
    lab["delay"] = (lab["_clear"] - lab["_due"]).dt.days.astype(float)
    lab["amt"] = np.log1p(pd.to_numeric(lab["total_open_amount"], errors="coerce").where(lambda x: x > -1))
    lab["code"] = lab["cust_payment_terms"].fillna(MISSING)
    lab["month"] = lab["_doc"].dt.month.astype(float)
    lab["post_ord"] = lab["_post"].map(lambda t: t.toordinal() if pd.notna(t) else np.nan).astype(float)
    lab = lab.sort_values("_doc", kind="mergesort")

    print()
    print("== B. Relationships (labelled rows, after exact-duplicate removal) ==")
    print(f"labelled rows: {len(lab)}")
    print("payment_terms_days min/p5/p25/p50/p75/p95/max:", quantiles(lab["ptd"]))
    print("payment_terms_days distinct:", int(lab["ptd"].nunique()))
    known = lab[lab["code"] != MISSING]
    print("cust_payment_terms distinct codes (non-missing):", int(known["code"].nunique()))
    top = known["code"].value_counts().head(15)
    for code, n in top.items():
        sub = lab[lab["code"] == code]
        modal = sub["ptd"].mode().iloc[0]
        share = float((sub["ptd"] == modal).mean())
        print(f"top code={code} n={n} modal_payment_terms_days={modal:.0f} share_equal_modal={share:.4f}")
    rho1 = lab["ptd"].corr(lab["delay"], method="spearman")
    rho2 = lab["post_ord"].corr(lab["delay"], method="spearman")
    print(f"Spearman(payment_terms_days, payment_delay_days): {rho1:.4f}")
    print(f"Spearman(posting_date ordinal, payment_delay_days): {rho2:.4f}")
    for code, n in top.items():
        sub = lab[lab["code"] == code]
        print(f"code={code} n={n} mean_delay={sub['delay'].mean():.2f} "
              f"median_delay={sub['delay'].median():.2f} late_rate={(sub['delay'] > 0).mean():.4f}")
    print("observed associations, not definitions")

    print()
    print("== C. Creation-time availability (fraction populated) ==")
    open_df = work[blank(work["clear_date"])]
    print(f"open rows (clear_date blank): {len(open_df)}; labelled rows: {len(lab)}")
    for col in cols:
        o = float((~blank(open_df[col])).mean()) if len(open_df) else float("nan")
        l = float((~blank(lab[col])).mean()) if len(lab) else float("nan")
        flag = "  <-- populated only for labelled rows" if (o == 0 and l > 0) else ""
        print(f"{col}: open={o:.4f} labelled={l:.4f}{flag}")

    print()
    print("== D. Chronological stability (labelled rows sorted by document date, 5 equal periods) ==")
    parts = np.array_split(np.arange(len(lab)), 5)
    p1_codes = set(lab["code"].iloc[parts[0]])
    for k, idx in enumerate(parts, 1):
        sub = lab.iloc[idx]
        unseen = float((~sub["code"].isin(p1_codes)).mean())
        print(f"period {k}: n={len(sub)} late_rate={(sub['delay'] > 0).mean():.4f} "
              f"median_delay={sub['delay'].median():.2f} distinct_codes(incl missing)={sub['code'].nunique()} "
              f"rows_with_code_unseen_in_period1={unseen:.4f}")

    print()
    print("== E. Model check (TRAIN first 60%, TEST last 20%) ==")
    n = len(lab)
    tr = lab.iloc[: int(0.6 * n)].copy()
    te = lab.iloc[int(0.8 * n):].copy()
    amt_med = tr["amt"].median()
    tr["amt"] = tr["amt"].fillna(amt_med)
    te["amt"] = te["amt"].fillna(amt_med)
    print(f"TRAIN n={len(tr)} TEST n={len(te)}")
    ct_with, rf_with = fit_model(tr, with_code=True)
    p_with = rf_with.predict(ct_with.transform(te[["code", "ptd", "amt", "month"]]))
    ct_wo, rf_wo = fit_model(tr, with_code=False)
    p_wo = rf_wo.predict(ct_wo.transform(te[["code", "ptd", "amt", "month"]]))
    mae_with = float(np.mean(np.abs(p_with - te["delay"].values)))
    mae_wo = float(np.mean(np.abs(p_wo - te["delay"].values)))
    mae_base = float(np.mean(np.abs(tr["delay"].median() - te["delay"].values)))
    print(f"TEST MAE with cust_payment_terms: {mae_with:.4f}")
    print(f"TEST MAE without cust_payment_terms: {mae_wo:.4f}")
    print(f"TEST MAE median baseline: {mae_base:.4f}")

    print()
    print("== F. Inference safety ==")
    train_codes = set(tr["code"])
    test_codes = set(te["code"])
    print(f"codes in TRAIN: {len(train_codes)}")
    print(f"codes present only in TEST: {len(test_codes - train_codes)}")
    print(f"blank rate in TEST: {float((te['code'] == MISSING).mean()):.4f}")
    probe = pd.DataFrame({"code": ["__UNSEEN_CODE__"], "ptd": [30.0], "amt": [10.0], "month": [6.0]})
    enc = ct_with.named_transformers_["cat"]
    row = enc.transform(probe[["code"]])[0]
    print("1-row unseen-code transform row:", row.tolist())

    print()
    print("== G. Reconciliation ==")
    dup_removed = len(raw) - len(df)
    x2_raw = int((raw["document type"].str.strip() == "X2").sum())
    x2_dedup = int((df["document type"].str.strip() == "X2").sum())
    doc_bad = doc.isna()
    due_bad = due.isna()
    print(f"raw rows: {len(raw)}")
    print(f"exact duplicates removed: {dup_removed}")
    print(f"labelled rows (clear_date present, after duplicates and date checks): {len(lab)}")
    print(f"X2 documents among raw rows: {x2_raw}")
    print(f"X2 documents among post-dedup rows: {x2_dedup}")
    print(f"rows removed by document_create_date check: {int(doc_bad.sum())}")
    print(f"rows removed by due_in_date check: {int(due_bad.sum())}")
    print(f"rows removed by both date checks (overlap): {int((doc_bad & due_bad).sum())}")
    print(f"rows removed by date checks combined: {int((doc_bad | due_bad).sum())}")
    print(f"clear_date non-blank but unparseable (cleaned rows): "
          f"{int((~blank(work['clear_date']) & work['_clear'].isna()).sum())}")
    print(f"posting_date unparseable (cleaned rows, informational): {int(work['_post'].isna().sum())}")
    n_open = int(blank(work["clear_date"]).sum())
    readme = [
        ("raw rows", 50000, len(raw)),
        ("duplicates", 1161, dup_removed),
        ("after cleaning", 48833, len(work)),
        ("paid (labelled)", 39152, len(lab)),
        ("open", 9681, n_open),
        ("X2 among raw", 6, x2_raw),
        ("X2 among post-dedup", 6, x2_dedup),
    ]
    for name, published, measured in readme:
        print(f"README {name}: published={published} measured={measured} difference={measured - published}")


if __name__ == "__main__":
    main()
