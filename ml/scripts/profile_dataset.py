import numpy as np
import pandas as pd

PATH = "ml/data/dataset_project.csv"


def hdr(title):
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def pick_format(series, candidates):
    s = series.str.strip().str.replace(r"\.0$", "", regex=True)
    sample = s[s != ""].head(200)
    for fmt in candidates:
        if len(sample) and pd.to_datetime(sample, format=fmt, errors="coerce").notna().all():
            return fmt
    return None


def parse_col(series, fmt):
    s = series.str.strip().str.replace(r"\.0$", "", regex=True)
    nonblank = s != ""
    parsed = pd.to_datetime(s.where(nonblank), format=fmt, errors="coerce")
    return parsed, nonblank


CANDIDATES = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y%m%d"]
DATE_COLS = ["clear_date", "posting_date", "document_create_date",
             "document_create_date.1", "due_in_date", "baseline_create_date"]

# (a) typed read and raw read
hdr("a. Shape, columns, pandas default dtypes")
typed = pd.read_csv(PATH)
print("rows:", len(typed))
print("columns:", typed.shape[1])
print("column names:", list(typed.columns))
print("pandas default dtypes:")
print(typed.dtypes.to_string())

raw = pd.read_csv(PATH, dtype=str, keep_default_na=False)
n = len(raw)

# (b) missing values
hdr("b. Missing values (blank or whitespace-only string counts as missing)")
for c in raw.columns:
    m = int((raw[c].str.strip() == "").sum())
    print(f"{c:26s} missing={m:6d}  pct={100.0 * m / n:8.3f}")

# (c) duplicates
hdr("c. Duplicates")
print("exact duplicate rows (all columns identical):", int(raw.duplicated().sum()))
for c in ["doc_id", "invoice_id"]:
    s = raw[c].str.strip()
    print(f"{c}: distinct={s.nunique()}  rows_sharing_a_value={int(s.duplicated(keep=False).sum())}"
          f"  extra_duplicate_rows={int(s.duplicated().sum())}  blank_rows={int((s == '').sum())}")

# (d) date validity
hdr("d. Date validity (format chosen from first 200 non-blank values per column)")
parsed = {}
for c in DATE_COLS:
    fmt = pick_format(raw[c], CANDIDATES)
    if fmt is None:
        print(f"{c}: NO candidate format fits the sample -> not parsed")
        parsed[c] = pd.Series(pd.NaT, index=raw.index)
        continue
    p, nb = parse_col(raw[c], fmt)
    parsed[c] = p
    ok = int((p.notna()).sum())
    fail = int((nb & p.isna()).sum())
    blank = int((~nb).sum())
    print(f"{c:24s} format={fmt!r:24s} parsed={ok:6d} failed={fail:6d} blank={blank:6d} "
          f"min={p.min()} max={p.max()}")

clear = parsed["clear_date"]
posting = parsed["posting_date"]
due = parsed["due_in_date"]
both_cp = clear.notna() & posting.notna()
print("rows where clear_date < posting_date:", int((clear[both_cp] < posting[both_cp]).sum()),
      "of", int(both_cp.sum()), "rows where both parse")
both_cd = clear.notna() & parsed["document_create_date"].notna()
print("rows where clear_date < document_create_date:",
      int((clear[both_cd] < parsed["document_create_date"][both_cd]).sum()),
      "of", int(both_cd.sum()), "rows where both parse")

# (e) payment delay = clear_date - due_in_date (days), only where both parse
hdr("e. Payment delay = clear_date - due_in_date (days), rows where both parse")
both = clear.notna() & due.notna()
delay = ((clear[both] - due[both]).dt.total_seconds() / 86400.0).to_numpy()
print("count:", delay.size)
if delay.size:
    p5, p25, p50, p75, p95 = np.percentile(delay, [5, 25, 50, 75, 95])
    print(f"min={delay.min():.2f} p5={p5:.2f} p25={p25:.2f} p50={p50:.2f} "
          f"p75={p75:.2f} p95={p95:.2f} max={delay.max():.2f} mean={delay.mean():.4f}")
    print("delay > 0:", int((delay > 0).sum()), " delay = 0:", int((delay == 0).sum()),
          " delay < 0:", int((delay < 0).sum()))
print("rows with blank clear_date (open items):", int(raw["clear_date"].str.strip().eq("").sum()))
print("rows with clear_date populated but due_in_date unparsed:",
      int((clear.notna() & due.isna()).sum()))

# (f) customer diversity
hdr("f. Customer diversity")
cust = raw["cust_number"].str.strip()
per_cust = cust.value_counts()
print("distinct cust_number:", cust.nunique())
print(f"invoices per customer: min={per_cust.min()} median={per_cust.median()} max={per_cust.max()}")
cleared_cust = raw.loc[raw["clear_date"].str.strip() != "", "cust_number"].str.strip().value_counts()
all_ids = cust.unique()
no_cleared = len(set(all_ids) - set(cleared_cust.index))
print("customers with zero cleared invoices:", no_cleared)
print("customers with fewer than 3 cleared invoices (incl. zero):",
      int((cleared_cust.reindex(all_ids).fillna(0) < 3).sum()))
name = raw["name_customer"].str.strip()
ids_per_name = pd.DataFrame({"name": name, "cust": cust}).groupby("name")["cust"].nunique()
names_multi = ids_per_name[ids_per_name > 1]
print("distinct name_customer:", name.nunique())
print("names mapping to more than one cust_number:", len(names_multi))
for nm, k in names_multi.head(10).items():
    print(f"   {nm!r} -> {k} ids")
names_per_id = pd.DataFrame({"name": name, "cust": cust}).groupby("cust")["name"].nunique()
print("cust_numbers mapping to more than one name:", int((names_per_id > 1).sum()))

# (g) currency
hdr("g. invoice_currency distribution")
cur = raw["invoice_currency"].str.strip().replace("", "(blank)").value_counts()
for k, v in cur.items():
    print(f"{k:12s} {v:6d}  {100.0 * v / n:7.3f}%")

# (h) amount
hdr("h. total_open_amount")
amt_raw = raw["total_open_amount"].str.strip()
amt = pd.to_numeric(amt_raw.where(amt_raw != ""), errors="coerce")
print("blank:", int((amt_raw == "").sum()), " non-numeric (non-blank):",
      int((amt_raw != "").sum() - amt.notna().sum()))
print(f"min={amt.min()} median={amt.median()} max={amt.max()}")
print("zero:", int((amt == 0).sum()), " negative:", int((amt < 0).sum()),
      " zero-or-negative:", int((amt <= 0).sum()))

# (i) leakage and open status
hdr("i. Post-outcome leakage check and open status")
pop = int((raw["clear_date"].str.strip() != "").sum())
print("clear_date populated rows (post-outcome leak candidate):", pop, "of", n)
print("isOpen value counts:")
print(raw["isOpen"].str.strip().value_counts(dropna=False).to_string())
ct = pd.crosstab(raw["isOpen"].str.strip(), raw["clear_date"].str.strip() != "")
print("crosstab isOpen (rows) x clear_date populated (cols):")
print(ct.to_string())

# unclassified / unclear columns
hdr("j. Columns not otherwise classified: top values")
for c in ["business_code", "buisness_year", "document type", "posting_id",
          "area_business", "cust_payment_terms", "isOpen"]:
    vc = raw[c].str.strip().replace("", "(blank)").value_counts()
    print(f"{c}: distinct={vc.size} top={vc.head(5).to_dict()}")
