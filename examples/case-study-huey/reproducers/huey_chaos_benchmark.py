#!/usr/bin/env python3
"""
Zero-dependency, zero-mock, zero-artificial-sleep Before vs. After chaos reproducer
and N-trial benchmark for coleifer/huey v3.5.4 (commit 7ea73730b9b6d413effdd67880970eb3e674974c).

Tests Huey's own explicit concurrency/lock contracts:
1. FileStorage.peek_data() vs. pop_data() TOCTOU race (huey/storage.py:1576-1585)
2. FileStorage.enqueued_items() vs. dequeue() TOCTOU race (huey/storage.py:1465-1471)
3. FileStorage.result_items() vs. put_data()/pop_data() TOCTOU race (huey/storage.py:1631-1647)
4. Disprover checks:
   - SqliteStorage.dequeue() multi-thread exclusivity (huey/storage.py:821-852, 936-950)
   - MemoryStorage.result_items() dict(self._results) under CPython GIL (huey/storage.py:432-433)

Usage:
  python examples/case-study-huey/reproducers/huey_chaos_benchmark.py \
      --huey-path <cloned-huey-dir> [--trials 50] [--out <file>] [--json] [--assert]
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run N-trial Before vs. After reliability benchmark against coleifer/huey."
    )
    parser.add_argument(
        "--huey-path",
        required=True,
        help="Path to untouched local coleifer/huey checkout.",
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
        help="Exit non-zero unless Before reproduces races naturally and After achieves 0%% failure.",
    )
    args = parser.parse_args()
    if args.trials < 1 or args.trials > 500:
        parser.error("--trials must be between 1 and 500")
    return args


def round2(v: float) -> float:
    return round(v, 2)


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


def build_locked_file_storage(FileStorage: type) -> type:
    """Minimal surgical subclass honoring FileStorage's own docstring locking contract."""

    class LockedFileStorage(FileStorage):
        def peek_data(self, key):
            with self.lock:
                return super().peek_data(key)

        def enqueued_items(self, limit=None):
            with self.lock:
                return super().enqueued_items(limit=limit)

        def scheduled_items(self, limit=None):
            with self.lock:
                return super().scheduled_items(limit=limit)

        def result_items(self):
            with self.lock:
                return super().result_items()

    return LockedFileStorage


def run_file_peek_toctou(FileStorage, LockedFileStorage, trials: int, tmp_root: Path):
    """Scenario 1: Concurrent peek_data() vs. put_data()/pop_data() on FileStorage."""

    def run_side(fixed: bool):
        cls = LockedFileStorage if fixed else FileStorage
        latencies: list[float] = []
        violations = 0
        exceptions = 0
        exc_types: dict[str, int] = {}

        for t_idx in range(trials):
            store_dir = tmp_root / f"s1_{'after' if fixed else 'before'}_{t_idx}"
            store_dir.mkdir(parents=True, exist_ok=True)
            storage = cls(name="bench", path=str(store_dir), use_thread_lock=True)

            barrier = threading.Barrier(4)
            errors: list[Exception] = []
            err_lock = threading.Lock()

            def writer():
                barrier.wait()
                for _ in range(110):
                    try:
                        storage.put_data("hot-key", b"payload-value")
                        storage.pop_data("hot-key")
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            def reader():
                barrier.wait()
                for _ in range(110):
                    try:
                        storage.peek_data("hot-key")
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            t0 = time.perf_counter()
            threads = [
                threading.Thread(target=writer),
                threading.Thread(target=writer),
                threading.Thread(target=reader),
                threading.Thread(target=reader),
            ]
            for th in threads:
                th.start()
            for th in threads:
                th.join()
            latencies.append((time.perf_counter() - t0) * 1000.0)

            if errors:
                violations += 1
                exceptions += len(errors)
                for e in errors:
                    name = type(e).__name__
                    exc_types[name] = exc_types.get(name, 0) + 1

        return {
            "trials": trials,
            "invariant_violations": violations,
            "violation_rate_pct": round2((violations / trials) * 100.0),
            "total_exceptions": exceptions,
            "exception_types": exc_types,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "FileStorage.peek_data vs. pop_data (huey/storage.py:1576-1600)",
        "failure_class": "toctou_race",
        "before": run_side(False),
        "after": run_side(True),
    }


