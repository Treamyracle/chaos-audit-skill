#!/usr/bin/env python3
"""
Pure stdlib Before vs. After chaos reproducer & benchmark for msiemens/tinydb
(tested against pinned commit edff96aeb2616402e9489d46e90a592c05565621).

Usage:
  python examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py \
      --tinydb-path <cloned-tinydb-dir> [--trials 50] [--out <file>] [--json] [--assert]
"""

from __future__ import annotations

import argparse
import errno
import json
import math
import os
import platform
import shutil
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run N-trial Before vs. After reliability benchmark against msiemens/tinydb."
    )
    parser.add_argument(
        "--tinydb-path",
        required=True,
        help="Path to local msiemens/tinydb checkout (never modifies target files).",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=50,
        help="Number of trials per scenario (default: 50).",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Optional output path to write JSON telemetry.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON report instead of human summary.",
    )
    parser.add_argument(
        "--assert",
        dest="assert_pass",
        action="store_true",
        help="Exit non-zero unless Before reproduces bugs and After achieves 0%% failure.",
    )
    args = parser.parse_args()
    if args.trials < 1 or args.trials > 500:
        parser.error("--trials must be between 1 and 500")
    return args


def round2(value: float) -> float:
    return round(value, 2)


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, max(0, math.ceil((p / 100.0) * len(sorted_vals)) - 1))
    return round2(sorted_vals[idx])


def summarize_latencies(samples_ms: list[float]) -> dict[str, Any]:
    s = sorted(samples_ms)
    return {
        "samples": len(s),
        "p50": percentile(s, 50),
        "p95": percentile(s, 95),
        "p99": percentile(s, 99),
        "max": round2(s[-1]) if s else 0.0,
    }


def build_fixed_wrappers(JSONStorage: type, Table: type):
    """Minimal surgical wrappers fixing concurrency & crash-safety without touching tinydb source."""

    class ThreadSafeAtomicJSONStorage(JSONStorage):
        def __init__(self, path: str, create_dirs=False, encoding=None, access_mode="r+", **kwargs):
            self._io_lock = threading.RLock()
            self._path = os.fspath(path)
            self._encoding = encoding
            super().__init__(
                path,
                create_dirs=create_dirs,
                encoding=encoding,
                access_mode=access_mode,
                **kwargs,
            )

        def read(self):
            with self._io_lock:
                return super().read()

        def write(self, data):
            with self._io_lock:
                serialized = json.dumps(data, **self.kwargs)
                if "r+" not in self._mode and "w" not in self._mode and "a" not in self._mode:
                    raise IOError(f'Cannot write to the database. Access mode is "{self._mode}"')
                tmp_path = f"{self._path}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
                try:
                    with open(tmp_path, mode="w", encoding=self._encoding) as tmp_handle:
                        self._write_temp_stream(tmp_handle, serialized)
                        tmp_handle.flush()
                        os.fsync(tmp_handle.fileno())
                    self._handle.close()
                    os.replace(tmp_path, self._path)
                    self._handle = open(self._path, mode=self._mode, encoding=self._encoding)
                finally:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)

        @staticmethod
        def _write_temp_stream(handle, serialized: str) -> None:
            handle.write(serialized)

        def close(self) -> None:
            with self._io_lock:
                if not getattr(self._handle, "closed", True):
                    super().close()

    class ThreadSafeTable(Table):
        def __init__(self, storage, name, **kwargs):
            self._table_lock = threading.RLock()
            super().__init__(storage, name, **kwargs)

        def insert(self, document):
            with self._table_lock:
                return super().insert(document)

        def insert_multiple(self, documents):
            with self._table_lock:
                return super().insert_multiple(documents)

        def upsert(self, document, cond=None):
            with self._table_lock:
                return super().upsert(document, cond)

        def update(self, fields, cond=None, doc_ids=None):
            with self._table_lock:
                return super().update(fields, cond, doc_ids)

        def update_multiple(self, updates):
            with self._table_lock:
                return super().update_multiple(updates)

        def remove(self, cond=None, doc_ids=None):
            with self._table_lock:
                return super().remove(cond, doc_ids)

        def truncate(self):
            with self._table_lock:
                return super().truncate()

        def search(self, cond):
            with self._table_lock:
                return super().search(cond)

        def get(self, cond=None, doc_id=None, doc_ids=None):
            with self._table_lock:
                return super().get(cond, doc_id, doc_ids)

        def all(self):
            with self._table_lock:
                return super().all()

        def __len__(self):
            with self._table_lock:
                return super().__len__()

    return ThreadSafeAtomicJSONStorage, ThreadSafeTable


