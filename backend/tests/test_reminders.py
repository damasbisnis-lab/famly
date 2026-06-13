import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import _shift_hm, _valid_hm, get_reminder_prefs, DEFAULT_REMINDER_PREFS, _next_occurrence


def test_next_occurrence_daily():
    # current due before today -> rolls forward to >= today
    assert _next_occurrence("2026-06-01", "daily", "2026-06-13") == "2026-06-13"


def test_next_occurrence_weekly_keeps_weekday():
    # 2026-06-01 is a Monday; next Monday >= 2026-06-13 is 2026-06-15
    assert _next_occurrence("2026-06-01", "weekly", "2026-06-13") == "2026-06-15"


def test_next_occurrence_steps_once_when_today():
    # completing today's weekly task -> next week
    assert _next_occurrence("2026-06-15", "weekly", "2026-06-15") == "2026-06-22"
    assert _next_occurrence("2026-06-15", "daily", "2026-06-15") == "2026-06-16"


def test_shift_hm_basic():
    assert _shift_hm("15:30", 30) == "15:00"
    assert _shift_hm("15:30", 0) == "15:30"
    assert _shift_hm("09:00", 60) == "08:00"


def test_shift_hm_wraps_midnight():
    assert _shift_hm("00:10", 30) == "23:40"
    assert _shift_hm("00:00", 1) == "23:59"


def test_valid_hm():
    assert _valid_hm("08:00")
    assert _valid_hm("23:59")
    assert not _valid_hm("7:5")
    assert not _valid_hm("24:00")
    assert not _valid_hm("12:60")
    assert not _valid_hm("abc")


def test_get_reminder_prefs_defaults():
    prefs = get_reminder_prefs({})
    assert prefs == DEFAULT_REMINDER_PREFS


def test_get_reminder_prefs_override_and_tz():
    user = {
        "reminder_prefs": {"finance_reminder_time": "21:15", "task_lead_minutes": 15},
        "tz_label": "WITA",
    }
    prefs = get_reminder_prefs(user)
    assert prefs["finance_reminder_time"] == "21:15"
    assert prefs["task_lead_minutes"] == 15
    assert prefs["tz_label"] == "WITA"
    # untouched keys keep defaults
    assert prefs["task_summary_time"] == DEFAULT_REMINDER_PREFS["task_summary_time"]