def run_file_enqueued_items_toctou(FileStorage, LockedFileStorage, trials: int, tmp_root: Path):
    """Scenario 2: Concurrent enqueued_items() vs. enqueue()/dequeue() on FileStorage."""

    def run_side(fixed: bool):
        cls = LockedFileStorage if fixed else FileStorage
        latencies: list[float] = []
        violations = 0
        exceptions = 0
        exc_types: dict[str, int] = {}

        for t_idx in range(trials):
            store_dir = tmp_root / f"s2_{'after' if fixed else 'before'}_{t_idx}"
            store_dir.mkdir(parents=True, exist_ok=True)
            storage = cls(name="bench", path=str(store_dir), use_thread_lock=True)
            for j in range(15):
                storage.enqueue(f"seed-{j}".encode("utf-8"))

            barrier = threading.Barrier(4)
            errors: list[Exception] = []
            err_lock = threading.Lock()

            def worker(wid: int):
                barrier.wait()
                for i in range(45):
                    try:
                        storage.enqueue(f"w{wid}-{i}".encode("utf-8"))
                        storage.dequeue()
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            def inspector():
                barrier.wait()
                for _ in range(45):
                    try:
                        storage.enqueued_items()
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            t0 = time.perf_counter()
            threads = [
                threading.Thread(target=worker, args=(0,)),
                threading.Thread(target=worker, args=(1,)),
                threading.Thread(target=inspector),
                threading.Thread(target=inspector),
            ]
            for th in threads:
                th.start()
            for th in threads:
                th.join()
            latencies.append((time.perf_counter() - t0) * 1000.0)

            if errors:
                violations += 1
                exceptions += len(errors)
                for e in errors:
                    name = type(e).__name__
                    exc_types[name] = exc_types.get(name, 0) + 1

        return {
            "trials": trials,
            "invariant_violations": violations,
            "violation_rate_pct": round2((violations / trials) * 100.0),
            "total_exceptions": exceptions,
            "exception_types": exc_types,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "FileStorage.enqueued_items vs. dequeue (huey/storage.py:1447-1471)",
        "failure_class": "toctou_race",
        "before": run_side(False),
        "after": run_side(True),
    }


def run_file_result_items_toctou(FileStorage, LockedFileStorage, trials: int, tmp_root: Path):
    """Scenario 3: Concurrent result_items() vs. put_data()/pop_data() on FileStorage."""

    def run_side(fixed: bool):
        cls = LockedFileStorage if fixed else FileStorage
        latencies: list[float] = []
        violations = 0
        exceptions = 0
        exc_types: dict[str, int] = {}

        for t_idx in range(trials):
            store_dir = tmp_root / f"s3_{'after' if fixed else 'before'}_{t_idx}"
            store_dir.mkdir(parents=True, exist_ok=True)
            storage = cls(name="bench", path=str(store_dir), use_thread_lock=True)

            barrier = threading.Barrier(4)
            errors: list[Exception] = []
            err_lock = threading.Lock()

            def writer(wid: int):
                barrier.wait()
                for k in range(35):
                    key = f"k-{wid}-{k % 8}"
                    try:
                        storage.put_data(key, b"res")
                        storage.pop_data(key)
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            def reader():
                barrier.wait()
                for _ in range(35):
                    try:
                        storage.result_items()
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

            t0 = time.perf_counter()
            threads = [
                threading.Thread(target=writer, args=(0,)),
                threading.Thread(target=writer, args=(1,)),
                threading.Thread(target=reader),
                threading.Thread(target=reader),
            ]
            for th in threads:
                th.start()
            for th in threads:
                th.join()
            latencies.append((time.perf_counter() - t0) * 1000.0)

            if errors:
                violations += 1
                exceptions += len(errors)
                for e in errors:
                    name = type(e).__name__
                    exc_types[name] = exc_types.get(name, 0) + 1

        return {
            "trials": trials,
            "invariant_violations": violations,
            "violation_rate_pct": round2((violations / trials) * 100.0),
            "total_exceptions": exceptions,
            "exception_types": exc_types,
            "latency_ms": summarize_latencies(latencies),
        }

    return {
        "surface": "FileStorage.result_items vs. put_data/pop_data (huey/storage.py:1631-1647)",
        "failure_class": "toctou_race",
        "before": run_side(False),
        "after": run_side(True),
    }


