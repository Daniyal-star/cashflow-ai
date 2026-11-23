"""Load and prepare the B2B invoice dataset for payment-delay modelling (M8.3).

Pure pandas/numpy. Raw CSV is read-only and never modified.
"""
import numpy as np
import pandas as pd

CLEAR_FMT = "%Y-%m-%d %H:%M:%S"  # clear_date
DOC_FMT = "%Y%m%d"               # document_create_date, due_in_date

# Columns used as model features (names exactly as in the CSV header).
CATEGORICAL = ["business_code", "invoice_currency", "document type", "cust_payment_terms"]
NUMERIC = ["total_open_amount_log1p", "payment_terms_days", "doc_month", "doc_dayofweek"]

# Deliberately NOT used:
#   area_business (blank), posting_id (single value), doc_id / invoice_id (id-like),
#   cust_number / name_customer (unreliable; no grouping, no target encoding),
#   clear_date / isOpen (post-outcome leakage), baseline_create_date, buisness_year,
#   document_create_date.1 (duplicate column, not in spec).


def _to_date(series, fmt):
    """Parse a date string column; strip float suffix such as '20200210.0'."""
    cleaned = series.str.strip().str.replace(r"\.0$", "", regex=True)
    return pd.to_datetime(cleaned, format=fmt, errors="coerce")


def load_and_prepare(path):
    """Return (features, target, labelled_mask, doc_date, report).

    features   : DataFrame of model inputs (no excluded columns), all kept rows.
    target     : Series payment_delay_days = clear_date - due_in_date (NaN if open).
    labelled   : boolean Series, True where clear_date is present and parseable.
    doc_date   : Series of document_create_date (for chronological split only).
    report     : dict of row counts and target summary.
    """
    raw = pd.read_csv(path, dtype=str)
    report = {"rows_raw": int(len(raw)), "columns_raw": int(raw.shape[1])}

    df = raw.drop_duplicates(keep="first").reset_index(drop=True)
    report["exact_duplicates_dropped"] = int(len(raw) - len(df))
    report["rows_after_dedup"] = int(len(df))

    doc = _to_date(df["document_create_date"], DOC_FMT)
    due = _to_date(df["due_in_date"], DOC_FMT)
    clear = _to_date(df["clear_date"], CLEAR_FMT)

    report["dropped_unparseable_doc_date"] = int(doc.isna().sum())
    report["dropped_unparseable_due_date"] = int(due.isna().sum())

    work = df.assign(_doc=doc, _due=due, _clear=clear)
    work = work[~(work["_doc"].isna() | work["_due"].isna())].reset_index(drop=True)
    report["rows_after_cleaning"] = int(len(work))

    doc_s = work["_doc"]
    due_s = work["_due"]
    clear_s = work["_clear"]
    amount = pd.to_numeric(work["total_open_amount"], errors="coerce")

    features = pd.DataFrame({
        "business_code": work["business_code"].fillna("missing"),
        "invoice_currency": work["invoice_currency"].fillna("missing"),
        "document type": work["document type"].fillna("missing"),
        "cust_payment_terms": work["cust_payment_terms"].fillna("missing"),
        "total_open_amount_log1p": np.log1p(amount.where(amount > -1)),
        "payment_terms_days": (due_s - doc_s).dt.days.astype(float),
        "doc_month": doc_s.dt.month.astype(float),
        "doc_dayofweek": doc_s.dt.dayofweek.astype(float),
    })

    labelled = clear_s.notna().astype(bool)
    target = (clear_s - due_s).dt.days.astype(float).where(labelled)

    report["open_rows_blank_clear_date"] = int(work["clear_date"].isna().sum())
    report["clear_date_unparseable"] = int((work["clear_date"].notna() & clear_s.isna()).sum())
    report["labelled_rows"] = int(labelled.sum())
    report["open_rows_excluded"] = int((~labelled).sum())

    lab = target[labelled]
    report["late_rows_delay_gt0"] = int((lab > 0).sum())
    report["delay_mean"] = float(lab.mean())
    report["delay_median"] = float(lab.median())
    report["delay_min"] = float(lab.min())
    report["delay_max"] = float(lab.max())

    return features, target, labelled, doc_s, report