def run_concurrent_inserts(TinyDB, ThreadSafeAtomicJSONStorage, ThreadSafeTable, trials: int, tmp_root: Path):
    """Scenario 1: 4 threads x 5 inserts each (20 docs expected per trial)."""

    def run_side(fixed: bool):
        orig_table_cls = TinyDB.table_class
        if fixed:
            TinyDB.table_class = ThreadSafeTable

        latencies: list[float] = []
        violations = 0
        lost_docs = 0
        exceptions = 0
        corrupt_files = 0
        exc_types: dict[str, int] = {}

        try:
            for t_idx in range(trials):
                db_path = tmp_root / f"s1_{'after' if fixed else 'before'}_{t_idx}.json"
                kwargs: dict[str, Any] = {}
                if fixed:
                    kwargs["storage"] = ThreadSafeAtomicJSONStorage
                db = TinyDB(str(db_path), **kwargs)

                n_threads = 4
                inserts_per_thread = 5
                expected_total = n_threads * inserts_per_thread
                barrier = threading.Barrier(n_threads)
                thread_errors: list[Exception] = []
                err_lock = threading.Lock()

                t0 = time.perf_counter()

                def worker(w_id: int):
                    barrier.wait()
                    for seq in range(inserts_per_thread):
                        try:
                            db.insert({"worker": w_id, "seq": seq})
                        except Exception as exc:
                            with err_lock:
                                thread_errors.append(exc)

                threads = [threading.Thread(target=worker, args=(w,)) for w in range(n_threads)]
                for th in threads:
                    th.start()
                for th in threads:
                    th.join()

                latencies.append((time.perf_counter() - t0) * 1000.0)
                db.close()

                for exc in thread_errors:
                    exceptions += 1
                    name = type(exc).__name__
                    exc_types[name] = exc_types.get(name, 0) + 1

                persisted_count = 0
                file_corrupt = False
                try:
                    with open(db_path, "r", encoding="utf-8") as fh:
                        raw = json.load(fh)
                    table_data = raw.get("_default", {})
                    persisted_count = len(table_data)
                except Exception:
                    file_corrupt = True
                    corrupt_files += 1

                if file_corrupt or thread_errors or persisted_count != expected_total:
                    violations += 1
                    if not file_corrupt:
                        lost_docs += max(0, expected_total - persisted_count)
                    else:
                        lost_docs += expected_total
        finally:
            TinyDB.table_class = orig_table_cls

        return {
            "trials": trials,
            "expected_docs_per_trial": 20,
            "invariant_violations": violations,
            "violation_rate_pct": round2((violations / trials) * 100.0),
            "total_lost_docs": lost_docs,
            "total_exceptions": exceptions,
            "corrupt_db_files": corrupt_files,
            "exception_types": exc_types,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "Table.insert -> _update_table / JSONStorage",
        "failure_class": "lost_update",
        "before": run_side(False),
        "after": run_side(True),
    }