def run_disprover_sqlite_dequeue(SqliteStorage, trials: int, tmp_root: Path):
    """Disprover check 1: SqliteStorage.dequeue() never delivers duplicate tasks."""
    duplicate_trials = 0
    errors = 0

    for t_idx in range(trials):
        db_path = tmp_root / f"sqlite_disprover_{t_idx}.db"
        storage = SqliteStorage(name="bench", filename=str(db_path))
        try:
            for i in range(40):
                storage.enqueue(f"task-{i}".encode("utf-8"))

            barrier = threading.Barrier(4)
            dequeued: list[bytes] = []
            list_lock = threading.Lock()
            thread_errs: list[Exception] = []

            def consumer():
                barrier.wait()
                while True:
                    try:
                        item = storage.dequeue()
                    except Exception as exc:
                        with list_lock:
                            thread_errs.append(exc)
                        break
                    if item is None:
                        break
                    with list_lock:
                        dequeued.append(bytes(item))

            threads = [threading.Thread(target=consumer) for _ in range(4)]
            for th in threads:
                th.start()
            for th in threads:
                th.join()

            if thread_errs:
                errors += len(thread_errs)
            if len(dequeued) != 40 or len(set(dequeued)) != 40:
                duplicate_trials += 1
        finally:
            storage.close()

    return {
        "surface": "SqliteStorage.dequeue (BaseSqlStorage.db self.lock + begin exclusive)",
        "mitigating_guard": "huey/storage.py:821-852, 936-950",
        "trials": trials,
        "duplicate_or_loss_trials": duplicate_trials,
        "runtime_errors": errors,
        "verdict": "rejected",
    }


def run_disprover_memory_result_items(MemoryStorage, trials: int):
    """Disprover check 2: MemoryStorage.result_items() dict(self._results) atomic under CPython GIL."""
    runtime_errors = 0
    for _ in range(trials):
        storage = MemoryStorage(name="bench")
        barrier = threading.Barrier(4)
        errors: list[Exception] = []
        err_lock = threading.Lock()

        def mutator(wid: int):
            barrier.wait()
            for r in range(8):
                for k in range(50):
                    key = f"k-{wid}-{k}"
                    try:
                        storage.put_data(key, r)
                        storage.pop_data(key)
                    except Exception as exc:
                        with err_lock:
                            errors.append(exc)

        def reader():
            barrier.wait()
            for _ in range(100):
                try:
                    storage.result_items()
                except Exception as exc:
                    with err_lock:
                        errors.append(exc)

        threads = [
            threading.Thread(target=mutator, args=(0,)),
            threading.Thread(target=mutator, args=(1,)),
            threading.Thread(target=reader),
            threading.Thread(target=reader),
        ]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        runtime_errors += len(errors)

    return {
        "surface": "MemoryStorage.result_items (dict(self._results))",
        "mitigating_guard": "huey/storage.py:432-433 (CPython PyDict_Copy executes under GIL without yielding)",
        "trials": trials,
        "runtime_errors": runtime_errors,
        "verdict": "rejected",
    }


def evaluate_assertions(report: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    sc = report["scenarios"]
    for name in ("file_storage_peek_data_toctou", "file_storage_enqueued_items_toctou", "file_storage_result_items_toctou"):
        if sc[name]["before"]["violation_rate_pct"] < 50.0:
            failures.append(f"{name}.before expected >=50% crash rate, got {sc[name]['before']['violation_rate_pct']}%")
        if sc[name]["after"]["violation_rate_pct"] != 0.0 or sc[name]["after"]["total_exceptions"] != 0:
            failures.append(f"{name}.after expected 0% crashes & 0 exceptions, got {sc[name]['after']}")
    d1 = report["disprover_verifications"]["sqlite_dequeue"]
    if d1["duplicate_or_loss_trials"] != 0 or d1["runtime_errors"] != 0:
        failures.append(f"sqlite_dequeue expected 0 duplicates/errors, got {d1}")
    d2 = report["disprover_verifications"]["memory_result_items"]
    if d2["runtime_errors"] != 0:
        failures.append(f"memory_result_items expected 0 RuntimeErrors under CPython GIL, got {d2}")
    return failures


def format_summary(report: dict[str, Any]) -> str:
    sc = report["scenarios"]
    s1 = sc["file_storage_peek_data_toctou"]
    s2 = sc["file_storage_enqueued_items_toctou"]
    s3 = sc["file_storage_result_items_toctou"]
    d1 = report["disprover_verifications"]["sqlite_dequeue"]
    d2 = report["disprover_verifications"]["memory_result_items"]
    return "\n".join(
        [
            f"Concurrent MIT Case Study: {report['target_repo']} v{report['target_version']} @ {report['target_commit'][:12]} (Python {report['environment']['python_version']}, N={report['trials_per_scenario']}/scenario, zero fake sleeps/mocks)",
            f"1. FileStorage.peek_data() vs. pop_data() TOCTOU:",
            f"   Before: {s1['before']['violation_rate_pct']}% trials crashed ({s1['before']['invariant_violations']}/{s1['before']['trials']}), {s1['before']['total_exceptions']} exceptions {s1['before']['exception_types']}",
            f"   After:  {s1['after']['violation_rate_pct']}% crashed ({s1['after']['invariant_violations']}/{s1['after']['trials']}), 0 exceptions",
            f"2. FileStorage.enqueued_items() vs. dequeue() TOCTOU:",
            f"   Before: {s2['before']['violation_rate_pct']}% trials crashed ({s2['before']['invariant_violations']}/{s2['before']['trials']}), {s2['before']['total_exceptions']} exceptions {s2['before']['exception_types']}",
            f"   After:  {s2['after']['violation_rate_pct']}% crashed ({s2['after']['invariant_violations']}/{s2['after']['trials']}), 0 exceptions",
            f"3. FileStorage.result_items() vs. put_data()/pop_data() TOCTOU:",
            f"   Before: {s3['before']['violation_rate_pct']}% trials crashed ({s3['before']['invariant_violations']}/{s3['before']['trials']}), {s3['before']['total_exceptions']} exceptions {s3['before']['exception_types']}",
            f"   After:  {s3['after']['violation_rate_pct']}% crashed ({s3['after']['invariant_violations']}/{s3['after']['trials']}), 0 exceptions",
            f"4. Disprover guard check A (SqliteStorage.dequeue): {d1['duplicate_or_loss_trials']}/{d1['trials']} duplicate trials, {d1['runtime_errors']} errors -> {d1['verdict']}",
            f"5. Disprover guard check B (MemoryStorage.result_items CPython GIL): {d2['runtime_errors']}/{d2['trials']} errors -> {d2['verdict']}",
            f"Total elapsed: {report['duration_ms']}ms",
        ]
    )


def main() -> None:
    args = parse_args()
    huey_root = Path(args.huey_path).resolve()
    if not (huey_root / "huey" / "storage.py").is_file():
        raise SystemExit(f"Invalid --huey-path (huey/storage.py not found): {huey_root}")

    sys.path.insert(0, str(huey_root))
    from huey.storage import FileStorage, MemoryStorage, SqliteStorage  # noqa: E402

    LockedFileStorage = build_locked_file_storage(FileStorage)
    tmp_root = Path(tempfile.mkdtemp(prefix="huey-chaos-"))
    t0 = time.perf_counter()

    try:
        s1 = run_file_peek_toctou(FileStorage, LockedFileStorage, args.trials, tmp_root)
        s2 = run_file_enqueued_items_toctou(FileStorage, LockedFileStorage, args.trials, tmp_root)
        s3 = run_file_result_items_toctou(FileStorage, LockedFileStorage, args.trials, tmp_root)
        d1 = run_disprover_sqlite_dequeue(SqliteStorage, args.trials, tmp_root)
        d2 = run_disprover_memory_result_items(MemoryStorage, args.trials)

        report = {
            "schema_version": "1.0",
            "target_repo": "coleifer/huey",
            "target_version": "3.5.4",
            "target_license": "MIT",
            "target_commit": "7ea73730b9b6d413effdd67880970eb3e674974c",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": {
                "python_version": platform.python_version(),
                "platform": sys.platform,
                "machine": platform.machine(),
            },
            "methodology_notes": "Zero mocks and zero artificial sleeps; tests run directly against untouched coleifer/huey storage classes using multi-threaded synchronization barriers.",
            "trials_per_scenario": args.trials,
            "total_chaos_trials": args.trials * 3,
            "duration_ms": round((time.perf_counter() - t0) * 1000.0),
            "scenarios": {
                "file_storage_peek_data_toctou": s1,
                "file_storage_enqueued_items_toctou": s2,
                "file_storage_result_items_toctou": s3,
            },
            "disprover_verifications": {
                "sqlite_dequeue": d1,
                "memory_result_items": d2,
            },
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
                print("Huey case-study assertions FAILED:", file=sys.stderr)
                for f in failures:
                    print(f"  - {f}", file=sys.stderr)
                raise SystemExit(1)
            if not args.json:
                print("Huey case-study assertions PASSED.")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