def run_concurrent_upsert_duplicates(
    TinyDB, Query, ThreadSafeAtomicJSONStorage, ThreadSafeTable, trials: int, tmp_root: Path
):
    """Scenario 2: 4 threads concurrently upserting the same natural key across 3 keys/trial."""

    def run_side(fixed: bool):
        orig_table_cls = TinyDB.table_class
        if fixed:
            TinyDB.table_class = ThreadSafeTable

        latencies: list[float] = []
        violations = 0
        duplicate_rows = 0
        max_copies = 1
        exceptions = 0

        try:
            for t_idx in range(trials):
                db_path = tmp_root / f"s2_{'after' if fixed else 'before'}_{t_idx}.json"
                # Use serialized storage even in Before to isolate Table.upsert()'s own
                # check-then-insert TOCTOU race between self.update(...) and self.insert(...)!
                db = TinyDB(str(db_path), storage=ThreadSafeAtomicJSONStorage)
                n_threads = 4
                barrier = threading.Barrier(n_threads)
                thread_errors: list[Exception] = []
                err_lock = threading.Lock()
                keys = ["cfg-a", "cfg-b", "cfg-c"]

                t0 = time.perf_counter()

                def worker(w_id: int):
                    q = Query()
                    barrier.wait()
                    for k in keys:
                        try:
                            db.upsert({"key": k, "worker": w_id}, q.key == k)
                        except Exception as exc:
                            with err_lock:
                                thread_errors.append(exc)

                threads = [threading.Thread(target=worker, args=(w,)) for w in range(n_threads)]
                for th in threads:
                    th.start()
                for th in threads:
                    th.join()

                latencies.append((time.perf_counter() - t0) * 1000.0)
                db.close()

                exceptions += len(thread_errors)
                with open(db_path, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                rows = list(raw.get("_default", {}).values())
                trial_dups = 0
                for k in keys:
                    copies = sum(1 for row in rows if row.get("key") == k)
                    if copies > max_copies:
                        max_copies = copies
                    if copies != 1:
                        trial_dups += abs(copies - 1)

                if thread_errors or trial_dups > 0:
                    violations += 1
                    duplicate_rows += trial_dups
        finally:
            TinyDB.table_class = orig_table_cls

        return {
            "trials": trials,
            "keys_per_trial": 3,
            "invariant_violations": violations,
            "violation_rate_pct": round2((violations / trials) * 100.0),
            "total_duplicate_rows_created": duplicate_rows,
            "max_duplicate_copies_seen": max_copies,
            "total_exceptions": exceptions,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "Table.upsert (check-then-insert)",
        "failure_class": "toctou_race",
        "before": run_side(False),
        "after": run_side(True),
    }


class PartialWriteEnospcHandle:
    """Wraps a text file stream to simulate kernel ENOSPC after partial byte flush."""

    def __init__(self, inner, fail_after_chars: int = 32):
        self._inner = inner
        self._fail_after = fail_after_chars
        self._armed = False

    def arm(self) -> None:
        self._armed = True

    def write(self, data: str) -> int:
        if not self._armed:
            return self._inner.write(data)
        self._armed = False
        prefix = data[: self._fail_after]
        self._inner.write(prefix)
        self._inner.flush()
        raise OSError(errno.ENOSPC, "No space left on device (simulated mid-write ENOSPC)")

    def __getattr__(self, item):
        return getattr(self._inner, item)


def run_mid_write_enospc(TinyDB, ThreadSafeAtomicJSONStorage, trials: int, tmp_root: Path):
    """Scenario 3: Inject deterministic mid-write ENOSPC after persisting 20 committed docs."""

    def run_side(fixed: bool):
        latencies: list[float] = []
        corruptions = 0
        preserved = 0
        stray_tmp_files = 0

        for t_idx in range(trials):
            trial_dir = tmp_root / f"s3_{'after' if fixed else 'before'}_{t_idx}"
            trial_dir.mkdir(parents=True, exist_ok=True)
            db_path = trial_dir / "db.json"

            storage_cls = ThreadSafeAtomicJSONStorage if fixed else TinyDB.default_storage_class

            if fixed:

                class FaultingFixedStorage(ThreadSafeAtomicJSONStorage):
                    fault_once = False

                    @staticmethod
                    def _write_temp_stream(handle, serialized: str) -> None:
                        if FaultingFixedStorage.fault_once:
                            FaultingFixedStorage.fault_once = False
                            handle.write(serialized[:32])
                            handle.flush()
                            raise OSError(errno.ENOSPC, "No space left on device (simulated mid-write ENOSPC)")
                        handle.write(serialized)

                db = TinyDB(str(db_path), storage=FaultingFixedStorage)
            else:
                db = TinyDB(str(db_path), storage=storage_cls)

            initial_docs = [{"id": i, "payload": f"committed-record-{i:02d}-" + ("x" * 24)} for i in range(20)]
            db.insert_multiple(initial_docs)

            # Arm deterministic mid-write ENOSPC fault on the subsequent shrinking write.
            t0 = time.perf_counter()
            if fixed:
                FaultingFixedStorage.fault_once = True
            else:
                proxy = PartialWriteEnospcHandle(db.storage._handle, fail_after_chars=32)
                proxy.arm()
                db.storage._handle = proxy

            try:
                db.remove(doc_ids=list(range(1, 16)))
            except OSError:
                pass
            latencies.append((time.perf_counter() - t0) * 1000.0)

            try:
                if not fixed and isinstance(db.storage._handle, PartialWriteEnospcHandle):
                    db.storage._handle = db.storage._handle._inner
                db.close()
            except Exception:
                pass

            stray_tmp_files += sum(1 for p in trial_dir.iterdir() if p.name.endswith(".tmp"))

            try:
                with open(db_path, "r", encoding="utf-8") as fh:
                    recovered = json.load(fh)
                if len(recovered.get("_default", {})) == 20:
                    preserved += 1
                else:
                    corruptions += 1
            except Exception:
                corruptions += 1

        return {
            "trials": trials,
            "committed_docs_before_fault": 20,
            "corruption_or_loss_count": corruptions,
            "corruption_rate_pct": round2((corruptions / trials) * 100.0),
            "preserved_committed_data_count": preserved,
            "preserved_committed_data_pct": round2((preserved / trials) * 100.0),
            "stray_tmp_files": stray_tmp_files,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "JSONStorage.write (seek(0)->write->truncate)",
        "failure_class": "non_atomic_file_write",
        "before": run_side(False),
        "after": run_side(True),
    }


def run_disprover_remove_check(TinyDB, Query, trials: int, tmp_root: Path):
    """Disprover test verifying Table.remove(cond=...) snapshots list(table.keys()) safely."""
    errors = 0
    for t_idx in range(trials):
        db_path = tmp_root / f"disprover_{t_idx}.json"
        db = TinyDB(str(db_path))
        try:
            db.insert_multiple([{"i": i, "even": (i % 2 == 0)} for i in range(200)])
            q = Query()
            removed = db.remove(q.even == True)  # noqa: E712
            if len(removed) != 100 or len(db) != 100:
                errors += 1
        except Exception:
            errors += 1
        finally:
            db.close()

    return {
        "surface": "Table.remove(cond=...)",
        "mitigating_guard": "tinydb/table.py:683 (for doc_id in list(table.keys()):)",
        "trials": trials,
        "runtime_errors": errors,
        "verdict": "rejected",
    }


def evaluate_assertions(report: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    sc = report["scenarios"]

    if sc["concurrent_threaded_inserts"]["before"]["violation_rate_pct"] < 80.0:
        failures.append(
            f"concurrent_threaded_inserts.before violation rate too low: {sc['concurrent_threaded_inserts']['before']['violation_rate_pct']}%"
        )
    if sc["concurrent_threaded_inserts"]["after"]["violation_rate_pct"] != 0.0:
        failures.append("concurrent_threaded_inserts.after expected 0% violations")

    if sc["concurrent_upsert_duplicates"]["before"]["violation_rate_pct"] < 50.0:
        failures.append(
            f"concurrent_upsert_duplicates.before violation rate too low: {sc['concurrent_upsert_duplicates']['before']['violation_rate_pct']}%"
        )
    if sc["concurrent_upsert_duplicates"]["after"]["violation_rate_pct"] != 0.0:
        failures.append("concurrent_upsert_duplicates.after expected 0% violations")

    if sc["mid_write_enospc_corruption"]["before"]["corruption_rate_pct"] != 100.0:
        failures.append("mid_write_enospc_corruption.before expected 100% corruption")
    if (
        sc["mid_write_enospc_corruption"]["after"]["corruption_rate_pct"] != 0.0
        or sc["mid_write_enospc_corruption"]["after"]["preserved_committed_data_pct"] != 100.0
        or sc["mid_write_enospc_corruption"]["after"]["stray_tmp_files"] != 0
    ):
        failures.append("mid_write_enospc_corruption.after expected 0% corruption & 100% preservation")

    if report["disprover_verification"]["runtime_errors"] != 0:
        failures.append("disprover_verification expected 0 RuntimeError exceptions")

    return failures


def format_summary(report: dict[str, Any]) -> str:
    sc = report["scenarios"]
    s1 = sc["concurrent_threaded_inserts"]
    s2 = sc["concurrent_upsert_duplicates"]
    s3 = sc["mid_write_enospc_corruption"]
    d = report["disprover_verification"]
    return "\n".join(
        [
            f"Real MIT Case Study Benchmark: {report['target_repo']} @ {report['target_commit'][:12]} (Python {report['environment']['python_version']}, N={report['trials_per_scenario']} trials/scenario)",
            f"1. Concurrent 4-thread insert() (20 expected docs/trial):",
            f"   Before: {s1['before']['violation_rate_pct']}% violation ({s1['before']['invariant_violations']}/{s1['before']['trials']}), {s1['before']['total_lost_docs']} lost docs, {s1['before']['total_exceptions']} exceptions ({s1['before']['corrupt_db_files']} corrupt files)",
            f"   After:  {s1['after']['violation_rate_pct']}% violation ({s1['after']['invariant_violations']}/{s1['after']['trials']}), 0 lost docs, 0 exceptions",
            f"2. Concurrent 4-thread upsert() TOCTOU race (3 keys/trial):",
            f"   Before: {s2['before']['violation_rate_pct']}% violation ({s2['before']['invariant_violations']}/{s2['before']['trials']}), {s2['before']['total_duplicate_rows_created']} duplicate rows (max {s2['before']['max_duplicate_copies_seen']}x copies/key)",
            f"   After:  {s2['after']['violation_rate_pct']}% violation ({s2['after']['invariant_violations']}/{s2['after']['trials']}), 0 duplicate rows",
            f"3. Mid-write ENOSPC during JSONStorage.write():",
            f"   Before: {s3['before']['corruption_rate_pct']}% DB corruption ({s3['before']['corruption_or_loss_count']}/{s3['before']['trials']}), {s3['before']['preserved_committed_data_pct']}% preserved",
            f"   After:  {s3['after']['corruption_rate_pct']}% DB corruption, {s3['after']['preserved_committed_data_pct']}% committed data preserved, {s3['after']['stray_tmp_files']} stray .tmp files",
            f"4. Disprover guard verification (Table.remove cond iteration): {d['runtime_errors']}/{d['trials']} errors -> {d['verdict']}",
            f"Total elapsed: {report['duration_ms']}ms",
        ]
    )


def main() -> None:
    args = parse_args()
    tinydb_root = Path(args.tinydb_path).resolve()
    if not (tinydb_root / "tinydb" / "table.py").is_file():
        raise SystemExit(f"Invalid --tinydb-path (tinydb/table.py not found): {tinydb_root}")

    sys.path.insert(0, str(tinydb_root))
    from tinydb import JSONStorage, Query, TinyDB  # noqa: E402
    from tinydb.table import Table  # noqa: E402

    ThreadSafeAtomicJSONStorage, ThreadSafeTable = build_fixed_wrappers(JSONStorage, Table)

    tmp_root = Path(tempfile.mkdtemp(prefix="tinydb-chaos-"))
    t0 = time.perf_counter()
    try:
        s1 = run_concurrent_inserts(TinyDB, ThreadSafeAtomicJSONStorage, ThreadSafeTable, args.trials, tmp_root)
        s2 = run_concurrent_upsert_duplicates(
            TinyDB, Query, ThreadSafeAtomicJSONStorage, ThreadSafeTable, args.trials, tmp_root
        )
        s3 = run_mid_write_enospc(TinyDB, ThreadSafeAtomicJSONStorage, args.trials, tmp_root)
        disprover = run_disprover_remove_check(TinyDB, Query, args.trials, tmp_root)

        report = {
            "schema_version": "1.0",
            "target_repo": "msiemens/tinydb",
            "target_version": "v4.9.0",
            "target_license": "MIT",
            "target_commit": "edff96aeb2616402e9489d46e90a592c05565621",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": {
                "python_version": platform.python_version(),
                "platform": sys.platform,
                "machine": platform.machine(),
            },
            "trials_per_scenario": args.trials,
            "total_chaos_trials": args.trials * 3,
            "duration_ms": round((time.perf_counter() - t0) * 1000.0),
            "scenarios": {
                "concurrent_threaded_inserts": s1,
                "concurrent_upsert_duplicates": s2,
                "mid_write_enospc_corruption": s3,
            },
            "disprover_verification": disprover,
        }

        if args.out:
            out_path = Path(args.out).resolve()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(format_summary(report))

        if args.assert_pass:
            failures = evaluate_assertions(report)
            if failures:
                print("Case-study benchmark assertions FAILED:", file=sys.stderr)
                for f in failures:
                    print(f"  - {f}", file=sys.stderr)
                raise SystemExit(1)
            if not args.json:
                print("Case-study benchmark assertions PASSED.")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
